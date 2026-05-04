/**
 * Production-ready client vault:
 * - DEK (data key) encrypts recordings
 * - KEK (passphrase-derived) wraps DEK
 * - Envelope sync + admin recovery + retention policy + audit events via backend
 */
(function (global) {
  const DB_NAME = "spherecare_recording_vault";
  const DB_VERSION = 1;
  const STORE_RECORDINGS = "recordings";
  const STORE_META = "vault_meta";
  const META_KEY = "config";
  const PBKDF2_ITERATIONS = 310000;
  const VERIFY_PLAINTEXT = new TextEncoder().encode("spherecare-vault-v2");
  const POLICY_CACHE_TTL_MS = 5 * 60 * 1000;

  let dbPromise = null;
  let vaultDekKey = null;
  let currentDekB64 = null;
  let retentionPolicyCache = null;
  let retentionPolicyFetchedAt = 0;

  function apiBase() {
    return typeof API_BASE !== "undefined" ? API_BASE : "/api/v1";
  }

  function authHeaders() {
    const h = { "Content-Type": "application/json" };
    const token = sessionStorage.getItem("access_token");
    if (token) h.Authorization = `Bearer ${token}`;
    return h;
  }

  async function apiFetch(path, options = {}) {
    const merged = {
      ...options,
      headers: {
        ...authHeaders(),
        ...(options.headers || {}),
      },
    };
    const res = await fetch(`${apiBase()}${path}`, merged);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || `API ${path} failed (${res.status})`);
    }
    if (res.status === 204) return null;
    return res.json();
  }

  function bufToB64(buf) {
    const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }

  function b64ToBuf(b64) {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function randomKeyId() {
    return `dek_${crypto.randomUUID().replace(/-/g, "")}`;
  }

  async function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => resolve(req.result);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_RECORDINGS)) {
          db.createObjectStore(STORE_RECORDINGS, { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains(STORE_META)) {
          db.createObjectStore(STORE_META, { keyPath: "key" });
        }
      };
    });
    return dbPromise;
  }

  async function vaultGetMeta() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_META, "readonly");
      const req = tx.objectStore(STORE_META).get(META_KEY);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async function putMeta(meta) {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_META, "readwrite");
      tx.objectStore(STORE_META).put(meta);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function deriveKekFromPassphrase(passphrase, salt) {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
      keyMaterial,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  }

  async function importDekFromRaw(rawDek) {
    return crypto.subtle.importKey("raw", rawDek, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  }

  async function wrapDekWithKek(rawDek, kek) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const wrapped = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, kek, rawDek);
    return { wrappedDekB64: bufToB64(wrapped), wrapIvB64: bufToB64(iv) };
  }

  async function unwrapDekWithKek(wrappedDekB64, wrapIvB64, kek) {
    const wrapped = b64ToBuf(wrappedDekB64);
    const iv = b64ToBuf(wrapIvB64);
    return crypto.subtle.decrypt({ name: "AES-GCM", iv }, kek, wrapped);
  }

  async function syncEnvelopeToBackend(meta, dekB64ForEscrow) {
    try {
      await apiFetch("/vault/envelope", {
        method: "PUT",
        body: JSON.stringify({
          key_id: meta.keyId,
          user_wrapped_dek: meta.wrappedDekB64,
          user_wrap_iv: meta.wrapIvB64,
          wrap_algorithm: "AES-GCM",
          kdf: "PBKDF2-SHA256",
          dek_b64_for_escrow: dekB64ForEscrow || undefined,
        }),
      });
    } catch (_) {
      // Backend sync is best-effort; local vault continues to work offline.
    }
  }

  async function postAudit(action, details) {
    try {
      await apiFetch("/vault/audit/events", {
        method: "POST",
        body: JSON.stringify({ action, details: details || null }),
      });
    } catch (_) {
      // ignore best-effort audit push
    }
  }

  async function fetchRetentionPolicy(force = false) {
    const now = Date.now();
    if (!force && retentionPolicyCache && now - retentionPolicyFetchedAt < POLICY_CACHE_TTL_MS) {
      return retentionPolicyCache;
    }
    try {
      retentionPolicyCache = await apiFetch("/vault/retention");
      retentionPolicyFetchedAt = now;
    } catch (_) {
      retentionPolicyCache = null;
      retentionPolicyFetchedAt = now;
    }
    return retentionPolicyCache;
  }

  async function applyRetentionPolicy() {
    const policy = await fetchRetentionPolicy(false);
    if (!policy || !policy.auto_delete_enabled) return;
    const all = await vaultListRecordings();
    if (!all.length) return;

    const now = Date.now();
    let changed = false;

    const prunedByAge = all.filter((r) => {
      const started = r.startedAt ? Date.parse(r.startedAt) : now;
      const ageDays = (now - started) / (1000 * 60 * 60 * 24);
      return ageDays > policy.max_days;
    });
    for (const item of prunedByAge) {
      await vaultDeleteRecording(item.id);
      changed = true;
    }

    const remaining = (await vaultListRecordings()).sort((a, b) => Date.parse(a.startedAt || 0) - Date.parse(b.startedAt || 0));
    const maxBytes = policy.max_storage_mb * 1024 * 1024;
    let total = remaining.reduce((sum, r) => sum + Number(r.sizePlain || 0), 0);
    for (const item of remaining) {
      if (total <= maxBytes) break;
      await vaultDeleteRecording(item.id);
      total -= Number(item.sizePlain || 0);
      changed = true;
    }

    if (changed) {
      await postAudit("vault_retention_pruned", {
        max_days: policy.max_days,
        max_storage_mb: policy.max_storage_mb,
      });
    }
  }

  async function vaultHasPassword() {
    const meta = await vaultGetMeta();
    return !!meta;
  }

  async function vaultSetPassword(passphrase) {
    if (!passphrase || passphrase.length < 8) {
      throw new Error("Vault password must be at least 8 characters.");
    }
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const kek = await deriveKekFromPassphrase(passphrase, salt);

    const rawDek = crypto.getRandomValues(new Uint8Array(32));
    const dekB64 = bufToB64(rawDek);
    const dekKey = await importDekFromRaw(rawDek);

    const verifyIv = crypto.getRandomValues(new Uint8Array(12));
    const verifyCt = await crypto.subtle.encrypt({ name: "AES-GCM", iv: verifyIv }, kek, VERIFY_PLAINTEXT);
    const { wrappedDekB64, wrapIvB64 } = await wrapDekWithKek(rawDek, kek);

    const meta = {
      key: META_KEY,
      keyId: randomKeyId(),
      saltB64: bufToB64(salt),
      verifyIvB64: bufToB64(verifyIv),
      verifyCtB64: bufToB64(verifyCt),
      wrappedDekB64,
      wrapIvB64,
      kdf: "PBKDF2-SHA256",
      wrapAlgorithm: "AES-GCM",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await putMeta(meta);
    await syncEnvelopeToBackend(meta, dekB64);
    await postAudit("vault_created", { key_id: meta.keyId });

    vaultDekKey = dekKey;
    currentDekB64 = dekB64;
    return true;
  }

  async function vaultUnlock(passphrase) {
    const meta = await vaultGetMeta();
    if (!meta) throw new Error("No vault configured. Create a password first.");
    const salt = b64ToBuf(meta.saltB64);
    const kek = await deriveKekFromPassphrase(passphrase, salt);

    try {
      const plainVerify = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: b64ToBuf(meta.verifyIvB64) },
        kek,
        b64ToBuf(meta.verifyCtB64)
      );
      const verifier = new TextDecoder().decode(plainVerify);
      if (verifier !== "spherecare-vault-v2") {
        throw new Error("Verifier mismatch");
      }
      const rawDek = await unwrapDekWithKek(meta.wrappedDekB64, meta.wrapIvB64, kek);
      vaultDekKey = await importDekFromRaw(rawDek);
      currentDekB64 = bufToB64(rawDek);
      await postAudit("vault_unlock_success", null);
      return true;
    } catch (e) {
      vaultDekKey = null;
      currentDekB64 = null;
      await postAudit("vault_unlock_failed", { reason: "invalid_password" });
      throw new Error("Incorrect vault password.");
    }
  }

  function vaultLock() {
    vaultDekKey = null;
    currentDekB64 = null;
  }

  function vaultIsUnlocked() {
    return !!vaultDekKey;
  }

  async function vaultEncryptArrayBuffer(plainBuffer) {
    if (!vaultDekKey) throw new Error("Vault is locked.");
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, vaultDekKey, plainBuffer);
    return { ivB64: bufToB64(iv), cipherB64: bufToB64(ct) };
  }

  async function vaultDecryptToArrayBuffer(ivB64, cipherB64) {
    if (!vaultDekKey) throw new Error("Vault is locked.");
    return crypto.subtle.decrypt(
      { name: "AES-GCM", iv: b64ToBuf(ivB64) },
      vaultDekKey,
      b64ToBuf(cipherB64)
    );
  }

  async function vaultSaveRecording(meta) {
    console.log("[vaultSave] saving id:", meta.id, "ivB64 len:", meta.ivB64 ? meta.ivB64.length : 0, "cipherB64 len:", meta.cipherB64 ? meta.cipherB64.length : 0);
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_RECORDINGS, "readwrite");
      tx.objectStore(STORE_RECORDINGS).put(meta);
      tx.oncomplete = () => { console.log("[vaultSave] IndexedDB save OK"); resolve(); };
      tx.onerror = () => { console.error("[vaultSave] IndexedDB save FAILED:", tx.error); reject(tx.error); };
    });
    try {
      await apiFetch("/records/vault/upload", {
        method: "POST",
        body: JSON.stringify({
          record_id: meta.id,
          resident_name: "This device",
          category: meta.cameraLabel || "Local camera recording",
          record_type: "video",
          mime_type: meta.mimeType || "video/webm",
          duration: meta.durationMs ? Math.max(1, Math.round(Number(meta.durationMs) / 1000)) : null,
          started_at: meta.startedAt || null,
          ended_at: meta.endedAt || null,
          iv_b64: meta.ivB64,
          cipher_b64: meta.cipherB64,
          notes: "Encrypted local vault recording",
          file_url: `localvault://${meta.id}`,
        }),
      });
    } catch (_) {
      // best effort mirror to server vault; local encrypted save is authoritative
    }
    await applyRetentionPolicy();
    return meta.id;
  }

  async function vaultListRecordings() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_RECORDINGS, "readonly");
      const req = tx.objectStore(STORE_RECORDINGS).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async function vaultDeleteRecording(id) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_RECORDINGS, "readwrite");
      tx.objectStore(STORE_RECORDINGS).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function vaultRequestAdminRecovery(reason) {
    const data = await apiFetch("/vault/recovery/request", {
      method: "POST",
      body: JSON.stringify({ reason: reason || "Password recovery requested from client vault UI" }),
    });
    await postAudit("vault_recovery_requested_client", { request_id: data.id });
    return data;
  }

  async function vaultRecoverWithToken(payload) {
    if (!payload || !payload.requestId || !payload.oneTimeToken || !payload.newPassphrase) {
      throw new Error("requestId, oneTimeToken, and newPassphrase are required.");
    }
    if (payload.newPassphrase.length < 8) {
      throw new Error("New vault password must be at least 8 characters.");
    }
    const recovered = await apiFetch("/vault/recovery/consume", {
      method: "POST",
      body: JSON.stringify({
        request_id: payload.requestId,
        one_time_token: payload.oneTimeToken,
      }),
    });
    const rawDek = b64ToBuf(recovered.dek_b64);
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const kek = await deriveKekFromPassphrase(payload.newPassphrase, salt);
    const verifyIv = crypto.getRandomValues(new Uint8Array(12));
    const verifyCt = await crypto.subtle.encrypt({ name: "AES-GCM", iv: verifyIv }, kek, VERIFY_PLAINTEXT);
    const { wrappedDekB64, wrapIvB64 } = await wrapDekWithKek(rawDek, kek);
    const keyId = recovered.key_id || randomKeyId();

    const meta = {
      key: META_KEY,
      keyId,
      saltB64: bufToB64(salt),
      verifyIvB64: bufToB64(verifyIv),
      verifyCtB64: bufToB64(verifyCt),
      wrappedDekB64,
      wrapIvB64,
      kdf: "PBKDF2-SHA256",
      wrapAlgorithm: "AES-GCM",
      updatedAt: new Date().toISOString(),
      recoveredAt: new Date().toISOString(),
    };
    await putMeta(meta);
    await syncEnvelopeToBackend(meta, recovered.dek_b64);
    vaultDekKey = await importDekFromRaw(rawDek);
    currentDekB64 = recovered.dek_b64;
    await postAudit("vault_recovery_completed_client", { request_id: payload.requestId });
    return true;
  }

  async function vaultRefreshRetentionPolicy() {
    return fetchRetentionPolicy(true);
  }

  global.recordingVault = {
    openDb,
    vaultHasPassword,
    vaultSetPassword,
    vaultUnlock,
    vaultLock,
    vaultIsUnlocked,
    vaultEncryptArrayBuffer,
    vaultDecryptToArrayBuffer,
    vaultSaveRecording,
    vaultListRecordings,
    vaultDeleteRecording,
    vaultRequestAdminRecovery,
    vaultRecoverWithToken,
    vaultRefreshRetentionPolicy,
    postAudit,
    bufToB64,
    b64ToBuf,
  };
})(typeof window !== "undefined" ? window : globalThis);