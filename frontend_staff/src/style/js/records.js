// ────────── SphereCare Records Library JS ──────────

const LOCAL_RECORDING_INDEX_KEY = "spherecare_local_recordings_index_v1";
let records = [];
let currentView = "grid";
let searchTimeout = null;

// ─── Auth ────────────────────────────────────────
function authHeaders() {
  const h = { "Content-Type": "application/json" };
  const t = sessionStorage.getItem("access_token");
  if (t) h["Authorization"] = `Bearer ${t}`;
  return h;
}

// ─── Helpers ─────────────────────────────────────
function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function _showToast(msg) {
  const t = document.createElement("div");
  t.style.cssText = `
    position:fixed;bottom:80px;right:20px;
    background:#0f172a;color:#fff;
    padding:9px 16px;border-radius:10px;
    font-size:13px;font-weight:600;z-index:999999;
    opacity:1;transition:opacity .4s;max-width:320px;
    font-family:Inter,sans-serif;
  `;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => { t.style.opacity = "0"; setTimeout(() => t.remove(), 400); }, 3000);
}

function setView(v) {
  currentView = v;
  document.getElementById("view-grid").style.display = v === "list" ? "none" : "";
  document.getElementById("view-list").style.display = v === "list" ? "" : "none";
  ["grid", "list", "single"].forEach(id => {
    const btn = document.getElementById("vbtn-" + id);
    if (btn) btn.classList.toggle("active", id === v);
  });
  renderAll();
}

function debounceSearch() {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => loadRecords(), 300);
}

function openUploadModal() {
  const m = document.getElementById("modal-upload");
  if (m) m.style.display = "flex";
}

function closeModal(id) {
  const m = document.getElementById(id);
  if (m) m.style.display = "none";
}

// ─── Clock ───────────────────────────────────────
function _tick() {
  const d = new Date();
  const dateEl = document.getElementById("tb-date");
  const timeEl = document.getElementById("tb-time");
  if (dateEl) dateEl.textContent = d.toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" });
  if (timeEl) timeEl.textContent = d.toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit" });
}
_tick();
setInterval(_tick, 1000);

// ─── Local Vault 读取 ────────────────────────────
function loadLocalVaultRecords() {
  const merged = [];
  const seenIds = new Set();
  try {
    const raw = localStorage.getItem(LOCAL_RECORDING_INDEX_KEY);
    const localIndex = raw ? JSON.parse(raw) : [];
    if (Array.isArray(localIndex)) {
      localIndex.forEach(row => {
        const id = String(row.id || "");
        if (!id || seenIds.has(id)) return;
        seenIds.add(id);
        merged.push({
          id,
          resident_name: "This device",
          category: row.cameraLabel || "Local camera recording",
          record_type: "video",
          duration: row.durationMs ? `${Math.max(1, Math.round(row.durationMs / 1000))}s` : "—",
          notes: row.notes || "Encrypted local vault recording",
          recorded_at: row.startedAt || row.createdAt || null,
          created_at: row.createdAt || row.startedAt || null,
          file_url: `localvault://${id}`,
          is_local_vault: true,
        });
      });
    }
  } catch (e) { console.warn("Local vault load failed", e); }
  return { merged, seenIds };
}

// ─── Server Records 读取 ─────────────────────────
async function loadServerRecords(seenIds, merged) {
  try {
    const search   = document.getElementById("rec-search")?.value.trim() || "";
    const category = document.getElementById("f-category")?.value || "";
    const type     = document.getElementById("f-type")?.value || "";

    const params = new URLSearchParams();
    if (search)   params.set("search", search);
    if (category) params.set("category", category);
    if (type)     params.set("record_type", type);
    params.set("limit", "100");

    const res = await fetch(`${API_BASE}/records/?${params}`, { headers: authHeaders() });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    data.forEach(row => {
      const fileUrl = String(row.file_url || "");
      if (fileUrl.startsWith("localvault://")) {
        // vault recording — dedupe by vault id, not numeric db id
        const vaultId = fileUrl.replace("localvault://", "");
        if (seenIds.has(vaultId)) return; // already from localStorage index
        seenIds.add(vaultId);
        merged.push({
          ...row,
          id: vaultId,           // use vault id so openLocalVaultRecord can find it
          _server_id: row.id,    // keep numeric id for server delete
          is_local_vault: true,
        });
      } else {
        const id = String(row.id);
        if (seenIds.has(id)) return;
        seenIds.add(id);
        merged.push({ ...row, id });
      }
    });
  } catch (e) {
    console.warn("Server records load failed", e);
  }
}

// ─── Category dropdown ───────────────────────────
async function loadCategories() {
  try {
    const res = await fetch(`${API_BASE}/records/categories`, { headers: authHeaders() });
    if (!res.ok) return;
    const cats = await res.json();
    const sel = document.getElementById("f-category");
    if (!sel) return;
    const current = sel.value;
    sel.innerHTML = `<option value="">Category</option>` +
      cats.map(c => `<option value="${escapeHtml(c)}" ${c === current ? "selected" : ""}>${escapeHtml(c)}</option>`).join("");
  } catch (e) { /* ignore */ }
}

// ─── AI Insights ─────────────────────────────────
async function loadInsights() {
  try {
    const res = await fetch(`${API_BASE}/records/ai-insights`, { headers: authHeaders() });
    if (!res.ok) return;
    const data = await res.json();
    const high = document.getElementById("ic-high");
    const mid  = document.getElementById("ic-mid");
    const low  = document.getElementById("ic-low");
    if (high) high.textContent = data.high ?? 0;
    if (mid)  mid.textContent  = data.mid  ?? 0;
    if (low)  low.textContent  = data.low  ?? 0;

    const list = document.getElementById("insights-list");
    if (!list) return;
    if (!data.insights?.length) {
      list.innerHTML = `<div style="color:#94a3b8;font-size:12px;padding:12px 0;">No insights yet.</div>`;
      return;
    }
    list.innerHTML = data.insights.map(i => {
      const p = i.priority || "low";
      const dotClass  = p === "high" ? "ins-high" : p === "mid" ? "ins-mid" : "ins-low";
      const pillClass = p === "high" ? "ip-high" : p === "mid" ? "ip-mid" : "ip-low";
      const icon      = p === "high" ? "🔴" : p === "mid" ? "🟡" : "🟢";
      return `
        <div class="insight-item">
          <div class="ins-dot ${dotClass}">${icon}</div>
          <div style="flex:1;min-width:0;">
            <div class="ins-title">${escapeHtml(i.title)}</div>
            <div class="ins-resident">${escapeHtml(i.resident_name || "")}</div>
            <div class="ins-body">${escapeHtml((i.body || "").slice(0, 120))}${(i.body || "").length > 120 ? "…" : ""}</div>
            <div class="ins-meta">
              <span class="ins-priority-pill ${pillClass}">${p.toUpperCase()}</span>
              ${i.is_new ? `<span class="ins-priority-pill" style="background:#eff6ff;color:#1d4ed8;">NEW</span>` : ""}
              <span class="ins-time">${escapeHtml((i.created_at || "").slice(0, 16).replace("T", " "))}</span>
            </div>
          </div>
        </div>
      `;
    }).join("");
  } catch (e) { /* ignore */ }
}

// ─── 主加载 ──────────────────────────────────────
async function loadRecords() {
  const { merged, seenIds } = loadLocalVaultRecords();
  await loadServerRecords(seenIds, merged);

  merged.sort((a, b) => {
    const aTs = Date.parse(a.created_at || a.recorded_at || 0) || 0;
    const bTs = Date.parse(b.created_at || b.recorded_at || 0) || 0;
    return bTs - aTs;
  });

  records = merged;
  renderAll();

  const skeleton = document.getElementById("page-skeleton");
  if (skeleton) skeleton.style.display = "none";
}

// ─── 渲染 ────────────────────────────────────────
function renderAll() {
  const grid  = document.getElementById("view-grid");
  const tbody = document.getElementById("rec-tbody");
  const empty = document.getElementById("empty-state");

  // client-side filter (covers local vault rows that bypass server search)
  const search     = (document.getElementById("rec-search")?.value || "").toLowerCase();
  const typeFilter = document.getElementById("f-type")?.value || "";

  const filtered = records.filter(r => {
    const matchSearch = !search ||
      (r.category || "").toLowerCase().includes(search) ||
      (r.resident_name || "").toLowerCase().includes(search) ||
      (r.notes || "").toLowerCase().includes(search);
    const matchType = !typeFilter || r.record_type === typeFilter;
    return matchSearch && matchType;
  });

  if (!filtered.length) {
    if (grid)  grid.innerHTML  = "";
    if (tbody) tbody.innerHTML = "";
    if (empty) empty.style.display = "";
    return;
  }
  if (empty) empty.style.display = "none";

  // ── Grid / Single view ──
  if (grid && currentView !== "list") {
    grid.innerHTML = filtered.map(r => {
      const isVault  = r.is_local_vault || String(r.file_url || "").startsWith("localvault://");
      const safeId   = escapeHtml(String(r.id));
      const rtype    = r.record_type || "video";
      const dateStr  = (r.recorded_at || r.created_at || "").slice(0, 16).replace("T", "  ") || "—";
      const duration = escapeHtml(r.duration || "—");

      // thumbnail by type
      let thumb;
      if (rtype === "document") {
        thumb = `
          <div class="rec-thumb-doc">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#6d28d9" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
            </svg>
            <span class="type-badge-abs rtb-document">DOC</span>
          </div>`;
      } else if (rtype === "audio") {
        thumb = `
          <div class="rec-thumb-audio">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#1d4ed8" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
              <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
            </svg>
            <span class="type-badge-abs rtb-audio">AUDIO</span>
          </div>`;
      } else {
        // video / vault — CCTV sim
        const emojis = ["🚶","👩","🧓","🧑‍🦽"];
        const fig = emojis[Math.abs(String(r.id).charCodeAt(0) || 0) % emojis.length];
        thumb = `
          <div class="rec-thumb" onclick="viewRecord('${safeId}')">
            <div class="cctv-bg"></div>
            <div class="cctv-grid-lines"></div>
            <div class="cctv-fig">${fig}</div>
            <div class="cctv-scan"></div>
            <div class="cctv-ts">${escapeHtml(dateStr)}</div>
            <div class="cctv-rec-badge"><div class="rec-dot"></div>REC</div>
            <span class="type-badge-abs ${isVault ? "rtb-video" : "rtb-video"}">${isVault ? "🔐 VAULT" : "VIDEO"}</span>
          </div>`;
      }

      return `
        <div class="rec-card">
          ${thumb}
          <div class="rec-info">
            <div class="rec-name">${escapeHtml(r.resident_name || "This device")}</div>
            <div class="rec-category">${escapeHtml(r.category || "Recording")}</div>
            <div class="rec-datetime">${escapeHtml(dateStr)} · ${duration}</div>
            <div class="rec-notes">${escapeHtml(r.notes || "—")}</div>
            <div class="rec-actions-row">
              <button type="button" class="ra-btn view" onclick="viewRecord('${safeId}')">
                <svg viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                View
              </button>
              <button type="button" class="ra-btn dl" onclick="downloadRecord('${safeId}')">
                <svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                Download
              </button>
              <button type="button" class="ra-btn btn-danger-outline" onclick="deleteRecord('${safeId}')"
                style="flex:0;padding:0 10px;">
                <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
              </button>
            </div>
          </div>
        </div>
      `;
    }).join("");
  }

  // ── List view ──
  if (tbody && currentView === "list") {
    tbody.innerHTML = filtered.map(r => {
      const isVault = r.is_local_vault || String(r.file_url || "").startsWith("localvault://");
      const safeId  = escapeHtml(String(r.id));
      const rtype   = r.record_type || "video";
      const typeClass = rtype === "audio" ? "tp-audio" : rtype === "document" ? "tp-document" : "tp-video";
      return `
        <tr>
          <td><strong>${escapeHtml(r.resident_name || "—")}</strong></td>
          <td>${escapeHtml(r.category || "—")} ${isVault ? "🔐" : ""}</td>
          <td><span class="type-pill ${typeClass}">${escapeHtml(rtype)}</span></td>
          <td>${escapeHtml(r.duration || "—")}</td>
          <td>${escapeHtml((r.recorded_at || r.created_at || "").slice(0, 16).replace("T", " ") || "—")}</td>
          <td>${escapeHtml((r.notes || "").slice(0, 60))}${(r.notes || "").length > 60 ? "…" : ""}</td>
          <td>
            <div style="display:flex;gap:6px;">
              <button type="button" class="tbl-btn" title="View" onclick="viewRecord('${safeId}')">
                <svg viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg>
              </button>
              <button type="button" class="tbl-btn dl" title="Download" onclick="downloadRecord('${safeId}')">
                <svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              </button>
              <button type="button" class="tbl-btn" title="Delete" onclick="deleteRecord('${safeId}')"
                style="border-color:#fecaca;color:#b91c1c;" onmouseover="this.style.background='#fef2f2'" onmouseout="this.style.background=''">
                <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join("");
  }
}

// ─── View / Download ─────────────────────────────
async function viewRecord(id) {
  const r = records.find(x => String(x.id) === String(id));
  if (!r) return;
  if (r.is_local_vault || String(r.file_url || "").startsWith("localvault://")) {
    await openLocalVaultRecord(r, false);
    return;
  }
  if (r.file_url && r.file_url !== "#") window.open(r.file_url, "_blank");
  else alert("No file URL available for this record.");
}

async function downloadRecord(id) {
  const r = records.find(x => String(x.id) === String(id));
  if (!r) return;
  if (r.is_local_vault || String(r.file_url || "").startsWith("localvault://")) {
    await openLocalVaultRecord(r, true);
    return;
  }
  if (r.file_url && r.file_url !== "#") {
    const a = document.createElement("a");
    a.href = r.file_url;
    a.download = `${r.category || "record"}_${r.resident_name || "resident"}`;
    a.click();
  } else alert("No file available to download.");
}

// ─── Vault 解密播放/下载 ─────────────────────────
async function openLocalVaultRecord(r, download) {
  const vault = window.recordingVault;

  if (!vault || !vault.vaultIsUnlocked()) {
    _showToast("🔒 Vault locked — please unlock first.");
    if (typeof unlockVaultFromConsole === "function") {
      setTimeout(() => unlockVaultFromConsole(), 200);
    } else {
      _showVaultUnlockPrompt(() => openLocalVaultRecord(r, download));
    }
    return;
  }

  _showToast("🔓 Decrypting…");

  try {
    const rawId    = String(r.file_url || r.id);
    const recordId = rawId.startsWith("localvault://") ? rawId.replace("localvault://", "") : rawId;

    const all   = await vault.vaultListRecordings();
    const entry = all.find(v => v.id === recordId);

    if (!entry) {
      alert("Recording not found in vault.\nIt may have been recorded in a different browser or the vault was reset.");
      return;
    }

    const plain  = await vault.vaultDecryptToArrayBuffer(entry.ivB64, entry.cipherB64);
    const mime   = entry.mimeType || "video/webm";
    const blob   = new Blob([plain], { type: mime });
    const blobUrl = URL.createObjectURL(blob);

    if (download) {
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = `${r.category || "recording"}_${recordId.slice(0, 8)}.webm`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
      _showToast("⬇ Download started");
    } else {
      _showVaultPlayerModal(r, blobUrl);
    }
  } catch (err) {
    console.error("[vault] openLocalVaultRecord failed:", err);
    alert("Failed to decrypt recording. Make sure the vault is unlocked with the correct password.");
  }
}

function _showVaultPlayerModal(r, blobUrl) {
  const existing = document.getElementById("_vault_player_modal");
  if (existing) existing.remove();

  const modal = document.createElement("div");
  modal.id = "_vault_player_modal";
  modal.style.cssText = `
    position:fixed;inset:0;z-index:999999;
    background:rgba(0,0,0,0.82);
    display:flex;align-items:center;justify-content:center;
  `;
  modal.innerHTML = `
    <div style="background:#0b1220;border-radius:18px;padding:20px;max-width:860px;width:96%;position:relative;">
      <div style="font-size:15px;font-weight:800;color:#fff;margin-bottom:14px;">
        🔓 ${escapeHtml(r.category || "Recording")}
        <span style="font-size:11px;font-weight:500;color:#94a3b8;margin-left:8px;">
          ${escapeHtml(r.resident_name || "This device")}
        </span>
      </div>
      <video src="${blobUrl}" controls autoplay playsinline
        style="width:100%;border-radius:10px;max-height:68vh;background:#000;"></video>
      <button id="_vault_close_btn"
        style="position:absolute;top:16px;right:16px;
          background:#1e293b;border:none;color:#94a3b8;
          border-radius:50%;width:32px;height:32px;
          font-size:18px;cursor:pointer;line-height:1;">×</button>
    </div>
  `;
  document.body.appendChild(modal);

  const closeAndRevoke = () => { modal.remove(); URL.revokeObjectURL(blobUrl); };
  document.getElementById("_vault_close_btn").addEventListener("click", closeAndRevoke);
  modal.addEventListener("click", e => { if (e.target === modal) closeAndRevoke(); });
}

// Records Library 页面独立的 vault 解锁弹窗
function _showVaultUnlockPrompt(onSuccess) {
  const existing = document.getElementById("_vault_unlock_prompt");
  if (existing) existing.remove();

  const modal = document.createElement("div");
  modal.id = "_vault_unlock_prompt";
  modal.style.cssText = `
    position:fixed;inset:0;z-index:999999;
    background:rgba(0,0,0,0.6);
    display:flex;align-items:center;justify-content:center;
  `;
  modal.innerHTML = `
    <div style="background:#fff;border-radius:18px;padding:28px 32px;max-width:400px;width:92%;
      font-family:Inter,sans-serif;box-shadow:0 20px 60px rgba(0,0,0,0.2);">
      <div style="font-size:17px;font-weight:800;margin-bottom:6px;">🔐 Unlock Vault</div>
      <div style="font-size:13px;color:#64748b;margin-bottom:18px;">
        Enter your vault password to decrypt this recording.
      </div>
      <input id="_vault_prompt_input" type="password" placeholder="Vault password"
        style="width:100%;padding:10px 14px;border-radius:10px;border:1.5px solid #e2e8f0;
          font-size:14px;margin-bottom:10px;box-sizing:border-box;"/>
      <div id="_vault_prompt_err" style="color:#b91c1c;font-size:12px;min-height:16px;margin-bottom:10px;"></div>
      <div style="display:flex;gap:10px;">
        <button id="_vault_prompt_cancel"
          style="flex:1;padding:10px;border-radius:10px;border:1.5px solid #e2e8f0;
            background:#fff;cursor:pointer;font-size:13px;font-weight:600;">Cancel</button>
        <button id="_vault_prompt_submit"
          style="flex:1;padding:10px;border-radius:10px;border:none;
            background:#0f172a;color:#fff;cursor:pointer;font-size:13px;font-weight:700;">Unlock</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const input  = document.getElementById("_vault_prompt_input");
  const errEl  = document.getElementById("_vault_prompt_err");
  const submit = document.getElementById("_vault_prompt_submit");
  const cancel = document.getElementById("_vault_prompt_cancel");

  const close = () => modal.remove();
  cancel.addEventListener("click", close);
  modal.addEventListener("click", e => { if (e.target === modal) close(); });

  const tryUnlock = async () => {
    const pass = input.value.trim();
    if (!pass) { errEl.textContent = "Please enter a password."; return; }
    submit.disabled = true;
    submit.textContent = "Unlocking…";
    errEl.textContent = "";
    try {
      const vault = window.recordingVault;
      if (!await vault.vaultHasPassword()) {
        errEl.textContent = "No vault configured. Record in Recording Console first.";
        submit.disabled = false; submit.textContent = "Unlock"; return;
      }
      await vault.vaultUnlock(pass);
      _showToast("🔓 Vault unlocked");
      close();
      if (onSuccess) onSuccess();
    } catch (err) {
      errEl.textContent = "Incorrect password.";
      submit.disabled = false; submit.textContent = "Unlock";
      input.focus();
    }
  };

  submit.addEventListener("click", tryUnlock);
  input.addEventListener("keydown", e => { if (e.key === "Enter") tryUnlock(); });
  setTimeout(() => input.focus(), 80);
}

// ─── Delete ──────────────────────────────────────
async function deleteRecord(id) {
  const r = records.find(x => String(x.id) === String(id));
  if (!r) return;
  const ok = confirm(`Delete this recording?\n\n${r.category || "Video"}\n${r.resident_name || "—"}`);
  if (!ok) return;

  try {
    if (r.is_local_vault || String(r.file_url || "").startsWith("localvault://")) {
      const rawId   = String(r.file_url || r.id);
      const vaultId = rawId.startsWith("localvault://") ? rawId.replace("localvault://", "") : rawId;
      if (window.recordingVault?.vaultDeleteRecording) {
        await window.recordingVault.vaultDeleteRecording(vaultId).catch(() => {});
      }
      const raw  = localStorage.getItem(LOCAL_RECORDING_INDEX_KEY);
      const list = raw ? JSON.parse(raw) : [];
      localStorage.setItem(LOCAL_RECORDING_INDEX_KEY,
        JSON.stringify(list.filter(x => String(x.id) !== vaultId)));
    }

    // server delete — use numeric _server_id if available
    const serverId = r._server_id ?? id;
    const res = await fetch(`${API_BASE}/records/${encodeURIComponent(serverId)}`, {
      method: "DELETE", headers: authHeaders(),
    });
    if (!res.ok && res.status !== 404) throw new Error(`HTTP ${res.status}`);

    records = records.filter(x => String(x.id) !== String(id));
    renderAll();
    _showToast("🗑 Deleted.");
  } catch (e) {
    console.warn("Delete failed", e);
    _showToast("⚠ Delete failed.");
  }
}

// ─── Upload ──────────────────────────────────────
async function submitUpload() {
  const resident  = document.getElementById("up-resident")?.value.trim();
  const category  = document.getElementById("up-category")?.value.trim();
  const type      = document.getElementById("up-type")?.value;
  const url       = document.getElementById("up-url")?.value.trim();
  const duration  = document.getElementById("up-duration")?.value.trim();
  const date      = document.getElementById("up-date")?.value;
  const time      = document.getElementById("up-time")?.value;
  const notes     = document.getElementById("up-notes")?.value.trim();
  const errEl     = document.getElementById("up-err");
  const submitBtn = document.getElementById("up-submit");

  if (errEl) errEl.textContent = "";
  if (!resident || !category || !type || !url) {
    if (errEl) errEl.textContent = "Resident, Category, Type, and File URL are required.";
    return;
  }

  const recorded_at = date ? (time ? `${date}T${time}` : date) : null;

  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "Saving…"; }
  try {
    const res = await fetch(`${API_BASE}/records/`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ resident_name: resident, category, record_type: type, file_url: url, duration, recorded_at, notes }),
    });
    if (!res.ok) throw new Error((await res.text().catch(() => "")) || `HTTP ${res.status}`);
    closeModal("modal-upload");
    _showToast("✅ Record uploaded.");
    await loadRecords();
  } catch (err) {
    if (errEl) errEl.textContent = `Failed: ${err.message}`;
  } finally {
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Upload Record"; }
  }
}

// ─── Init ─────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
  await Promise.all([loadRecords(), loadCategories(), loadInsights()]);
});