// CONFIG
let facilityCameras = [];
let cameras = [];
let recordings = [];
/** All videos under scvam_input/jobs — used for the SCVAM script dropdown. */
let stagingJobVideos = [];
let _stagingFetchSeq = 0;
let alertsData = [];

let alertFilterOn = false;
let filteredCameras = [];
let isPlaying = false;
let progressInterval = null;
let activeHls = null;
let modalPlaybackIndex = -1;
const MODAL_SKIP_SECONDS = 10;
let activeInlinePlaybackId = null;
let inlinePlaybackRequestToken = 0;
let _playbackScriptRequestSeq = 0;
let _stagingDeleteTarget = null;
let pendingPlaybackFromUrl = null;

const localCamStreams = new Map();
const LOCAL_RECORDING_INDEX_KEY = "spherecare_local_recordings_index_v1";
const _activeRecorders = new Map();
/** Minimum clip length to send for SCVAM when AI is on (seconds). */
let SCVA_MIN_AI_SECONDS = 1;
const DELETE_CONFIRM_WORD = "Confirm";
let _playbackDeleteTargetId = null;
let _scvamPollTimer = null;
let _scvamPollRecordId = null;
/** Rolling segment flush interval while recording (default 2 min; overridable via API). */
let SCVA_ANALYSIS_CHUNK_SECONDS = 120;
const CAMERA_AI_STORAGE_KEY = "spherecare_camera_ai_v1";
const cameraAiState = new Map();

function isStagingPlaybackId(id) {
  return String(id || "").startsWith("staging:");
}

function stagingKeyFromId(id) {
  const raw = String(id || "");
  if (raw.startsWith("staging:job:")) {
    const jobId = raw.slice("staging:job:".length);
    const item = stagingJobVideos.find((r) => String(r.jobId || "") === jobId);
    if (item) {
      return { folder: item.stagingFolder || "", video: item.stagingVideo || null };
    }
  }
  const rest = raw.slice("staging:".length);
  const pipe = rest.indexOf("|");
  if (pipe !== -1) {
    const folder = rest.slice(0, pipe);
    const tag = rest.slice(pipe + 1);
    const video = tag.startsWith("@") ? "" : tag;
    return { folder, video: video || null };
  }
  const colon = rest.indexOf(":");
  if (colon === -1) return { folder: rest, video: null };
  return { folder: rest.slice(0, colon), video: rest.slice(colon + 1) || null };
}

function stagingPlaybackIdFromRow(s) {
  const folder = String(s?.folder_name || "");
  const video = String(s?.video_name || "").trim();
  if (s?.job_id != null && s.job_id !== "") {
    return `staging:job:${s.job_id}`;
  }
  if (video) return `staging:${folder}|${video}`;
  const label = String(s?.label || folder).trim();
  return `staging:${folder}|@${label}`;
}

function stagingPlaybackId(folderName, videoName, label) {
  return stagingPlaybackIdFromRow({
    folder_name: folderName,
    video_name: videoName,
    label: label || folderName,
  });
}

function findPlaybackItem(id) {
  const key = String(id || "");
  return (
    stagingJobVideos.find((r) => String(r.id) === key) ||
    recordings.find((r) => String(r.id) === key) ||
    null
  );
}

function beginPlaybackScriptRequest(id) {
  const seq = ++_playbackScriptRequestSeq;
  return { seq, id: String(id || "") };
}

function currentPlaybackScriptRequest(id) {
  return { seq: _playbackScriptRequestSeq, id: String(id || "") };
}

function isPlaybackScriptRequestCurrent(req) {
  return (
    !!req &&
    req.seq === _playbackScriptRequestSeq &&
    String(activeInlinePlaybackId) === req.id
  );
}

function isActivePlaybackId(id) {
  return String(activeInlinePlaybackId) === String(id || "");
}

function stagingVideoForPlayback(id) {
  const rec = findPlaybackItem(id);
  const parsed = stagingKeyFromId(id);
  return parsed.video || rec?.stagingVideo || null;
}

function stagingFolderForPlayback(id) {
  const rec = findPlaybackItem(id);
  const parsed = stagingKeyFromId(id);
  return parsed.folder || rec?.stagingFolder || "";
}

function stagingVideoFromId(id) {
  return stagingKeyFromId(id).video;
}

function stagingVideoQuery(videoName) {
  return videoName ? `?video_name=${encodeURIComponent(videoName)}` : "";
}

function stagingVideoApiUrl(folderName, videoName) {
  return `${API_BASE}/records/scvam-staging/${encodeURIComponent(folderName)}/video${stagingVideoQuery(videoName)}`;
}

function stagingScriptApiUrl(folderName, videoName) {
  return `${API_BASE}/records/scvam-staging/${encodeURIComponent(folderName)}/script${stagingVideoQuery(videoName)}`;
}

function stagingAnalyzeApiUrl(folderName, videoName) {
  return `${API_BASE}/records/scvam-staging/${encodeURIComponent(folderName)}/analyze${stagingVideoQuery(videoName)}`;
}

function stagingDeleteApiUrl(folderName, videoName, outputOnly = true) {
  const params = new URLSearchParams();
  if (videoName) params.set("video_name", videoName);
  if (outputOnly) params.set("output_only", "true");
  const qs = params.toString();
  return `${API_BASE}/records/scvam-staging/${encodeURIComponent(folderName)}${qs ? `?${qs}` : ""}`;
}

// AUTH
function getAccessToken() {
  return (
    sessionStorage.getItem("access_token") ||
    sessionStorage.getItem("spherecare_token") ||
    ""
  );
}

function authHeaders() {
  const h = { "Content-Type": "application/json" };
  const t = getAccessToken();
  if (t) h["Authorization"] = `Bearer ${t}`;
  return h;
}

function redirectToLogin(reason) {
  sessionStorage.removeItem("access_token");
  sessionStorage.removeItem("spherecare_token");
  sessionStorage.removeItem("spherecare_logged_in");
  const returnTo = encodeURIComponent(
    window.location.pathname + window.location.search
  );
  const q = reason ? `&msg=${encodeURIComponent(reason)}` : "";
  window.location.href = `/pages/register-login.html?return=${returnTo}${q}`;
}

/** Returns true if response was 401 (redirect triggered). */
function handleUnauthorizedResponse(res) {
  if (res && res.status === 401) {
    redirectToLogin("Session expired. Please log in again.");
    return true;
  }
  return false;
}

function localVaultIdFromFileUrl(fileUrl) {
  const u = String(fileUrl || "");
  if (!u.startsWith("localvault://")) return null;
  return u.slice("localvault://".length) || null;
}

/** Map local vault id (rec_…) → server record row for SCVAM script / status. */
function localVaultIdFromRec(rec) {
  const url = String(rec?.file_url || rec?.fileUrl || "");
  if (url.startsWith("localvault://")) return url.slice("localvault://".length);
  if (String(rec?.id || "").startsWith("rec_")) return String(rec.id);
  return null;
}

function resolveServerIdForRecording(rec) {
  if (!rec) return null;
  if (/^\d+$/.test(String(rec.id))) return String(rec.id);
  const localId = localVaultIdFromRec(rec);
  if (!localId) return null;
  const match = recordings.find(
    (x) => /^\d+$/.test(String(x.id)) && localVaultIdFromRec(x) === localId
  );
  return match ? String(match.id) : null;
}

async function removeLocalVaultById(localId) {
  if (!localId) return;
  if (window.recordingVault?.vaultDeleteRecording) {
    try {
      await window.recordingVault.vaultDeleteRecording(String(localId));
    } catch (_) {}
  }
  try {
    const raw = localStorage.getItem(LOCAL_RECORDING_INDEX_KEY);
    const index = raw ? JSON.parse(raw) : [];
    if (Array.isArray(index)) {
      localStorage.setItem(
        LOCAL_RECORDING_INDEX_KEY,
        JSON.stringify(index.filter((row) => String(row?.id) !== String(localId)))
      );
    }
  } catch (_) {}
}

async function deleteServerRecordById(serverId) {
  const res = await fetch(`${API_BASE}/records/${encodeURIComponent(serverId)}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (handleUnauthorizedResponse(res)) return false;
  if (!res.ok && res.status !== 204) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Delete failed (HTTP ${res.status})`);
  }
  return true;
}

function dropRecordingsFromState({ localId, serverId, primaryId }) {
  recordings = recordings.filter((x) => {
    const xLocal = localVaultIdFromRec(x);
    if (localId && xLocal === localId) return false;
    if (serverId && String(x.id) === String(serverId)) return false;
    if (primaryId && String(x.id) === String(primaryId)) return false;
    return true;
  });
}

function resolveServerRecording(localOrServerId) {
  const id = String(localOrServerId);
  const direct = recordings.find((r) => String(r.id) === id);
  if (direct && /^\d+$/.test(String(direct.id))) return direct;
  return (
    recordings.find(
      (r) =>
        /^\d+$/.test(String(r.id)) &&
        (r.vaultLocalId === id || localVaultIdFromFileUrl(r.fileUrl) === id)
    ) || direct
  );
}

// PER-CAMERA AI TOGGLE (Recording Console card actions)
function loadCameraAiState() {
  try {
    const raw = localStorage.getItem(CAMERA_AI_STORAGE_KEY);
    if (!raw) return;
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== "object") return;
    Object.entries(obj).forEach(([key, enabled]) => {
      cameraAiState.set(String(key), !!enabled);
    });
  } catch (e) {
    console.warn("Could not load camera AI preferences:", e);
  }
}

function saveCameraAiState() {
  const obj = {};
  cameraAiState.forEach((enabled, key) => {
    obj[key] = enabled;
  });
  localStorage.setItem(CAMERA_AI_STORAGE_KEY, JSON.stringify(obj));
}

function getCameraAiKey(cam) {
  return String(cam?.id ?? cam?.deviceId ?? "");
}

function isCameraAiEnabled(camKey) {
  return cameraAiState.get(String(camKey)) === true;
}

function setCameraAiEnabled(camKey, enabled) {
  cameraAiState.set(String(camKey), !!enabled);
  saveCameraAiState();
  updateCamAiButton(camKey);
}

function buildCamAiButton(camKey) {
  const key = String(camKey);
  const on = isCameraAiEnabled(key);
  const stateClass = on ? "is-on" : "is-off";
  const title = on
    ? "AI monitoring on — click to turn off"
    : "AI monitoring off — click to turn on";

  return `
    <button
      type="button"
      class="cam-btn cam-btn-ai js-cam-action ${stateClass}"
      title="${title}"
      data-action="ai-toggle"
      data-cam-key="${escapeHtml(key)}"
      id="ai-btn-${escapeHtml(encodeURIComponent(key))}"
      aria-pressed="${on ? "true" : "false"}"
    >
      <span class="cam-ai-label">AI</span>
    </button>
  `;
}

function updateCamAiButton(camKey) {
  const btn = document.getElementById("ai-btn-" + encodeURIComponent(String(camKey)));
  if (!btn) return;

  const on = isCameraAiEnabled(camKey);
  btn.classList.toggle("is-on", on);
  btn.classList.toggle("is-off", !on);
  btn.setAttribute("aria-pressed", on ? "true" : "false");
  btn.title = on
    ? "AI monitoring on — click to turn off"
    : "AI monitoring off — click to turn on";
}

function toggleCameraAi(camKey) {
  const next = !isCameraAiEnabled(camKey);
  setCameraAiEnabled(camKey, next);
  _showToast(next ? "AI monitoring enabled for this camera" : "AI monitoring disabled for this camera");
}

// CLEAN CAMERA LABEL
function cleanCameraLabel(label) {
  return String(label || "")
    .replace(/\s*\([0-9a-fA-F]{4}:[0-9a-fA-F]{4}\)\s*/g, "")
    .trim();
}

// SAFE HTML
function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// TOAST
function _showToast(msg) {
  const t = document.createElement("div");

  t.style.cssText = `
    position: fixed;
    bottom: 80px;
    right: 20px;
    background: #0f172a;
    color: #fff;
    padding: 9px 16px;
    border-radius: 10px;
    font-size: 13px;
    font-weight: 600;
    z-index: 999999;
    opacity: 1;
    transition: opacity .4s;
    max-width: 320px;
    font-family: Inter, sans-serif;
  `;

  t.textContent = msg;
  document.body.appendChild(t);

  setTimeout(() => {
    t.style.opacity = "0";

    setTimeout(() => {
      t.remove();
    }, 400);
  }, 3000);
}

// MERGE LOCAL + FACILITY CAMERAS
function mergeCameras() {
  const localCards = [];
  let idx = 0;

  localCamStreams.forEach((stream, deviceId) => {
    const track = stream.getVideoTracks()[0];
    const rawLabel = track?.label || `Local Camera ${idx + 1}`;
    const cleanLabel = cleanCameraLabel(rawLabel) || `Local Camera ${idx + 1}`;

    localCards.push({
      id: `local:${deviceId}`,
      source: "local",
      deviceId,
      localPreviewStream: stream,
      title: cleanLabel,
      resident: "This device",
      floor: "Local",
      status: "live",
      alert: "fine",
      desc: "Browser camera input",
      streamUrl: null,
    });

    idx++;
  });

  cameras = [
    ...localCards,
    ...facilityCameras.map((c) => ({
      ...c,
      source: "facility",
    })),
  ];

  filteredCameras = applyFilters(cameras);
  renderCameras();

  updateStatsFromFrontend();
}

// FRONTEND CAMERA STATS
function updateStatsFromFrontend(apiStats = null) {
  const totalFromFrontend = cameras.length;
  const onlineFromFrontend = cameras.filter((c) => c.status === "live").length;

  const stTotal = document.getElementById("st-total");
  const stOnline = document.getElementById("st-online");
  const stAlerts = document.getElementById("st-alerts");
  const stEvents = document.getElementById("st-events");
  const badge = document.querySelector(".alert-badge");

  if (stTotal) {
    stTotal.textContent = totalFromFrontend;
  }

  if (stOnline) {
    stOnline.textContent = onlineFromFrontend;
  }

  if (stAlerts) {
    stAlerts.textContent = apiStats?.active_alerts ?? 0;
  }

  if (stEvents) {
    stEvents.textContent = apiStats?.events_24h ?? 0;
  }

  if (badge) {
    badge.textContent = apiStats?.active_alerts ?? 0;
  }
}

// API — CAMERAS
async function loadFacilityCameras() {
  try {
    const res = await fetch(`${API_BASE}/cameras/`, {
      headers: authHeaders(),
    });

    if (!res.ok) throw new Error(res.status);

    const data = await res.json();

    facilityCameras = data.map((c) => ({
      id: c.id,
      title: c.title,
      resident: c.resident_name || "Common Area",
      floor: c.floor || "",
      status: (c.stream_status || c.status || "offline") === "live" ? "live" : "offline",
      alert: c.alert || "fine",
      desc: c.description || "",
      streamUrl: c.stream_url || null,
    }));

    showApiStatus(true);
  } catch (e) {
    console.warn("Camera API unavailable:", e);
    facilityCameras = [];
    showGridError("camera-grid", "cameras");
    showApiStatus(false);
  }

  mergeCameras();
}

// LOCAL CAMERA LOAD
async function loadLocalCameras() {
  if (!navigator.mediaDevices?.getUserMedia) {
    mergeCameras();
    return;
  }

  for (const s of localCamStreams.values()) {
    s.getTracks().forEach((t) => t.stop());
  }

  localCamStreams.clear();

  try {
    const temp = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: false,
    });

    temp.getTracks().forEach((t) => t.stop());
  } catch (e) {
    console.warn("Camera permission not granted:", e);
  }

  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const cams = devices.filter((d) => d.kind === "videoinput");

    for (const cam of cams) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            deviceId: cam.deviceId ? { exact: cam.deviceId } : undefined,
          },
          audio: false,
        });

        localCamStreams.set(
          cam.deviceId || `cam_${localCamStreams.size + 1}`,
          stream
        );
      } catch (e) {
        console.warn("Failed to open local camera:", e);
      }
    }
  } catch (e) {
    console.warn("Local camera enumerate failed:", e);
  }

  mergeCameras();
}

// API — STATS
async function loadStats() {
  let apiStats = {
    active_alerts: 0,
    events_24h: 0,
  };

  try {
    const res = await fetch(`${API_BASE}/cameras/stats`, {
      headers: authHeaders(),
    });

    if (res.ok) {
      apiStats = await res.json();
    }
  } catch (e) {
    console.warn("Stats API unavailable, using frontend camera count only:", e);
  }

  updateStatsFromFrontend(apiStats);
}

// API — PLAYBACK
function isScvamStagingDbRecord(r) {
  const cat = String(r?.category || r?.title || "");
  const url = String(r?.file_url || r?.fileUrl || "");
  return cat.startsWith("SCVAM staging:") || url.startsWith("localvault://staging_");
}

let _loadPlaybackToken = 0;

function shouldSkipStagingDropdownRow(s) {
  if (!s?.folder_name || !s?.video_name) return false;
  return isPipelineStagingVideo(s.video_name) && !String(s.folder_name).startsWith("rec_");
}

function stagingItemFromApiRow(s) {
  const videoName = String(s.video_name || "").trim();
  const id = stagingPlaybackIdFromRow(s);
  return {
    id,
    jobId: s.job_id != null ? String(s.job_id) : null,
    title: s.label || videoStem(videoName) || s.folder_name,
    resident: "Test video",
    date: "—",
    duration: s.duration_sec ? `${s.duration_sec}s` : "—",
    flag: "none",
    type: "Staging job",
    fileUrl: videoName
      ? `staging://${s.folder_name}/${videoName}`
      : `staging://${s.folder_name}`,
    vaultLocalId: null,
    scvamStatus: s.scvam_status || "none",
    aiSummary: "",
    source: "staging",
    stagingFolder: s.folder_name,
    stagingVideo: videoName || null,
    stagingMime: videoName?.toLowerCase().endsWith(".webm") ? "video/webm" : "video/mp4",
  };
}

async function refreshStagingJobVideos() {
  const seq = ++_stagingFetchSeq;
  try {
    const res = await fetch(`${API_BASE}/records/scvam-staging?_=${Date.now()}`, {
      headers: authHeaders(),
      cache: "no-store",
    });
    if (handleUnauthorizedResponse(res)) return stagingJobVideos;
    if (!res.ok) {
      console.warn("SCVAM staging list failed:", res.status, await res.text());
      return stagingJobVideos;
    }
    const stagingPayload = await res.json();
    const stagingRows = Array.isArray(stagingPayload) ? stagingPayload : [];
    const items = [];
    const seenIds = new Set();
    stagingRows.forEach((s) => {
      if (shouldSkipStagingDropdownRow(s)) return;
      const item = stagingItemFromApiRow(s);
      if (seenIds.has(item.id)) return;
      seenIds.add(item.id);
      items.push(item);
    });
    if (seq !== _stagingFetchSeq) return stagingJobVideos;
    stagingJobVideos = items.sort(stagingDropdownSort);
    console.info("[SCVAM staging] loaded", stagingJobVideos.length, "videos");
    renderPlaybackScriptList(activeInlinePlaybackId || defaultStagingScriptId());
    return stagingRows;
  } catch (e) {
    console.warn("SCVAM staging list unavailable:", e);
    return stagingJobVideos;
  }
}

function defaultStagingScriptId() {
  const preferred = stagingJobVideos.filter((r) =>
    ["testing", "test"].includes(String(r.stagingFolder || "")),
  );
  return preferred[0]?.id || stagingJobVideos[0]?.id || "";
}

function stagingScriptItemSub(rec) {
  if (!rec) return "—";
  const folder = rec.stagingFolder || "";
  if (folder && !["testing", "test"].includes(folder)) return folder;
  return `${rec.duration || "—"} · ${formatScvamStatusLabel(rec.scvamStatus)}`;
}

function stagingScriptOptionLabel(rec) {
  return `${playbackItemTitle(rec)} — ${stagingScriptItemSub(rec)}`;
}

function isPipelineStagingVideo(name) {
  const stem = videoStem(name).toLowerCase();
  return stem === "input" || stem.startsWith("input.");
}

function isSegmentStagingFolder(name) {
  return String(name || "").startsWith("rec_");
}

function isSegmentPlaybackItem(r) {
  const text = `${r?.title || ""} ${r?.type || ""} ${r?.category || ""}`.toLowerCase();
  if (text.includes("segment")) return true;
  const id = String(r?.vaultLocalId || r?.id || r?.fileUrl || "");
  return /_s\d+$/i.test(id) || /\(segment\s*\d+\)/i.test(text);
}

async function loadPlayback() {
  const loadToken = ++_loadPlaybackToken;
  const mergedPlayback = [];
  const seenIds = new Set();
  const serverByVaultId = new Map();

  try {
    const res = await fetch(`${API_BASE}/records/?record_type=video&limit=20`, {
      headers: authHeaders(),
    });

    if (handleUnauthorizedResponse(res)) return;

    if (res.ok) {
      const data = await res.json();
      data.forEach((r) => {
        // Staging folder videos are listed via /scvam-staging — skip duplicate DB rows.
        if (isScvamStagingDbRecord(r)) return;
        if (isSegmentPlaybackItem({ title: r.category, type: r.category, fileUrl: r.file_url })) return;
        const id = String(r.id);
        if (seenIds.has(id)) return;
        seenIds.add(id);
        const vaultLocalId = localVaultIdFromFileUrl(r.file_url);
        if (vaultLocalId) serverByVaultId.set(vaultLocalId, r);
        mergedPlayback.push({
          id: r.id,
          title: r.category || "Video Recording",
          resident: r.resident_name || "—",
          date: r.recorded_at || (r.created_at ? r.created_at.slice(0, 10) : "—"),
          duration: r.duration || "—",
          flag: "none",
          type: r.category || "Recording",
          fileUrl: r.file_url || null,
          vaultLocalId,
          scvamStatus: r.scvam_status || "none",
          aiSummary: r.ai_summary || "",
        });
      });
    }
  } catch (e) {
    console.warn("Records API unavailable:", e);
  }

  try {
    await refreshStagingJobVideos();
  } catch (e) {
    console.warn("SCVAM staging list unavailable:", e);
  }

  if (window.recordingVault?.vaultListRecordings) {
    try {
      const vaultRows = await window.recordingVault.vaultListRecordings();
      vaultRows.forEach((row) => {
        const id = String(row.id || "");
        if (!id || seenIds.has(id) || serverByVaultId.has(id)) return;
        if (isSegmentPlaybackItem({ title: row.cameraLabel, vaultLocalId: id })) return;
        seenIds.add(id);
        mergedPlayback.push({
          id,
          title: row.cameraLabel || "Local camera recording",
          resident: "This device",
          date: row.startedAt || row.createdAt || "—",
          duration: row.durationMs
            ? `${Math.max(1, Math.round(Number(row.durationMs) / 1000))}s`
            : "—",
          flag: "none",
          type: "Local Vault",
          fileUrl: `localvault://${id}`,
          vaultLocalId: id,
          scvamStatus: "none",
          aiSummary: "",
        });
      });
    } catch (_) {}
  }

  if (loadToken !== _loadPlaybackToken) return;

  recordings = mergedPlayback.sort((a, b) => {
    const aTs = Date.parse(a.date || 0) || 0;
    const bTs = Date.parse(b.date || 0) || 0;
    return bTs - aTs;
  });

  renderPlayback();

  if (pendingPlaybackFromUrl) {
    const target = recordings.find((r) => String(r.id) === pendingPlaybackFromUrl.id);
    if (target) {
      openPlayback(target.id);
      pendingPlaybackFromUrl = null;
    } else if (pendingPlaybackFromUrl.fileUrl) {
      const syntheticId = `route:${Date.now()}`;
      recordings.unshift({
        id: syntheticId,
        title: "Routed Playback",
        resident: "—",
        date: new Date().toISOString().slice(0, 10),
        duration: "—",
        flag: "none",
        type: "Recording",
        fileUrl: pendingPlaybackFromUrl.fileUrl,
      });
      renderPlayback();
      openPlayback(syntheticId);
      pendingPlaybackFromUrl = null;
    }
  }
}

// API — ALERTS
async function loadAlerts() {
  const merged = [];
  try {
    const [camRes, flagRes] = await Promise.all([
      fetch(`${API_BASE}/cameras/alerts/?limit=50`, { headers: authHeaders() }),
      fetch(`${API_BASE}/flags/?status=Pending Review&limit=30`, { headers: authHeaders() }),
    ]);

    if (camRes.ok) {
      const data = await camRes.json();
      data.forEach((a) => {
        merged.push({
          id: a.id,
          source: "camera",
          type: (a.alert_type || "alert").toLowerCase().replace(/\s+/g, "-"),
          icon: a.icon || (String(a.alert_type || "").toLowerCase().includes("fall") ? "fall" : "person"),
          title: a.title,
          desc: a.description,
          time: a.created_at,
          cam: a.camera_title || "—",
          resolved: a.resolved,
        });
      });
    }

    if (flagRes.ok) {
      const flags = await flagRes.json();
      flags.forEach((f) => {
        const et = String(f.event_type || "alert");
        merged.push({
          id: `flag-${f.id}`,
          flagId: f.id,
          source: "flag",
          type: et.toLowerCase().replace(/\s+/g, "-"),
          icon: et.toLowerCase().includes("fall") ? "fall" : "person",
          title: `${et} — ${f.resident_name || "Resident"}`,
          desc: f.description || f.sev_desc || "SCVAM AI flag",
          time: f.flagged_at || f.created_at || "—",
          cam: f.resident_name || "SCVAM",
          resolved: f.status === "Resolved",
        });
      });
    }

    merged.sort((a, b) => Date.parse(b.time || 0) - Date.parse(a.time || 0));
    alertsData = merged;
  } catch (e) {
    alertsData = [];
    showGridError("alerts-list", "alerts");
  }

  renderAlerts();
}

async function resolveAlert(id) {
  const a = alertsData.find((x) => x.id === id);

  if (a) a.resolved = true;

  renderAlerts();

  const active = alertsData.filter((x) => !x.resolved).length;

  const stAlerts = document.getElementById("st-alerts");
  const badge = document.querySelector(".alert-badge");

  if (stAlerts) stAlerts.textContent = active;
  if (badge) badge.textContent = active;

  try {
    if (a?.source === "flag" && a.flagId) {
      await fetch(`${API_BASE}/flags/${a.flagId}/status`, {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify({ status: "Resolved" }),
      });
    } else {
      await fetch(`${API_BASE}/cameras/alerts/${id}/resolve`, {
        method: "PATCH",
        headers: authHeaders(),
      });
    }

    loadStats();
  } catch (e) {
    console.warn("Resolve API failed:", e);
  }
}

// RENDER — CAMERAS
const EMOJI_SETS = [
  ["🚶", "👩"],
  ["🧓"],
  ["🧑‍🦽"],
  ["🚶", "🧓"],
  ["👩"],
  ["🧑‍🦽", "🚶"],
  ["🧓", "👩"],
  ["🚶"],
];

function renderCameras() {
  const grid = document.getElementById("camera-grid");

  if (!grid) return;

  if (!filteredCameras.length) {
    grid.innerHTML = `
      <div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--text3);font-weight:600;">
        No cameras match the current filter.
      </div>
    `;

    const skeleton = document.getElementById("page-skeleton");
    if (skeleton) skeleton.style.display = "none";

    return;
  }

  grid.innerHTML = filteredCameras.map((c, idx) => {
    const isAlert = c.alert === "critical";
    const isOffline = c.status === "offline";
    const idArg = JSON.stringify(c.id);

    if (c.source === "local") {
      const encodedDeviceId = encodeURIComponent(c.deviceId);

      return `
        <div 
          class="cam-card cam-card-local fine" 
          data-cam-id="${escapeHtml(String(c.id))}"
          onclick="openCamera(${idArg})"
        >
          <div class="cam-video">
            <video 
              class="cam-feed" 
              data-local-device="${encodedDeviceId}" 
              autoplay 
              muted 
              playsinline 
              style="width:100%;height:100%;object-fit:cover;background:#0a1628;"
            ></video>
          </div>

          <div class="cam-info">
            <div class="cam-title">${escapeHtml(c.title)}</div>
            <div class="cam-resident">👤 ${escapeHtml(c.resident)}</div>
            ${c.desc ? `<div class="cam-desc">${escapeHtml(c.desc)}</div>` : ""}

            <div class="cam-footer">
              <span class="cam-status-dot">
                <div class="dot-live"></div> Live
              </span>

              <div class="cam-actions">
                <button 
                  type="button"
                  class="cam-btn js-cam-action" 
                  title="Edit Camera"
                  data-action="edit"
                  data-cam-id="${escapeHtml(String(c.id))}"
                >
                  <svg viewBox="0 0 24 24">
                    <path d="M12 20h9"/>
                    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>
                  </svg>
                </button>

                <button 
                  type="button"
                  class="cam-btn cam-btn-record js-cam-action" 
                  id="rec-btn-${encodedDeviceId}" 
                  title="Record / Stop Recording"
                  data-action="record"
                  data-cam-id="${escapeHtml(String(c.id))}"
                  data-device-id="${encodedDeviceId}"
                >
                  <svg viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="6" fill="currentColor"/>
                  </svg>
                </button>

                ${buildCamAiButton(getCameraAiKey(c))}

                <button 
                  type="button"
                  class="cam-btn js-cam-action" 
                  title="Fullscreen"
                  data-action="fullscreen"
                  data-cam-id="${escapeHtml(String(c.id))}"
                >
                  <svg viewBox="0 0 24 24">
                    <polyline points="15 3 21 3 21 9"/>
                    <polyline points="9 21 3 21 3 15"/>
                    <line x1="21" y1="3" x2="14" y2="10"/>
                    <line x1="3" y1="21" x2="10" y2="14"/>
                  </svg>
                </button>

                <button 
                  type="button"
                  class="cam-btn cam-btn-off js-cam-action" 
                  title="Turn Off Camera"
                  data-action="off"
                  data-device-id="${encodedDeviceId}"
                >
                  <svg viewBox="0 0 24 24">
                    <line x1="1" y1="1" x2="23" y2="23"/>
                    <path d="M21 21H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3"/>
                    <path d="M14.12 6H21a2 2 0 0 1 2 2v9.34"/>
                    <path d="M9.88 3H15l2 3"/>
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>
      `;
    }

    const emojiIdx = (typeof c.id === "number" ? c.id - 1 : idx) % EMOJI_SETS.length;
    const emojis = EMOJI_SETS[Math.max(0, emojiIdx)];

    const people = emojis.map((e, i) => `
      <div class="${i === 0 ? "cctv-person" : "cctv-person2"}" style="animation-duration:${6 + i * 3}s">
        ${e}
      </div>
    `).join("");

    const feed = isOffline
      ? `
        <div class="cam-feed-placeholder">
          <svg viewBox="0 0 24 24">
            <line x1="1" y1="1" x2="23" y2="23"/>
            <path d="M21 21H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3m3-3h6l2 3h4a2 2 0 0 1 2 2v9.34"/>
          </svg>
          <div class="cam-offline-txt">OFFLINE</div>
        </div>
      `
      : `
        <div class="cctv-sim" style="width:100%;height:100%">
          <div class="cctv-bg" style="width:100%;height:100%"></div>
          ${people}
          <div class="cctv-scanline"></div>
          <div class="cctv-noise"></div>
          <div class="cctv-timestamp">${new Date().toLocaleTimeString("en-AU")}</div>
          <div class="cctv-recbadge"><div class="rec-dot"></div>LIVE</div>
          ${
            isAlert
              ? '<div class="cam-alert-overlay"></div><div class="cam-alert-label">CRITICAL</div>'
              : '<div class="cam-fine-label">LIVE</div>'
          }
        </div>
      `;

    return `
      <div 
        class="cam-card ${isAlert ? "critical" : c.alert === "fine" ? "fine" : ""} ${isOffline ? "offline" : ""}" 
        onclick="openCamera(${idArg})"
      >
        <div class="cam-video">${feed}</div>

        <div class="cam-info">
          <div class="cam-title">${escapeHtml(c.title)}</div>
          <div class="cam-resident">👤 ${escapeHtml(c.resident)}</div>
          ${c.desc ? `<div class="cam-desc">${escapeHtml(c.desc)}</div>` : ""}

          <div class="cam-footer">
            <span class="cam-status-dot">
              ${isOffline ? '<div class="dot-offline"></div> Offline' : '<div class="dot-live"></div> Live'}
            </span>

            <div class="cam-actions">
              <button 
                type="button"
                class="cam-btn js-cam-action" 
                title="Edit Camera"
                data-action="edit"
                data-cam-id="${escapeHtml(String(c.id))}"
              >
                <svg viewBox="0 0 24 24">
                  <path d="M12 20h9"/>
                  <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>
                </svg>
              </button>

              ${buildCamAiButton(getCameraAiKey(c))}

              <button 
                type="button"
                class="cam-btn js-cam-action" 
                title="Fullscreen"
                data-action="fullscreen"
                data-cam-id="${escapeHtml(String(c.id))}"
              >
                <svg viewBox="0 0 24 24">
                  <polyline points="15 3 21 3 21 9"/>
                  <polyline points="9 21 3 21 3 15"/>
                  <line x1="21" y1="3" x2="14" y2="10"/>
                  <line x1="3" y1="21" x2="10" y2="14"/>
                </svg>
              </button>

              <button 
                type="button"
                class="cam-btn js-cam-action" 
                title="Snapshot"
                data-action="snapshot"
                data-cam-id="${escapeHtml(String(c.id))}"
              >
                <svg viewBox="0 0 24 24">
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                  <circle cx="12" cy="13" r="4"/>
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
  }).join("");

  grid.querySelectorAll("video.cam-feed[data-local-device]").forEach((v) => {
    const raw = v.getAttribute("data-local-device");
    const did = raw ? decodeURIComponent(raw) : "";
    const stream = localCamStreams.get(did);

    if (stream) {
      v.srcObject = stream;
    }
  });

  bindCameraActionButtons();

  const skeleton = document.getElementById("page-skeleton");
  if (skeleton) {
    skeleton.style.display = "none";
  }
}

// STABLE BUTTON EVENTS
function bindCameraActionButtons() {
  document.querySelectorAll(".js-cam-action").forEach((btn) => {
    btn.addEventListener("click", function (event) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      const action = this.dataset.action;
      const camId = this.dataset.camId;
      const deviceId = this.dataset.deviceId;

      console.log("Camera action clicked:", action, camId, deviceId);

      if (action === "record") {
        toggleRecording(camId);
        return;
      }

      if (action === "ai-toggle") {
        toggleCameraAi(this.dataset.camKey);
        return;
      }

      if (action === "fullscreen") {
        openCameraFullscreen(camId);
        return;
      }

      if (action === "off") {
        turnOffLocalCamera(deviceId);
        return;
      }

      if (action === "snapshot") {
        _showToast("📸 Snapshot feature not connected yet");
        return;
      }

      if (action === "edit") {
        openEditCameraFromCard(camId);
      }
    });
  });
}

function openEditCameraFromCard(camId) {
  const cam = cameras.find((c) => String(c.id) === String(camId));

  if (!cam) {
    _showToast("⚠ Camera not found.");
    return;
  }

  if (cam.source !== "facility") {
    _showToast("⚠ Local camera details cannot be edited here.");
    return;
  }

  openCameraSettingsModal();
  editCameraInSettings(Number(cam.id));
}

function scvamStatusBadge(status) {
  const s = String(status || "none").toLowerCase();
  if (s === "ready") {
    return '<span class="pb-scvam pb-scvam-ready">AI ready</span>';
  }
  if (s === "processing" || s === "pending" || s === "running") {
    return '<span class="pb-scvam pb-scvam-pending">AI processing</span>';
  }
  if (s === "failed") {
    return '<span class="pb-scvam pb-scvam-failed">AI failed</span>';
  }
  if (s === "skipped") {
    return '<span class="pb-scvam pb-scvam-skipped">AI skipped</span>';
  }
  return "";
}

function formatScvamStatusLabel(status) {
  const st = String(status || "none").toLowerCase();
  if (st === "ready" || st === "done") return "SCVAM done";
  if (st === "pending") return "Queued";
  if (st === "processing" || st === "running") return "Processing";
  if (st === "failed") return "Failed";
  if (st === "unable") return "SCVAM unable";
  return "Not analyzed";
}

function scvamStatusBadgeClass(status) {
  const st = String(status || "none").toLowerCase();
  if (st === "ready" || st === "done") return "done";
  if (st === "pending") return "pending";
  if (st === "processing" || st === "running") return "processing";
  if (st === "failed" || st === "unable") return "failed";
  return "none";
}

function stagingShortName(rec) {
  if (!rec) return "Recording";
  if (rec.source === "staging") {
    if (rec.title) return rec.title;
    const v = rec.stagingVideo || "";
    return String(v).replace(/\.(mp4|webm|mov|mkv)$/i, "") || rec.stagingFolder || "test";
  }
  return rec.title || "Recording";
}

function videoStem(name) {
  return String(name || "").replace(/\.(mp4|webm|mov|mkv)$/i, "");
}

function playbackItemTitle(rec) {
  return stagingShortName(rec);
}

function selectPlaybackItem(id) {
  if (!id) return;
  const nextId = String(id);
  if (String(activeInlinePlaybackId) !== nextId) {
    stopScvamStatusPoll();
    _playbackScriptRequestSeq++;
    inlinePlaybackRequestToken++;
  }
  activeInlinePlaybackId = nextId;
  updatePlaybackActionButtons(nextId);
  renderPlaybackSourceList();
  renderPlaybackScriptList(nextId);
  loadPlaybackScript(nextId);
  const rec = findPlaybackItem(nextId);
  if (rec?.fileUrl) {
    openPlayback(nextId, { skipRender: true, skipScript: true });
  }
}

function renderPlaybackSourceList() {
  // Left-side source list removed; staging/recordings are chosen from playback-script-select.
}

// PLAYBACK — right panel: SCVAM minute-by-minute script (no video card list)
function updatePlaybackActionButtons(selectedId) {
  const aiBtn = document.getElementById("playback-ai-btn");
  const delBtn = document.getElementById("playback-delete-btn");
  const isStaging = isStagingPlaybackId(selectedId);
  if (aiBtn) {
    aiBtn.style.display = isStaging ? "" : "none";
    aiBtn.disabled = false;
    aiBtn.textContent = "Perform AI";
  }
  if (delBtn) {
    delBtn.style.display = "";
    delBtn.disabled = false;
    delBtn.textContent = isStaging ? "Clear SCVAM" : "Delete";
    delBtn.title = isStaging
      ? "Clear SCVAM analysis output (keeps video in jobs)"
      : "Delete selected recording";
  }
}

function stagingDropdownSort(a, b) {
  const stagingFolders = new Set(["testing", "test"]);
  const aTesting = stagingFolders.has(String(a?.stagingFolder || ""));
  const bTesting = stagingFolders.has(String(b?.stagingFolder || ""));
  if (aTesting && !bTesting) return -1;
  if (!aTesting && bTesting) return 1;
  return String(a?.title || "").localeCompare(String(b?.title || ""));
}

function renderPlaybackScriptList(activeId) {
  const el = document.getElementById("playback-script-select");
  if (!el) return;

  const active = String(activeId || activeInlinePlaybackId || "");

  if (!stagingJobVideos.length) {
    el.innerHTML =
      '<option value="">No videos in scvam_input/jobs</option>';
    el.disabled = true;
    el.value = "";
    const panel = document.getElementById("playback-script-panel");
    if (panel) {
      panel.innerHTML =
        '<div class="playback-script-empty">No staging videos found. Add files under <b>databases/org_X/scvam_input/jobs/</b> or record with AI enabled.</div>';
    }
    return;
  }

  el.disabled = false;
  el.innerHTML = stagingJobVideos
    .map((rec) => {
      const id = escapeHtml(String(rec.id));
      const label = escapeHtml(stagingScriptOptionLabel(rec));
      const selected = String(rec.id) === active ? " selected" : "";
      return `<option value="${id}"${selected}>${label}</option>`;
    })
    .join("");

  if (active && stagingJobVideos.some((r) => String(r.id) === active)) {
    el.value = active;
  }

  if (!el.dataset.bound) {
    el.dataset.bound = "1";
    el.addEventListener("change", () => {
      const id = el.value;
      if (!id) return;
      selectPlaybackItem(id);
    });
  }
}

function bindPlaybackActionButtonsOnce() {
  const delBtn = document.getElementById("playback-delete-btn");
  if (delBtn && !delBtn.dataset.bound) {
    delBtn.dataset.bound = "1";
    delBtn.addEventListener("click", async () => {
      const id = activeInlinePlaybackId;
      if (!id || String(id).startsWith("output:")) {
        _showToast("Select a video from the dropdown to delete.");
        return;
      }
      if (isStagingPlaybackId(id)) {
        openStagingDeleteModal(id);
        return;
      }
      if (!(await ensureVaultUnlockedForConsole())) return;
      openPlaybackDeleteModal(id);
    });
  }

  const aiBtn = document.getElementById("playback-ai-btn");
  if (aiBtn && !aiBtn.dataset.bound) {
    aiBtn.dataset.bound = "1";
    aiBtn.addEventListener("click", async () => {
      const id = activeInlinePlaybackId;
      if (!isStagingPlaybackId(id)) {
        _showToast("Select a staging video to run SCVAM.");
        return;
      }
      aiBtn.disabled = true;
      aiBtn.textContent = "Queuing…";
      try {
        const folder = stagingFolderForPlayback(id);
        const video = stagingVideoForPlayback(id);
        await performStagingScvam(folder, video);
        _showToast("🤖 SCVAM queued for " + (video ? `${folder}/${video}` : folder));
        await refreshStagingJobVideos();
        await loadPlayback();
        selectPlaybackItem(id);
        startScvamStagingPoll(folder, video);
      } catch (e) {
        _showToast(String(e?.message || e || "Could not queue SCVAM"));
      } finally {
        aiBtn.disabled = false;
        aiBtn.textContent = "Perform AI";
      }
    });
  }
}

function renderPlayback() {
  bindPlaybackActionButtonsOnce();

  if (!stagingJobVideos.length && !recordings.length) {
    renderPlaybackScriptList("");
    renderPlaybackScriptPanel({
      scvam_status: "none",
      message:
        "No videos in scvam_input/jobs yet. Record with AI on, or copy test clips into databases/org_X/scvam_input/jobs/.",
      timeline: [],
    });
    renderPlaybackSourceList();
    updatePlaybackActionButtons("");
    const pickHint = document.getElementById("playback-pick-hint");
    if (pickHint) pickHint.classList.remove("is-hidden");
    return;
  }

  let activeId = activeInlinePlaybackId;
  const idStillValid =
    activeId &&
    (isStagingPlaybackId(activeId) ||
      stagingJobVideos.some((r) => String(r.id) === String(activeId)) ||
      recordings.some((r) => String(r.id) === String(activeId)));

  if (!idStillValid) {
    activeId = defaultStagingScriptId();
  }
  activeInlinePlaybackId = activeId;
  if (!activeId) {
    updatePlaybackActionButtons("");
    renderPlaybackSourceList();
    renderPlaybackScriptList("");
    renderPlaybackScriptPanel(null);
    return;
  }
  renderPlaybackScriptList(activeId);
  updatePlaybackActionButtons(activeId);
  renderPlaybackSourceList();
  loadPlaybackScript(activeId);
  const rec = findPlaybackItem(activeId);
  if (rec?.fileUrl) {
    openPlayback(activeId, { skipRender: true, skipScript: true });
  } else {
    const pickHint = document.getElementById("playback-pick-hint");
    if (pickHint) pickHint.classList.remove("is-hidden");
  }

  bindPlaybackActionButtonsOnce();
}

async function performStagingScvam(folderName, videoName) {
  const res = await fetch(stagingAnalyzeApiUrl(folderName, videoName), {
    method: "POST",
    headers: authHeaders(),
  });
  if (handleUnauthorizedResponse(res)) throw new Error("Session expired.");
  if (!res.ok) throw new Error(await apiErrorDetail(res));
  return res.json();
}

function openStagingDeleteModal(id) {
  const rec = findPlaybackItem(id);
  if (!rec) {
    _showToast("Select a video from the dropdown to delete.");
    return;
  }
  const folder = stagingFolderForPlayback(id);
  const video = stagingVideoForPlayback(id);
  const name = playbackItemTitle(rec);
  _stagingDeleteTarget = { folder, video, id: String(id) };
  const sub = document.getElementById("staging-delete-sub");
  if (sub) {
    sub.textContent = video
      ? `Clear SCVAM analysis for "${name}" (${folder}/${video}). The video stays in scvam_input/jobs.`
      : `Clear SCVAM analysis for folder "${folder}". Staging videos stay in scvam_input/jobs.`;
  }
  setRcStatus("staging-delete-status", "", "");
  const submitBtn = document.getElementById("staging-delete-submit");
  if (submitBtn) submitBtn.disabled = false;
  openRcModal("staging-delete-modal");
}

async function submitStagingDeleteModal() {
  const target = _stagingDeleteTarget;
  if (!target) return;
  const submitBtn = document.getElementById("staging-delete-submit");
  if (submitBtn) submitBtn.disabled = true;
  setRcStatus("staging-delete-status", "Clearing SCVAM output…", "ok");
  try {
    await deleteStagingJob(target.folder, target.video);
    _stagingDeleteTarget = null;
    closeRcModal("staging-delete-modal");
  } catch (e) {
    setRcStatus("staging-delete-status", e?.message || "Delete failed", "err");
    if (submitBtn) submitBtn.disabled = false;
  }
}

async function deleteStagingJob(folderName, videoName) {
  const keepId = activeInlinePlaybackId || _stagingDeleteTarget?.id || null;
  const res = await fetch(stagingDeleteApiUrl(folderName, videoName, true), {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (handleUnauthorizedResponse(res)) throw new Error("Session expired.");
  if (!res.ok && res.status !== 204) {
    throw new Error(await apiErrorDetail(res));
  }
  _showToast(
    videoName
      ? "SCVAM output cleared — video kept in jobs list"
      : "SCVAM output cleared for staging folder"
  );
  stopScvamStatusPoll();
  _stagingDeleteTarget = null;
  await loadPlayback();
  if (keepId && stagingJobVideos.some((r) => String(r.id) === String(keepId))) {
    const item = stagingJobVideos.find((r) => String(r.id) === String(keepId));
    if (item) item.scvamStatus = "unable";
    selectPlaybackItem(keepId);
  } else {
    renderPlayback();
  }
}

async function openPlaybackDeleteModal(id) {
  if (!(await ensureVaultUnlockedForConsole())) return;
  const rec = recordings.find((r) => String(r.id) === String(id));
  if (!rec) return;
  _playbackDeleteTargetId = String(id);
  const sub = document.getElementById("playback-delete-sub");
  const input = document.getElementById("playback-delete-confirm");
  if (sub) {
    sub.textContent = `Remove "${rec.title || "recording"}" from this device and server. Vault must be unlocked.`;
  }
  if (input) input.value = "";
  setRcStatus("playback-delete-status", "", "");
  openRcModal("playback-delete-modal");
  setTimeout(() => input?.focus(), 80);
}

async function submitPlaybackDeleteModal() {
  const typed = document.getElementById("playback-delete-confirm")?.value?.trim();
  if (typed !== DELETE_CONFIRM_WORD) {
    setRcStatus("playback-delete-status", `Type ${DELETE_CONFIRM_WORD} to confirm.`, "err");
    return;
  }
  const id = _playbackDeleteTargetId;
  const rec = recordings.find((r) => String(r.id) === String(id));
  if (!rec) {
    closeRcModal("playback-delete-modal");
    return;
  }
  try {
    if (!(await ensureVaultUnlockedForConsole())) {
      setRcStatus("playback-delete-status", "Unlock the vault first, then retry.", "err");
      return;
    }
    setRcStatus("playback-delete-status", "Deleting…", "ok");
    const localId = localVaultIdFromRec(rec);
    const serverId = resolveServerIdForRecording(rec);
    await removeLocalVaultById(localId);
    if (serverId) await deleteServerRecordById(serverId);
    dropRecordingsFromState({ localId, serverId, primaryId: rec.id });
    _playbackDeleteTargetId = null;
    activeInlinePlaybackId = null;
    const watch = document.getElementById("playback-watch");
    if (watch) watch.style.display = "none";
    closeRcModal("playback-delete-modal");
    renderPlayback();
    _showToast("🗑 Recording deleted");
  } catch (e) {
    setRcStatus("playback-delete-status", e?.message || "Delete failed", "err");
  }
}

async function buildScvamRetryPayload(rec) {
  const body = {};
  const vault = window.recordingVault;
  const localId = localVaultIdFromRec(rec);
  if (!localId) return body;
  if (!vault || !vault.vaultIsUnlocked()) {
    throw new Error("Unlock the vault to retry SCVAM on this device recording.");
  }
  const all = await vault.vaultListRecordings();
  const entry = all.find((v) => v.id === localId);
  if (!entry) {
    throw new Error("Recording not found in local vault — record again with AI on.");
  }
  const plain = await vault.vaultDecryptToArrayBuffer(entry.ivB64, entry.cipherB64);
  if (vault.bufToB64) {
    body.ai_plain_b64 = vault.bufToB64(new Uint8Array(plain));
  } else {
    const bytes = new Uint8Array(plain);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    body.ai_plain_b64 = btoa(binary);
  }
  return body;
}

async function apiErrorDetail(res) {
  const text = await res.text().catch(() => "");
  try {
    const j = JSON.parse(text);
    if (j.detail) return typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail);
  } catch (_) {
    /* ignore */
  }
  return text || `Request failed (${res.status})`;
}

async function retryScvamRecording(recordId, rec) {
  const body = await buildScvamRetryPayload(rec || null);
  const res = await fetch(`${API_BASE}/records/${recordId}/scvam-retry`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  if (handleUnauthorizedResponse(res)) {
    throw new Error("Session expired — log in again.");
  }
  if (!res.ok) throw new Error(await apiErrorDetail(res));
  return res.json();
}

function renderPlaybackScriptPanel(data, req) {
  if (req && !isPlaybackScriptRequestCurrent(req)) return;
  const panel = document.getElementById("playback-script-panel");
  if (!panel) return;

  if (!data) {
    panel.innerHTML =
      '<div class="playback-script-empty">Select a recording to view the SCVAM script.</div>';
    return;
  }

  const status = String(data.scvam_status || "none");
  const statusLabel = formatScvamStatusLabel(status);
  const duration = data.duration_sec != null ? `${data.duration_sec}s` : "—";
  let html = "";

  if (status === "ready" || status === "done") {
    html += `<div class="playback-script-status" style="background:#f0fdf4;border-color:#bbf7d0;color:#15803d;">SCVAM analysis complete — minute-by-minute script below.</div>`;
  } else if (status === "unable") {
    html += `<div class="playback-script-status" style="background:#fef2f2;border-color:#fecaca;color:#b91c1c;">SCVAM analysis was removed. Click <b>Perform AI</b> to analyze again.</div>`;
  } else if (data.message) {
    html += `<div class="playback-script-status">${escapeHtml(data.message)}</div>`;
  }
  if (status === "failed" && data.record_id && /^\d+$/.test(String(data.record_id))) {
    html += `<button type="button" class="pw-btn pw-btn-primary playback-script-retry" data-record-id="${escapeHtml(String(data.record_id))}" style="margin-top:8px;">Retry SCVAM</button>`;
  }

  if (data.heading) {
    html += `<div class="playback-script-heading">${escapeHtml(data.heading)}</div>`;
  }

  html += `<div class="playback-script-meta">Status: ${escapeHtml(statusLabel)} · Duration: ${escapeHtml(duration)}${data.video_name ? ` · ${escapeHtml(data.video_name)}` : ""}</div>`;

  const timeline = Array.isArray(data.timeline) ? data.timeline : [];
  if (timeline.length) {
    html += timeline
      .map(
        (block) => `
      <div class="playback-script-minute">
        <div class="playback-script-minute-label">${escapeHtml(block.label || `Minute ${block.minute}`)}</div>
        ${(block.lines || [])
          .map((line) => `<p class="playback-script-minute-line">${escapeHtml(line)}</p>`)
          .join("")}
      </div>
    `
      )
      .join("");
  } else if (data.summary_text) {
    html += `<div class="playback-script-minute">
      <div class="playback-script-minute-label">00:00–01:00</div>
      <p class="playback-script-minute-line">${escapeHtml(data.summary_text)}</p>
    </div>`;
  } else {
    html += `<div class="playback-script-empty">No script text for this recording yet.</div>`;
  }

  panel.innerHTML = html;
  const retryBtn = panel.querySelector(".playback-script-retry");
  if (retryBtn) {
    retryBtn.addEventListener("click", async () => {
      const rid = retryBtn.getAttribute("data-record-id");
      if (!rid) return;
      const rec =
        recordings.find((r) => String(r.id) === String(rid)) ||
        recordings.find((r) => resolveServerIdForRecording(r) === String(rid));
      retryBtn.disabled = true;
      retryBtn.textContent = "Retrying…";
      try {
        await retryScvamRecording(rid, rec);
        _showToast("SCVAM re-queued — processing shortly");
        await loadPlayback();
        loadPlaybackScript(rid);
        startScvamStatusPoll(rid);
      } catch (e) {
        _showToast(String(e?.message || e || "Could not retry SCVAM"));
        retryBtn.disabled = false;
        retryBtn.textContent = "Retry SCVAM";
      }
    });
  }
}

function stopScvamStatusPoll() {
  if (_scvamPollTimer) {
    clearInterval(_scvamPollTimer);
    _scvamPollTimer = null;
  }
  _scvamPollRecordId = null;
}

function startScvamStatusPoll(recordId) {
  if (!recordId) return;
  if (isStagingPlaybackId(recordId)) {
    startScvamStagingPoll(
      stagingFolderForPlayback(recordId),
      stagingVideoForPlayback(recordId)
    );
    return;
  }
  if (!/^\d+$/.test(String(recordId))) return;
  if (_scvamPollRecordId === String(recordId) && _scvamPollTimer) return;

  stopScvamStatusPoll();
  _scvamPollRecordId = String(recordId);

  const tick = async () => {
    if (_scvamPollRecordId !== String(recordId) || !isActivePlaybackId(recordId)) return;
    try {
      const res = await fetch(`${API_BASE}/records/${recordId}/scvam-status`, {
        headers: authHeaders(),
      });
      if (!res.ok) return;
      if (!isActivePlaybackId(recordId)) return;
      const st = await res.json();
      const status = String(st.scvam_status || "none");
      const rec = findPlaybackItem(recordId);
      if (rec) rec.scvamStatus = status;
      if (isActivePlaybackId(recordId)) {
        renderPlaybackScriptList(recordId);
      }

      if (status === "ready" || status === "failed" || status === "none" || status === "skipped") {
        stopScvamStatusPoll();
        if (isActivePlaybackId(recordId)) loadPlaybackScript(recordId);
        return;
      }

      const panel = document.getElementById("playback-script-panel");
      if (panel && isActivePlaybackId(recordId) && !panel.querySelector(".playback-script-status")) {
        panel.innerHTML =
          '<div class="playback-script-empty">AI analysis in progress…</div>';
      }
    } catch (_) {}
  };

  _scvamPollTimer = setInterval(tick, 4000);
  tick();
}

function startScvamStagingPoll(folderName, videoName) {
  if (!folderName) return;
  const pollId = stagingPlaybackId(folderName, videoName);
  if (_scvamPollRecordId === pollId && _scvamPollTimer) return;

  stopScvamStatusPoll();
  _scvamPollRecordId = pollId;

  const tick = async () => {
    if (_scvamPollRecordId !== pollId || !isActivePlaybackId(pollId)) return;
    try {
      const res = await fetch(stagingScriptApiUrl(folderName, videoName), {
        headers: authHeaders(),
      });
      if (!res.ok) return;
      if (!isActivePlaybackId(pollId)) return;
      const data = await res.json();
      const status = String(data.scvam_status || "none");
      const rec = findPlaybackItem(pollId);
      if (rec) rec.scvamStatus = status;
      if (isActivePlaybackId(pollId)) {
        renderPlaybackSourceList();
        renderPlaybackScriptList(pollId);
      }

      if (status === "ready" || status === "failed" || status === "skipped") {
        stopScvamStatusPoll();
        if (!isActivePlaybackId(pollId)) return;
        const req = currentPlaybackScriptRequest(pollId);
        const expected = videoStem(videoName || stagingVideoForPlayback(pollId));
        const got = videoStem(data.video_name || "");
        if (expected && got && expected !== got && status === "ready") return;
        renderPlaybackScriptPanel(data, req);
        return;
      }

      const panel = document.getElementById("playback-script-panel");
      if (panel && isActivePlaybackId(pollId)) {
        panel.innerHTML =
          '<div class="playback-script-empty">AI analysis in progress for staging file…</div>';
      }
    } catch (_) {}
  };

  _scvamPollTimer = setInterval(tick, 4000);
  tick();
}

async function loadPlaybackScript(id) {
  const panel = document.getElementById("playback-script-panel");
  if (!panel) return;
  const req = beginPlaybackScriptRequest(id);

  if (String(id).startsWith("output:")) {
    stopScvamStatusPoll();
    const folder = String(id).slice("output:".length);
    panel.innerHTML = '<div class="playback-script-empty">Loading SCVAM script…</div>';
    try {
      const res = await fetch(
        `${API_BASE}/records/scvam-output/${encodeURIComponent(folder)}/script`,
        { headers: authHeaders() }
      );
      if (handleUnauthorizedResponse(res)) return;
      if (!isPlaybackScriptRequestCurrent(req)) return;
      if (!res.ok) throw new Error(await res.text());
      renderPlaybackScriptPanel(await res.json(), req);
    } catch (e) {
      if (!isPlaybackScriptRequestCurrent(req)) return;
      renderPlaybackScriptPanel(
        {
          scvam_status: "failed",
          message: "Could not load SCVAM output folder.",
          timeline: [],
        },
        req
      );
    }
    return;
  }

  if (isStagingPlaybackId(id)) {
    const folder = stagingFolderForPlayback(id);
    const video = stagingVideoForPlayback(id);
    const rec = findPlaybackItem(id);
    updatePlaybackActionButtons(id);
    panel.innerHTML = '<div class="playback-script-empty">Loading SCVAM script…</div>';
    try {
      const res = await fetch(stagingScriptApiUrl(folder, video), {
        headers: authHeaders(),
      });
      if (handleUnauthorizedResponse(res)) return;
      if (!isPlaybackScriptRequestCurrent(req)) return;
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      if (!isPlaybackScriptRequestCurrent(req)) return;
      const expected = videoStem(video || stagingVideoForPlayback(id));
      const got = videoStem(data.video_name || "");
      if (expected && got && expected !== got && String(data.scvam_status || "").toLowerCase() === "ready") {
        renderPlaybackScriptPanel(
          {
            scvam_status: "none",
            duration_sec: parseInt(String(rec?.duration || "").replace(/\D/g, ""), 10) || null,
            video_name: expected,
            message: `No SCVAM output for ${expected} yet. Click Perform AI to analyze this file.`,
            timeline: [],
          },
          req
        );
        stopScvamStatusPoll();
        return;
      }
      if (rec) {
        rec.scvamStatus = data.scvam_status || rec.scvamStatus;
        renderPlaybackSourceList();
        renderPlaybackScriptList(id);
      }
      renderPlaybackScriptPanel(data, req);
      const st = String(data.scvam_status || "none");
      if (!isPlaybackScriptRequestCurrent(req)) return;
      if (st === "pending" || st === "processing" || st === "running") {
        startScvamStagingPoll(folder, video);
      } else {
        stopScvamStatusPoll();
      }
    } catch (e) {
      stopScvamStatusPoll();
      if (!isPlaybackScriptRequestCurrent(req)) return;
      renderPlaybackScriptPanel(
        {
          scvam_status: "none",
          message: "Could not load staging SCVAM script.",
          video_name: video || folder,
          timeline: [],
        },
        req
      );
    }
    return;
  }

  const rec = resolveServerRecording(id);
  if (!rec) {
    if (isPlaybackScriptRequestCurrent(req)) renderPlaybackScriptPanel(null);
    return;
  }

  const scriptRecordId = /^\d+$/.test(String(rec.id)) ? rec.id : null;
  if (!scriptRecordId) {
    const dur = parseInt(String(rec.duration).replace(/\D/g, ""), 10) || 0;
    const hasToken = !!getAccessToken();
    renderPlaybackScriptPanel(
      {
        scvam_status: "none",
        duration_sec: dur || null,
        message: hasToken
          ? "Saved on this device only — server upload did not complete. Record again with AI on while logged in, or check the terminal for upload errors."
          : "Not signed in — log in at Staff Login, then record again with AI on so the clip uploads and SCVAM can run.",
        summary_text: rec.aiSummary || "",
        timeline: rec.aiSummary
          ? [{ minute: 0, label: "00:00–01:00", lines: [rec.aiSummary] }]
          : [],
        video_name: rec.title,
      },
      req
    );
    return;
  }

  panel.innerHTML = '<div class="playback-script-empty">Loading SCVAM script…</div>';

  try {
    const res = await fetch(`${API_BASE}/records/${scriptRecordId}/scvam-script`, {
      headers: authHeaders(),
    });
    if (handleUnauthorizedResponse(res)) return;
    if (!isPlaybackScriptRequestCurrent(req)) return;
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    if (!isPlaybackScriptRequestCurrent(req)) return;
    data.record_id = data.record_id || scriptRecordId;
    renderPlaybackScriptPanel(data, req);
    const st = String(data.scvam_status || "none");
    if (!isPlaybackScriptRequestCurrent(req)) return;
    if (st === "pending" || st === "processing" || st === "running") {
      if (_scvamPollRecordId !== String(scriptRecordId) || !_scvamPollTimer) {
        startScvamStatusPoll(scriptRecordId);
      }
    } else {
      stopScvamStatusPoll();
    }
  } catch (e) {
    stopScvamStatusPoll();
    if (!isPlaybackScriptRequestCurrent(req)) return;
    renderPlaybackScriptPanel(
      {
        record_id: scriptRecordId,
        scvam_status: rec.scvamStatus || "none",
        duration_sec: parseInt(rec.duration, 10) || null,
        message: rec.aiSummary || "Could not load SCVAM script.",
        summary_text: rec.aiSummary || "",
        timeline: [],
        title: rec.title,
      },
      req
    );
  }
}

function _fmtTime(sec) {
  const total = Math.max(0, Number(sec) || 0);
  const mins = Math.floor(total / 60);
  const secs = Math.floor(total % 60);
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function syncInlinePlaybackControls() {
  const video = document.getElementById("pw-video");
  const playBtn = document.getElementById("pw-playpause-btn");
  const muteBtn = document.getElementById("pw-mute-btn");
  const currentEl = document.getElementById("pw-current");
  const durationEl = document.getElementById("pw-duration");
  const progress = document.getElementById("pw-progress");
  const volume = document.getElementById("pw-volume");
  const speed = document.getElementById("pw-speed");

  if (!video) return;

  if (playBtn) {
    playBtn.textContent = video.paused ? "▶" : "⏸";
  }

  if (muteBtn) {
    muteBtn.textContent = video.muted || video.volume === 0 ? "🔇" : "🔊";
  }

  if (currentEl) {
    currentEl.textContent = _fmtTime(video.currentTime || 0);
  }

  if (durationEl) {
    durationEl.textContent = _fmtTime(video.duration || 0);
  }

  if (progress) {
    const pct = video.duration ? ((video.currentTime || 0) / video.duration) * 100 : 0;
    progress.value = String(Math.max(0, Math.min(100, pct)));
  }

  if (volume && document.activeElement !== volume) {
    volume.value = String(video.muted ? 0 : (video.volume ?? 1));
  }

  if (speed && document.activeElement !== speed) {
    speed.value = String(video.playbackRate || 1);
  }
}

// DELETE SINGLE PLAYBACK VIDEO (legacy alias)
function deleteSinglePlayback(id) {
  openPlaybackDeleteModal(id);
}

// ALERTS
const alertIcons = {
  fall: '<svg viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  person: '<svg viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
  sound: '<svg viewBox="0 0 24 24"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>',
  motion: '<svg viewBox="0 0 24 24"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>',
  check: '<svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>',
};

function renderAlerts() {
  const list = document.getElementById("alerts-list");

  if (!list) return;

  if (!alertsData.length) {
    list.innerHTML = `
      <div style="text-align:center;padding:40px;color:var(--text3);font-weight:600;">
        No alerts found.
      </div>
    `;
    return;
  }

  list.innerHTML = alertsData.map((a) => {
    const cls = a.resolved ? "resolved" : a.type;
    const label = a.resolved
      ? "Resolved"
      : String(a.type || "").charAt(0).toUpperCase() + String(a.type || "").slice(1);

    return `
      <div class="alert-row ${escapeHtml(cls)}">
        <div class="alert-icon ai-${escapeHtml(cls)}">
          ${alertIcons[a.icon] || alertIcons.fall}
        </div>

        <div class="alert-body">
          <div class="alert-title">
            ${escapeHtml(a.title)}
            <span class="alert-badge ab-${escapeHtml(cls)}">${escapeHtml(label)}</span>
          </div>

          <div class="alert-desc">${escapeHtml(a.desc)}</div>
        </div>

        <div style="text-align:right;flex-shrink:0;">
          <div class="alert-time">${escapeHtml(a.time)}</div>
          <div style="font-size:11px;color:var(--text3);margin-top:3px;">📷 ${escapeHtml(a.cam)}</div>

          ${
            !a.resolved
              ? `
                <button 
                  type="button"
                  onclick="resolveAlert(${JSON.stringify(a.id)})"
                  style="margin-top:6px;padding:4px 10px;border-radius:7px;border:1.5px solid var(--border);background:#fff;font-family:Inter,sans-serif;font-size:11.5px;font-weight:700;cursor:pointer;"
                >
                  Resolve
                </button>
              `
              : ""
          }
        </div>
      </div>
    `;
  }).join("");
}

// FILTERS
function applyFilters(list) {
  const searchInput = document.getElementById("cam-search");
  const floorInput = document.getElementById("f-floor");
  const statusInput = document.getElementById("f-camstatus");

  const s = searchInput ? searchInput.value.toLowerCase() : "";
  const floor = floorInput ? floorInput.value : "";
  const stat = statusInput ? statusInput.value : "";

  return list.filter((c) => {
    const title = String(c.title || "").toLowerCase();
    const resident = String(c.resident || "").toLowerCase();

    const ms = !s || title.includes(s) || resident.includes(s);
    const mf = !floor || c.floor === floor;
    const mv = !stat || c.status === stat;
    const ma = !alertFilterOn || c.alert === "critical";

    return ms && mf && mv && ma;
  });
}

function filterCameras() {
  filteredCameras = applyFilters(cameras);
  renderCameras();
}

function toggleAlertFilter() {
  alertFilterOn = !alertFilterOn;

  const btn = document.getElementById("alert-filter-btn");

  if (btn) {
    btn.classList.toggle("active", alertFilterOn);
  }

  filterCameras();
}

// GRID + TABS
function setGridCols(n) {
  const grid = document.getElementById("camera-grid");

  if (!grid) return;

  grid.className = "camera-grid" + (n === 2 ? " two-col" : n === 1 ? " one-col" : "");

  ["vbtn-4", "vbtn-2", "vbtn-1"].forEach((id) => {
    const el = document.getElementById(id);

    if (el) {
      el.classList.remove("active");
    }
  });

  const target = document.getElementById("vbtn-" + n);

  if (target) {
    target.classList.add("active");
  }
}

function switchTab(tab, el) {
  ["live", "playback", "alerts"].forEach((t) => {
    const pane = document.getElementById("tab-" + t);

    if (pane) {
      pane.style.display = "none";
    }
  });

  const targetPane = document.getElementById("tab-" + tab);

  if (targetPane) {
    targetPane.style.display = "block";
  }

  document.querySelectorAll(".page-tab").forEach((t) => {
    t.classList.remove("active");
  });

  if (el) {
    el.classList.add("active");
  }

  if (tab === "playback") {
    bindPlaybackActionButtonsOnce();
    loadPlayback().catch((e) => {
      console.warn("Playback refresh failed:", e);
      _showToast("Could not refresh playback list. Check login and try again.");
    });
  }
}

function applyPlaybackRouteFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const tab = (params.get("tab") || "").toLowerCase();
  const playbackId = params.get("playback_id");
  const playbackFile = params.get("playback_file");

  if (tab !== "playback" && !playbackId) return;

  const playbackTabBtn = document.querySelectorAll(".page-tab")[1];
  switchTab("playback", playbackTabBtn);

  if (!playbackId) return;
  pendingPlaybackFromUrl = {
    id: String(playbackId),
    fileUrl: playbackFile || null,
  };
}

// OPEN CAMERA MODAL
function openCamera(id) {
  const cam = cameras.find((c) => String(c.id) === String(id));

  if (!cam) {
    _showToast("⚠ Camera not found.");
    console.warn("Camera not found:", id, cameras);
    return;
  }

  if (activeHls) {
    activeHls.destroy();
    activeHls = null;
  }

  const titleEl = document.getElementById("vm-title");
  const cameraEl = document.getElementById("vm-camera");
  const residentEl = document.getElementById("vm-resident");
  const dateEl = document.getElementById("vm-date");
  const typeEl = document.getElementById("vm-type");
  const statusEl = document.getElementById("vm-status");
  const fillEl = document.getElementById("vm-progress-fill");
  const timeEl = document.getElementById("vm-time");

  if (titleEl) titleEl.textContent = cam.title;
  if (cameraEl) cameraEl.textContent = cam.title;
  if (residentEl) residentEl.textContent = cam.resident;

  if (dateEl) {
    dateEl.textContent = new Date().toLocaleDateString("en-AU", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  }

  if (typeEl) {
    typeEl.textContent = cam.alert === "critical" ? "⚠ Alert Active" : "🔴 Live Stream";
  }

  if (statusEl) {
    statusEl.textContent = cam.status === "live" ? "🟢 Live" : "⚫ Offline";
  }

  if (fillEl) fillEl.style.width = "0%";
  if (timeEl) timeEl.textContent = "LIVE";

  const screenEl = document.querySelector(".vm-screen-inner");

  if (!screenEl) return;

  clearInterval(window._modalTick);

  if (cam.source === "local" && cam.localPreviewStream) {
    const video = document.createElement("video");

    video.style.cssText = "width:100%;height:100%;object-fit:cover;display:block;background:#0a1628;";
    video.autoplay = true;
    video.muted = true;
    video.playsInline = true;
    video.srcObject = cam.localPreviewStream;

    screenEl.innerHTML = "";
    screenEl.appendChild(video);

    window._modalVideo = video;
  } else if (cam.streamUrl) {
    const video = document.createElement("video");

    video.style.cssText = "width:100%;height:100%;object-fit:cover;display:block;";
    video.autoplay = true;
    video.muted = true;
    video.playsInline = true;

    screenEl.innerHTML = "";
    screenEl.appendChild(video);

    if (typeof Hls !== "undefined" && Hls.isSupported()) {
      activeHls = new Hls({ lowLatencyMode: true });
      activeHls.loadSource(cam.streamUrl);
      activeHls.attachMedia(video);
      activeHls.on(Hls.Events.MANIFEST_PARSED, () => video.play());
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = cam.streamUrl;
      video.play();
    }

    window._modalVideo = video;
  } else {
    const idx = cameras.findIndex((x) => String(x.id) === String(id));
    const emojis = EMOJI_SETS[(idx >= 0 ? idx : 0) % EMOJI_SETS.length];

    const people = emojis.map((e, i) => `
      <div class="${i === 0 ? "cctv-person" : "cctv-person2"}" style="font-size:42px;animation-duration:${6 + i * 3}s">
        ${e}
      </div>
    `).join("");

    screenEl.innerHTML = `
      <div class="cctv-sim" style="width:100%;height:100%">
        <div class="cctv-bg" style="width:100%;height:100%"></div>
        ${people}
        <div class="cctv-scanline"></div>
        <div class="cctv-noise"></div>
        <div class="cctv-timestamp" id="modal-ts" style="font-size:12px;top:10px;left:14px"></div>
        <div class="cctv-recbadge" style="top:10px;right:14px;font-size:12px">
          <div class="rec-dot"></div>LIVE
        </div>
        ${
          cam.alert === "critical"
            ? '<div class="cam-alert-overlay"></div><div class="cam-alert-label" style="font-size:13px;padding:5px 12px;bottom:12px;left:12px">CRITICAL ALERT</div>'
            : ""
        }
      </div>
    `;

    window._modalTick = setInterval(() => {
      const el = document.getElementById("modal-ts");

      if (el) {
        el.textContent = new Date().toLocaleTimeString("en-AU");
      }
    }, 1000);

    window._modalVideo = null;
  }

  const modal = document.getElementById("modal-video");

  if (modal) {
    modal.classList.add("open");
  }

  document.body.style.overflow = "hidden";
  modalPlaybackIndex = -1;
  syncPlaybackControlState();
}

// FULLSCREEN BUTTON
function openCameraFullscreen(camId) {
  console.log("openCameraFullscreen called:", camId);

  const cam = cameras.find((c) => String(c.id) === String(camId));

  if (!cam) {
    _showToast("⚠ Camera not found.");
    console.warn("Camera not found:", camId, cameras);
    return;
  }

  openCamera(cam.id);

  const screen = document.getElementById("vm-screen");

  if (!screen) {
    _showToast("⚠ Fullscreen area not found.");
    return;
  }

  setTimeout(() => {
    try {
      if (screen.requestFullscreen) {
        screen.requestFullscreen();
      } else if (screen.webkitRequestFullscreen) {
        screen.webkitRequestFullscreen();
      } else if (screen.msRequestFullscreen) {
        screen.msRequestFullscreen();
      } else {
        _showToast("⚠ Fullscreen is not supported.");
      }
    } catch (e) {
      console.warn("Fullscreen failed:", e);
      _showToast("⚠ Browser blocked fullscreen. Use the fullscreen button inside the video modal.");
    }
  }, 100);
}

// TURN OFF LOCAL CAMERA BUTTON
function turnOffLocalCamera(encodedDeviceId) {
  const deviceId = decodeURIComponent(encodedDeviceId);
  const stream = localCamStreams.get(deviceId);

  if (!stream) {
    _showToast("⚠ Camera already off.");
    return;
  }

  const activeRecording = _activeRecorders.get(deviceId);

  if (activeRecording) {
    try {
      _clearSegmentTimer(activeRecording);
      activeRecording.recorder.stop();
      _activeRecorders.delete(deviceId);
    } catch (e) {
      console.warn("Failed to stop active recording before camera off:", e);
    }
  }

  stream.getTracks().forEach((track) => {
    track.stop();
  });

  localCamStreams.delete(deviceId);

  _showToast("📷 Camera turned off");

  mergeCameras();
}

// REFRESH LOCAL CAMERAS
async function turnOnLocalCamerasAgain() {
  await loadLocalCameras();
  await loadStats();
  _showToast("📷 Local cameras refreshed");
}

// OPEN PLAYBACK
function openPlayback(id, options = {}) {
  const { skipRender = false, skipScript = false } = options;
  const rec = findPlaybackItem(id);

  if (!rec) return;

  activeInlinePlaybackId = rec.id;
  if (!skipRender) {
    renderPlayback();
  } else if (!skipScript) {
    loadPlaybackScript(rec.id);
  }
  modalPlaybackIndex = recordings.findIndex((r) => String(r.id) === String(id));
  const watch = document.getElementById("playback-watch");
  const video = document.getElementById("pw-video");
  const empty = document.getElementById("pw-empty");
  const titleEl = document.getElementById("pw-title");
  const subEl = document.getElementById("pw-sub");
  const downloadBtn = document.getElementById("pw-download-btn");

  if (!watch || !video || !empty || !titleEl || !subEl || !downloadBtn) return;
  const playbackId = String(rec.id);
  const requestToken = ++inlinePlaybackRequestToken;

  watch.style.display = "block";
  const pickHint = document.getElementById("playback-pick-hint");
  if (pickHint) pickHint.classList.add("is-hidden");
  titleEl.textContent = rec.title || "Playback";
  const aiLine = rec.aiSummary ? ` · ${rec.aiSummary.slice(0, 120)}${rec.aiSummary.length > 120 ? "…" : ""}` : "";
  subEl.textContent = `${rec.resident || "Unknown"} · ${rec.date || "Unknown date"} · ${rec.type || "Recording"}${aiLine}`;

  // AI Summary button
  var existingAiBtn = document.getElementById("pw-ai-summary-btn");
  if (existingAiBtn) existingAiBtn.remove();
  if (rec.id && !rec.vaultLocalId) {
    var aiBtn = document.createElement("button");
    aiBtn.id = "pw-ai-summary-btn";
    aiBtn.textContent = rec.aiSummary ? "✨ Regenerate AI Summary" : "✨ Generate AI Summary";
    aiBtn.style.cssText = "margin-top:8px;font-size:12px;padding:5px 12px;border-radius:8px;border:1px solid #6366f1;background:transparent;color:#6366f1;cursor:pointer;font-weight:600;display:block;";
    aiBtn.onclick = async function() {
      aiBtn.disabled = true; aiBtn.textContent = "Generating…";
      try {
        const t = sessionStorage.getItem("access_token") || "";
        const res = await fetch(API_BASE + "/records/" + rec.id + "/ai-summary", {
          method: "POST",
          headers: { "Authorization": "Bearer " + t, "Content-Type": "application/json" },
        });
        const data = await res.json();
        if (res.ok && data.ai_summary) {
          rec.aiSummary = data.ai_summary;
          const aiLine2 = ` · ${data.ai_summary.slice(0, 120)}${data.ai_summary.length > 120 ? "…" : ""}`;
          subEl.textContent = `${rec.resident || "Unknown"} · ${rec.date || "Unknown date"} · ${rec.type || "Recording"}${aiLine2}`;
          aiBtn.textContent = "✨ Regenerate AI Summary";
        } else {
          aiBtn.textContent = data.detail || "Unavailable";
        }
      } catch(e) { aiBtn.textContent = "Failed"; }
      aiBtn.disabled = false;
    };
    subEl.parentNode.insertBefore(aiBtn, subEl.nextSibling);
  }

  if (window._inlineBlobUrl) {
    URL.revokeObjectURL(window._inlineBlobUrl);
    window._inlineBlobUrl = null;
  }

  video.pause();
  video.removeAttribute("src");
  video.load();
  video.playbackRate = 1;
  video.volume = 1;
  video.muted = false;
  empty.style.display = "none";
  downloadBtn.href = "#";
  syncInlinePlaybackControls();

  const setUnavailable = (msg, withUnlockAction = false) => {
    if (withUnlockAction) {
      empty.innerHTML = `
        <div style="text-align:center;">
          <div style="font-size:14px;font-weight:700;margin-bottom:8px;">${escapeHtml(msg)}</div>
          <button
            type="button"
            id="pw-unlock-play-btn"
            style="padding:8px 12px;border-radius:8px;border:none;background:#0ea5e9;color:#fff;font-size:12px;font-weight:700;cursor:pointer;"
          >
            Unlock & Play
          </button>
        </div>
      `;
      const btn = document.getElementById("pw-unlock-play-btn");
      if (btn) {
        btn.addEventListener("click", async () => {
          try {
            const vault = window.recordingVault;
            if (!vault?.vaultHasPassword || !vault?.vaultUnlock || !vault?.vaultSetPassword) {
              _showToast("⚠ Vault module is not loaded.");
              return;
            }
            const hasPassword = await vault.vaultHasPassword();
            if (!hasPassword) {
              const newPass = prompt("Set a new vault password (minimum 8 characters):");
              if (!newPass) return;
              if (String(newPass).length < 8) {
                _showToast("⚠ Password must be at least 8 characters.");
                return;
              }
              await vault.vaultSetPassword(newPass);
            } else {
              const pass = prompt("Enter vault password to unlock recording:");
              if (!pass) return;
              await vault.vaultUnlock(pass);
            }
            _showToast("🔓 Vault unlocked");
            openPlayback(rec.id);
          } catch (e) {
            console.warn("Inline unlock failed:", e);
            _showToast("⚠ Vault unlock failed.");
          }
        });
      }
    } else {
      empty.textContent = msg;
    }
    empty.style.display = "flex";
  };

  const attachSrc = (src) => {
    if (requestToken !== inlinePlaybackRequestToken) return;
    if (!isActivePlaybackId(playbackId)) return;
    video.src = src;
    downloadBtn.href = src;
    video.play().catch(() => {});
    syncInlinePlaybackControls();
  };

  if (!rec.fileUrl || rec.fileUrl === "#") {
    setUnavailable("No playback source for this recording.");
    return;
  }

  if (String(rec.fileUrl).startsWith("localvault://")) {
    const vault = window.recordingVault;
    const recordId = rec.fileUrl.replace("localvault://", "");

    if (!vault || !vault.vaultIsUnlocked()) {
      setUnavailable("Vault is locked. Unlock vault to play this recording.", true);
      return;
    }

    empty.textContent = "Decrypting recording...";
    empty.style.display = "flex";

    (async () => {
      try {
        const all = await vault.vaultListRecordings();
        const entry = all.find((v) => v.id === recordId);
        if (!entry) {
          setUnavailable("Recording not found in local vault.");
          return;
        }

        const plain = await vault.vaultDecryptToArrayBuffer(entry.ivB64, entry.cipherB64);
        const mime = entry.mimeType || "video/webm";
        const blob = new Blob([plain], { type: mime });
        const blobUrl = URL.createObjectURL(blob);
        window._inlineBlobUrl = blobUrl;
        if (requestToken !== inlinePlaybackRequestToken || !isActivePlaybackId(playbackId)) {
          URL.revokeObjectURL(blobUrl);
          return;
        }
        empty.style.display = "none";
        attachSrc(blobUrl);
      } catch (err) {
        if (!isActivePlaybackId(playbackId)) return;
        console.error("Inline vault playback failed:", err);
        setUnavailable("Failed to decrypt this recording.");
      }
    })();

    return;
  }

  if (String(rec.fileUrl).startsWith("staging://")) {
    const stagingPath = rec.fileUrl.replace("staging://", "");
    const slash = stagingPath.indexOf("/");
    const folder = slash === -1 ? stagingPath : stagingPath.slice(0, slash);
    const video = rec.stagingVideo || (slash === -1 ? null : stagingPath.slice(slash + 1));
    empty.textContent = "Loading staging video…";
    empty.style.display = "flex";

    (async () => {
      try {
        const res = await fetch(stagingVideoApiUrl(folder, video), { headers: authHeaders() });
        if (handleUnauthorizedResponse(res)) return;
        if (!res.ok) throw new Error(await res.text());
        const mime = rec.stagingMime || res.headers.get("content-type") || "video/mp4";
        const blob = new Blob([await res.arrayBuffer()], { type: mime });
        const blobUrl = URL.createObjectURL(blob);
        window._inlineBlobUrl = blobUrl;
        if (requestToken !== inlinePlaybackRequestToken || !isActivePlaybackId(playbackId)) {
          URL.revokeObjectURL(blobUrl);
          return;
        }
        empty.style.display = "none";
        attachSrc(blobUrl);
      } catch (err) {
        if (!isActivePlaybackId(playbackId)) return;
        console.error("Staging playback failed:", err);
        setUnavailable("Failed to load staging video.");
      }
    })();

    return;
  }

  attachSrc(rec.fileUrl);
}

// CLOSE MODAL
function closeModal() {
  const modal = document.getElementById("modal-video");

  if (modal) {
    modal.classList.remove("open");
  }

  document.body.style.overflow = "";
  isPlaying = false;

  clearInterval(progressInterval);
  clearInterval(window._modalTick);

  if (activeHls) {
    activeHls.destroy();
    activeHls = null;
  }

  if (window._modalVideo) {
    window._modalVideo.pause();
    window._modalVideo = null;
  }

  if (window._modalBlobUrl) {
    URL.revokeObjectURL(window._modalBlobUrl);
    window._modalBlobUrl = null;
  }

  syncPlaybackControlState();
}

function _setPlayIcon(playing) {
  const icon = document.getElementById("vm-play-icon");
  if (!icon) return;
  icon.innerHTML = playing
    ? '<rect x="6" y="4" width="4" height="16" fill="white"/><rect x="14" y="4" width="4" height="16" fill="white"/>'
    : '<polygon points="5 3 19 12 5 21 5 3" fill="white" stroke="none"/>';
}

function _setMuteIcon(muted) {
  const icon = document.getElementById("vm-mute-icon");
  if (!icon) return;
  icon.innerHTML = muted
    ? '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="16" y1="8" x2="22" y2="14"/><line x1="22" y1="8" x2="16" y2="14"/>'
    : '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/>';
}

function syncPlaybackControlState() {
  const video = window._modalVideo;
  const speedEl = document.getElementById("vm-speed");
  const volumeEl = document.getElementById("vm-volume");

  if (!video) {
    _setPlayIcon(false);
    _setMuteIcon(false);
    if (speedEl) speedEl.value = "1";
    if (volumeEl) volumeEl.value = "1";
    return;
  }

  _setPlayIcon(!video.paused);
  _setMuteIcon(video.muted || video.volume === 0);

  if (speedEl) speedEl.value = String(video.playbackRate || 1);
  if (volumeEl) volumeEl.value = String(video.muted ? 0 : video.volume ?? 1);
}

const modalVideoEl = document.getElementById("modal-video");

if (modalVideoEl) {
  modalVideoEl.addEventListener("click", (e) => {
    if (e.target === modalVideoEl) {
      closeModal();
    }
  });
}

// TOGGLE PLAY
function togglePlay() {
  if (window._modalVideo) {
    if (window._modalVideo.paused) {
      window._modalVideo.play();
      isPlaying = true;
    } else {
      window._modalVideo.pause();
      isPlaying = false;
    }

    _setPlayIcon(isPlaying);

    return;
  }

  isPlaying = !isPlaying;

  if (isPlaying) {
    _setPlayIcon(true);

    progressInterval = setInterval(() => {
      const fill = document.getElementById("vm-progress-fill");

      if (!fill) return;

      const w = parseFloat(fill.style.width) || 0;

      if (w >= 100) {
        clearInterval(progressInterval);
        isPlaying = false;
        return;
      }

      fill.style.width = w + 0.25 + "%";
    }, 100);
  } else {
    _setPlayIcon(false);

    clearInterval(progressInterval);
  }
}

function seekRelative(seconds) {
  const video = window._modalVideo;
  if (!video || !video.duration) return;
  const nextTime = Math.max(0, Math.min(video.duration, video.currentTime + seconds));
  video.currentTime = nextTime;
}

function toggleMute() {
  const video = window._modalVideo;
  const volumeEl = document.getElementById("vm-volume");

  if (!video) return;

  video.muted = !video.muted;
  _setMuteIcon(video.muted || video.volume === 0);

  if (volumeEl && !video.muted) {
    volumeEl.value = String(video.volume || 1);
  } else if (volumeEl && video.muted) {
    volumeEl.value = "0";
  }
}

// SEEK VIDEO
function seekVideo(e) {
  const bar = e.currentTarget;
  const pct = (e.offsetX / bar.offsetWidth) * 100;

  const fill = document.getElementById("vm-progress-fill");

  if (fill) {
    fill.style.width = pct + "%";
  }

  if (window._modalVideo && window._modalVideo.duration) {
    window._modalVideo.currentTime = (pct / 100) * window._modalVideo.duration;
  }
}

// CLOCK
function tick() {
  const d = new Date();

  const dateEl = document.getElementById("tb-date");
  const timeEl = document.getElementById("tb-time");

  if (dateEl) {
    dateEl.textContent = d.toLocaleDateString("en-AU", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  }

  if (timeEl) {
    timeEl.textContent = d.toLocaleTimeString("en-AU", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }
}

tick();
setInterval(tick, 1000);

// API STATUS
function showApiStatus(connected) {
  let el = document.getElementById("api-status-toast");

  if (!el) {
    el = document.createElement("div");
    el.id = "api-status-toast";
    el.style.cssText = `
      position: fixed;
      bottom: 18px;
      right: 18px;
      padding: 8px 14px;
      border-radius: 10px;
      font-size: 12px;
      font-weight: 700;
      z-index: 9999;
      transition: opacity 3s;
      font-family: Inter, sans-serif;
    `;

    document.body.appendChild(el);
  }

  el.textContent = connected ? "✓ Connected to API" : "⚠ Using local/demo camera mode";
  el.style.background = connected ? "#dcfce7" : "#fff7ed";
  el.style.color = connected ? "#15803d" : "#c2410c";
  el.style.opacity = "1";

  setTimeout(() => {
    el.style.opacity = "0";
  }, 3000);
}

// TOP ALERTS BUTTON
const alertsTopBtn = document.getElementById("alerts-topbtn");

if (alertsTopBtn) {
  alertsTopBtn.addEventListener("click", () => {
    const alertTab = document.querySelectorAll(".page-tab")[2];
    switchTab("alerts", alertTab);
  });
}

// MODAL NAV BUTTONS
const prevBtn = document.getElementById("vm-prev-btn");
const nextBtn = document.getElementById("vm-next-btn");
const fullscreenBtn = document.getElementById("vm-fullscreen-btn");
const rewindBtn = document.getElementById("vm-rewind-btn");
const forwardBtn = document.getElementById("vm-forward-btn");
const muteBtn = document.getElementById("vm-mute-btn");
const pipBtn = document.getElementById("vm-pip-btn");
const speedSel = document.getElementById("vm-speed");
const volumeSlider = document.getElementById("vm-volume");
const inlineCloseBtn = document.getElementById("pw-close-btn");
const inlineVideo = document.getElementById("pw-video");
const inlinePlayBtn = document.getElementById("pw-playpause-btn");
const inlineRewindBtn = document.getElementById("pw-rewind-btn");
const inlineForwardBtn = document.getElementById("pw-forward-btn");
const inlineProgress = document.getElementById("pw-progress");
const inlineMuteBtn = document.getElementById("pw-mute-btn");
const inlineVolume = document.getElementById("pw-volume");
const inlineSpeed = document.getElementById("pw-speed");
const inlinePip = document.getElementById("pw-pip-btn");
const inlineFs = document.getElementById("pw-fullscreen-btn");
const inlineSnapshot = document.getElementById("pw-snapshot-btn");

if (prevBtn) {
  prevBtn.addEventListener("click", () => {
    if (modalPlaybackIndex <= 0) return;
    openPlayback(recordings[modalPlaybackIndex - 1].id);
  });
}

if (nextBtn) {
  nextBtn.addEventListener("click", () => {
    if (modalPlaybackIndex < 0 || modalPlaybackIndex >= recordings.length - 1) return;
    openPlayback(recordings[modalPlaybackIndex + 1].id);
  });
}

if (fullscreenBtn) {
  fullscreenBtn.addEventListener("click", () => {
    const el = document.getElementById("vm-screen");

    if (!el) return;

    if (document.fullscreenElement) {
      document.exitFullscreen?.();
    } else if (el.requestFullscreen) {
      el.requestFullscreen();
    } else if (el.webkitRequestFullscreen) {
      el.webkitRequestFullscreen();
    }
  });
}

if (rewindBtn) {
  rewindBtn.addEventListener("click", () => {
    seekRelative(-MODAL_SKIP_SECONDS);
  });
}

if (forwardBtn) {
  forwardBtn.addEventListener("click", () => {
    seekRelative(MODAL_SKIP_SECONDS);
  });
}

if (muteBtn) {
  muteBtn.addEventListener("click", toggleMute);
}

if (speedSel) {
  speedSel.addEventListener("change", () => {
    const video = window._modalVideo;
    const speed = Number(speedSel.value);
    if (video && Number.isFinite(speed) && speed > 0) {
      video.playbackRate = speed;
    }
  });
}

if (volumeSlider) {
  volumeSlider.addEventListener("input", () => {
    const video = window._modalVideo;
    const vol = Number(volumeSlider.value);
    if (!video || !Number.isFinite(vol)) return;
    video.volume = Math.max(0, Math.min(1, vol));
    video.muted = video.volume === 0;
    _setMuteIcon(video.muted);
  });
}

if (pipBtn) {
  pipBtn.addEventListener("click", async () => {
    const video = window._modalVideo;
    if (!video || typeof video.requestPictureInPicture !== "function") return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else {
        await video.requestPictureInPicture();
      }
    } catch (e) {
      console.warn("Picture-in-picture failed:", e);
    }
  });
}

if (inlineCloseBtn) {
  inlineCloseBtn.addEventListener("click", () => {
    const watch = document.getElementById("playback-watch");
    const video = document.getElementById("pw-video");
    if (video) {
      video.pause();
      video.removeAttribute("src");
      video.load();
    }
    if (window._inlineBlobUrl) {
      URL.revokeObjectURL(window._inlineBlobUrl);
      window._inlineBlobUrl = null;
    }
    inlinePlaybackRequestToken += 1;
    if (watch) watch.style.display = "none";
    const pickHint = document.getElementById("playback-pick-hint");
    if (pickHint) pickHint.classList.remove("is-hidden");
  });
}

if (inlineVideo) {
  inlineVideo.addEventListener("play", syncInlinePlaybackControls);
  inlineVideo.addEventListener("pause", syncInlinePlaybackControls);
  inlineVideo.addEventListener("timeupdate", syncInlinePlaybackControls);
  inlineVideo.addEventListener("loadedmetadata", syncInlinePlaybackControls);
  inlineVideo.addEventListener("volumechange", syncInlinePlaybackControls);
  inlineVideo.addEventListener("ratechange", syncInlinePlaybackControls);
  inlineVideo.addEventListener("ended", () => {
    if (modalPlaybackIndex >= 0 && modalPlaybackIndex < recordings.length - 1) {
      openPlayback(recordings[modalPlaybackIndex + 1].id);
    }
  });
}

if (inlinePlayBtn) {
  inlinePlayBtn.addEventListener("click", () => {
    if (!inlineVideo) return;
    if (inlineVideo.paused) inlineVideo.play().catch(() => {});
    else inlineVideo.pause();
  });
}

if (inlineRewindBtn) {
  inlineRewindBtn.addEventListener("click", () => {
    if (!inlineVideo) return;
    inlineVideo.currentTime = Math.max(0, (inlineVideo.currentTime || 0) - MODAL_SKIP_SECONDS);
  });
}

if (inlineForwardBtn) {
  inlineForwardBtn.addEventListener("click", () => {
    if (!inlineVideo || !inlineVideo.duration) return;
    inlineVideo.currentTime = Math.min(inlineVideo.duration, (inlineVideo.currentTime || 0) + MODAL_SKIP_SECONDS);
  });
}

if (inlineProgress) {
  inlineProgress.addEventListener("input", () => {
    if (!inlineVideo || !inlineVideo.duration) return;
    const pct = Number(inlineProgress.value) / 100;
    inlineVideo.currentTime = pct * inlineVideo.duration;
  });
}

if (inlineMuteBtn) {
  inlineMuteBtn.addEventListener("click", () => {
    if (!inlineVideo) return;
    inlineVideo.muted = !inlineVideo.muted;
    syncInlinePlaybackControls();
  });
}

if (inlineVolume) {
  inlineVolume.addEventListener("input", () => {
    if (!inlineVideo) return;
    const val = Math.max(0, Math.min(1, Number(inlineVolume.value)));
    inlineVideo.volume = val;
    inlineVideo.muted = val === 0;
    syncInlinePlaybackControls();
  });
}

if (inlineSpeed) {
  inlineSpeed.addEventListener("change", () => {
    if (!inlineVideo) return;
    const val = Number(inlineSpeed.value);
    if (Number.isFinite(val) && val > 0) {
      inlineVideo.playbackRate = val;
    }
  });
}

if (inlinePip) {
  inlinePip.addEventListener("click", async () => {
    if (!inlineVideo || typeof inlineVideo.requestPictureInPicture !== "function") return;
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await inlineVideo.requestPictureInPicture();
    } catch (e) {
      console.warn("Inline PiP failed:", e);
    }
  });
}

if (inlineFs) {
  inlineFs.addEventListener("click", async () => {
    const wrap = document.querySelector(".pw-video-wrap");
    if (!wrap) return;
    try {
      if (document.fullscreenElement) await document.exitFullscreen?.();
      else if (wrap.requestFullscreen) await wrap.requestFullscreen();
    } catch (e) {
      console.warn("Inline fullscreen failed:", e);
    }
  });
}

if (inlineSnapshot) {
  inlineSnapshot.addEventListener("click", () => {
    if (!inlineVideo || !inlineVideo.videoWidth || !inlineVideo.videoHeight) {
      _showToast("⚠ Video frame not ready for snapshot.");
      return;
    }

    try {
      const canvas = document.createElement("canvas");
      canvas.width = inlineVideo.videoWidth;
      canvas.height = inlineVideo.videoHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        _showToast("⚠ Snapshot failed.");
        return;
      }

      ctx.drawImage(inlineVideo, 0, 0, canvas.width, canvas.height);
      const a = document.createElement("a");
      a.href = canvas.toDataURL("image/png");
      a.download = `snapshot_${Date.now()}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      _showToast("📸 Snapshot captured");
    } catch (e) {
      console.warn("Snapshot capture failed:", e);
      _showToast("⚠ Snapshot blocked (cross-origin video).");
    }
  });
}

document.addEventListener("keydown", (event) => {
  const modalOpen = document.getElementById("modal-video")?.classList.contains("open");
  const inlineOpen = document.getElementById("playback-watch")?.style.display !== "none";
  if (!modalOpen && !inlineOpen) return;
  if (event.target && ["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName)) return;

  if (inlineOpen && !modalOpen) {
    const video = document.getElementById("pw-video");
    if (!video) return;

    if (event.key.toLowerCase() === "k" || event.code === "Space") {
      event.preventDefault();
      if (video.paused) video.play().catch(() => {});
      else video.pause();
    } else if (event.key.toLowerCase() === "j" || event.code === "ArrowLeft") {
      event.preventDefault();
      video.currentTime = Math.max(0, (video.currentTime || 0) - MODAL_SKIP_SECONDS);
    } else if (event.key.toLowerCase() === "l" || event.code === "ArrowRight") {
      event.preventDefault();
      if (video.duration) {
        video.currentTime = Math.min(video.duration, (video.currentTime || 0) + MODAL_SKIP_SECONDS);
      }
    } else if (event.key.toLowerCase() === "m") {
      event.preventDefault();
      video.muted = !video.muted;
      syncInlinePlaybackControls();
    } else if (event.key.toLowerCase() === "f") {
      event.preventDefault();
      inlineFs?.click();
    }
    return;
  }

  if (event.code === "Space") {
    event.preventDefault();
    togglePlay();
  } else if (event.code === "ArrowLeft") {
    event.preventDefault();
    seekRelative(-MODAL_SKIP_SECONDS);
  } else if (event.code === "ArrowRight") {
    event.preventDefault();
    seekRelative(MODAL_SKIP_SECONDS);
  } else if (event.key.toLowerCase() === "m") {
    event.preventDefault();
    toggleMute();
  } else if (event.key.toLowerCase() === "f") {
    event.preventDefault();
    fullscreenBtn?.click();
  }
});

// BEFORE UNLOAD
window.addEventListener("beforeunload", () => {
  for (const stream of localCamStreams.values()) {
    stream.getTracks().forEach((t) => t.stop());
  }

  if (window._inlineBlobUrl) {
    URL.revokeObjectURL(window._inlineBlobUrl);
    window._inlineBlobUrl = null;
  }
});

// GRID ERROR
function showGridError(elId, type) {
  const el = document.getElementById(elId);

  if (el) {
    el.innerHTML = `
      <div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--red);font-size:13px;font-weight:600;">
        ⚠ Unable to load ${escapeHtml(type)}. Please check your connection.
      </div>
    `;
  }
}

// RC MODAL HELPERS
function openRcModal(id) {
  const modal = document.getElementById(id);

  if (!modal) return;

  modal.classList.add("show");

  const input = modal.querySelector("input, textarea, select");

  setTimeout(() => {
    input?.focus();
  }, 80);
}

function closeRcModal(id) {
  const modal = document.getElementById(id);

  if (!modal) return;

  modal.classList.remove("show");
  if (id === "staging-delete-modal") {
    _stagingDeleteTarget = null;
    setRcStatus("staging-delete-status", "", "");
    const submitBtn = document.getElementById("staging-delete-submit");
    if (submitBtn) submitBtn.disabled = false;
  }
}

function setRcStatus(id, message, type) {
  const el = document.getElementById(id);

  if (!el) return;

  el.textContent = message || "";
  el.className = "rc-status";

  if (message) {
    el.classList.add(type === "ok" ? "ok" : "err");
  }
}

// VAULT UNLOCK
async function ensureVaultUnlockedForConsole() {
  if (window.recordingVault?.vaultIsUnlocked?.()) return true;
  _showToast("Unlock the vault first.");
  unlockVaultFromConsole();
  return false;
}

async function unlockVaultFromConsole() {
  setRcStatus("vault-unlock-status", "", "");

  const input = document.getElementById("vault-password-input");
  const title = document.getElementById("vault-unlock-title");
  const sub = document.getElementById("vault-unlock-sub");
  const label = document.getElementById("vault-password-label");
  const submit = document.getElementById("vault-unlock-submit");

  if (
    !window.recordingVault?.vaultHasPassword ||
    !window.recordingVault?.vaultUnlock ||
    !window.recordingVault?.vaultSetPassword
  ) {
    openRcModal("vault-unlock-modal");
    setRcStatus("vault-unlock-status", "Vault module is not loaded.", "err");
    return;
  }

  const hasPassword = await window.recordingVault.vaultHasPassword();

  if (input) input.value = "";
  if (title) title.textContent = hasPassword ? "Vault Unlock" : "Create Vault Password";

  if (sub) {
    sub.textContent = hasPassword
      ? "Enter your vault password to unlock encrypted recordings."
      : "Create a new password to protect encrypted vault recordings on this browser.";
  }

  if (label) label.textContent = hasPassword ? "Vault Password" : "New Vault Password";
  if (submit) submit.textContent = hasPassword ? "Unlock Vault" : "Create & Unlock";

  openRcModal("vault-unlock-modal");
}

async function submitVaultUnlockModal() {
  const input = document.getElementById("vault-password-input");
  const pass = input?.value?.trim();

  if (!pass) {
    setRcStatus("vault-unlock-status", "Please enter a password.", "err");
    return;
  }

  try {
    const hasPassword = await window.recordingVault.vaultHasPassword();

    if (!hasPassword) {
      if (pass.length < 8) {
        setRcStatus("vault-unlock-status", "Password must be at least 8 characters.", "err");
        return;
      }

      await window.recordingVault.vaultSetPassword(pass);
      setRcStatus("vault-unlock-status", "Vault password created and unlocked.", "ok");
      _showToast("🔐 Vault password created");
    } else {
      await window.recordingVault.vaultUnlock(pass);
      setRcStatus("vault-unlock-status", "Vault unlocked successfully.", "ok");
      _showToast("🔓 Vault unlocked");
    }

    setTimeout(() => {
      closeRcModal("vault-unlock-modal");
    }, 650);
  } catch (err) {
    setRcStatus("vault-unlock-status", `Vault unlock failed: ${err?.message || err}`, "err");
  }
}

// DELETE VAULT
async function deleteAllVaultRecordingsFromConsole() {
  setRcStatus("vault-delete-status", "", "");

  const input = document.getElementById("vault-delete-confirm");

  if (input) input.value = "";

  if (
    !window.recordingVault?.vaultListRecordings ||
    !window.recordingVault?.vaultDeleteRecording
  ) {
    openRcModal("vault-delete-modal");
    setRcStatus("vault-delete-status", "Vault module is not loaded.", "err");
    return;
  }

  if (!(await ensureVaultUnlockedForConsole())) {
    setRcStatus("vault-delete-status", "Unlock the vault first, then delete.", "err");
    return;
  }

  openRcModal("vault-delete-modal");
}

async function submitDeleteVaultModal() {
  const confirmText = document.getElementById("vault-delete-confirm")?.value?.trim();

  if (confirmText !== DELETE_CONFIRM_WORD) {
    setRcStatus("vault-delete-status", `Type ${DELETE_CONFIRM_WORD} to confirm this action.`, "err");
    return;
  }

  if (!(await ensureVaultUnlockedForConsole())) {
    setRcStatus("vault-delete-status", "Vault is locked. Unlock first.", "err");
    return;
  }

  try {
    setRcStatus("vault-delete-status", "Deleting vault videos...", "ok");

    const localRows = await window.recordingVault.vaultListRecordings();

    for (const row of localRows) {
      await window.recordingVault.vaultDeleteRecording(row.id);
    }

    localStorage.removeItem(LOCAL_RECORDING_INDEX_KEY);

    let serverDeleted = 0;

    try {
      const res = await fetch(`${API_BASE}/records/bulk/all`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      if (handleUnauthorizedResponse(res)) return;
      if (res.ok) {
        const data = await res.json();
        serverDeleted = Number(data.deleted) || 0;
      }
    } catch (_) {}

    setRcStatus(
      "vault-delete-status",
      `Deleted ${localRows.length} local vault recording(s) and ${serverDeleted} server record(s).`,
      "ok"
    );

    _showToast("🗑 Vault videos deleted");

    await loadPlayback();

    setTimeout(() => {
      closeRcModal("vault-delete-modal");
    }, 900);
  } catch (err) {
    setRcStatus("vault-delete-status", `Failed to delete vault recordings: ${err?.message || err}`, "err");
  }
}

// CAMERA SETTINGS
function openCameraSettingsModal() {
  resetCameraSettingsForm();
  renderCameraSettingsList();
  openRcModal("camera-settings-modal");
}

function resetCameraSettingsForm() {
  const editId = document.getElementById("cam-edit-id");
  const title = document.getElementById("cam-title-input");
  const resident = document.getElementById("cam-resident-input");
  const floor = document.getElementById("cam-floor-input");
  const status = document.getElementById("cam-stream-status-input");
  const url = document.getElementById("cam-stream-url-input");
  const desc = document.getElementById("cam-description-input");
  const submit = document.getElementById("camera-settings-submit");

  if (editId) editId.value = "";
  if (title) title.value = "";
  if (resident) resident.value = "";
  if (floor) floor.value = "";
  if (status) status.value = "live";
  if (url) url.value = "";
  if (desc) desc.value = "";
  if (submit) submit.textContent = "Add Camera";

  setRcStatus("camera-settings-status", "", "");
}

function renderCameraSettingsList() {
  const list = document.getElementById("camera-settings-list");

  if (!list) return;

  const rows = cameras.filter((c) => c.source === "facility");

  if (!rows.length) {
    list.innerHTML = `
      <div style="padding:18px;text-align:center;color:#64748b;font-size:13px;font-weight:700;border:1px dashed #cbd5e1;border-radius:16px;">
        No facility cameras yet. Add one above.
      </div>
    `;
    return;
  }

  list.innerHTML = rows.map((c) => `
    <div class="rc-camera-row">
      <div>
        <div class="rc-camera-name">${escapeHtml(c.title || "Untitled Camera")}</div>
        <div class="rc-camera-meta">
          ${escapeHtml(c.floor || "No floor")} · 
          ${escapeHtml(c.resident || "Common Area")} · 
          ${c.status === "live" ? "Online" : "Offline"}
        </div>
      </div>

      <div class="rc-mini-actions">
        <button 
          type="button"
          class="rc-mini-btn" 
          onclick="editCameraInSettings(${Number(c.id)})"
        >
          Edit
        </button>

        <button 
          type="button"
          class="rc-mini-btn" 
          onclick="markCameraOffline(${Number(c.id)})"
        >
          Set Offline
        </button>
      </div>
    </div>
  `).join("");
}

function editCameraInSettings(id) {
  const cam = cameras.find((c) => c.source === "facility" && Number(c.id) === Number(id));

  if (!cam) return;

  document.getElementById("cam-edit-id").value = cam.id;
  document.getElementById("cam-title-input").value = cam.title || "";
  document.getElementById("cam-resident-input").value = cam.resident || "";
  document.getElementById("cam-floor-input").value = cam.floor || "";
  document.getElementById("cam-stream-status-input").value = cam.status === "live" ? "live" : "offline";
  document.getElementById("cam-stream-url-input").value = cam.streamUrl || "";
  document.getElementById("cam-description-input").value = cam.desc || "";
  document.getElementById("camera-settings-submit").textContent = "Save Changes";

  setRcStatus("camera-settings-status", "Editing camera details.", "ok");
}

async function submitCameraSettingsForm(event) {
  event.preventDefault();

  const editId = document.getElementById("cam-edit-id").value;
  const title = document.getElementById("cam-title-input").value.trim();
  const residentName = document.getElementById("cam-resident-input").value.trim();
  const floor = document.getElementById("cam-floor-input").value.trim();
  const streamStatus = document.getElementById("cam-stream-status-input").value;
  const streamUrl = document.getElementById("cam-stream-url-input").value.trim();
  const description = document.getElementById("cam-description-input").value.trim();

  if (!title) {
    setRcStatus("camera-settings-status", "Camera title is required.", "err");
    return;
  }

  try {
    let res;

    if (editId) {
      res = await fetch(`${API_BASE}/cameras/${encodeURIComponent(editId)}/status`, {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify({
          status: streamStatus === "live" ? "active" : "inactive",
          stream_status: streamStatus,
          description,
        }),
      });
    } else {
      res = await fetch(`${API_BASE}/cameras/`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          title,
          resident_name: residentName || null,
          floor: floor || null,
          description: description || null,
          stream_url: streamUrl || null,
        }),
      });
    }

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(text || res.statusText);
    }

    setRcStatus("camera-settings-status", editId ? "Camera updated." : "Camera added.", "ok");

    _showToast(editId ? "✅ Camera updated" : "✅ Camera added");

    await loadFacilityCameras();
    await loadStats();

    renderCameraSettingsList();

    if (!editId) {
      resetCameraSettingsForm();
    }
  } catch (err) {
    setRcStatus("camera-settings-status", `Camera save failed: ${err?.message || err}`, "err");
  }
}

async function markCameraOffline(id) {
  try {
    const res = await fetch(`${API_BASE}/cameras/${encodeURIComponent(id)}/status`, {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify({
        status: "inactive",
        stream_status: "offline",
      }),
    });

    if (!res.ok) throw new Error(await res.text());

    _showToast("📷 Camera set offline");

    await loadFacilityCameras();
    await loadStats();

    renderCameraSettingsList();
  } catch (err) {
    setRcStatus("camera-settings-status", `Failed to update camera: ${err?.message || err}`, "err");
  }
}

document.addEventListener("click", (event) => {
  const overlay = event.target;

  if (overlay?.classList?.contains("rc-modal-overlay")) {
    overlay.classList.remove("show");
  }
});

// RECORDING
function toggleRecording(camId) {
  console.log("toggleRecording called:", camId);

  const cam = cameras.find((c) => String(c.id) === String(camId));

  if (!cam) {
    _showToast("⚠ Camera not found.");
    console.warn("Camera not found:", camId, cameras);
    return;
  }

  if (cam.source !== "local") {
    _showToast("⚠ Recording only works for local camera.");
    return;
  }

  const deviceId = cam.deviceId;

  if (_activeRecorders.has(deviceId)) {
    stopRecording(deviceId, cam);
  } else {
    startRecording(deviceId, cam);
  }
}

function startRecording(deviceId, cam) {
  console.log("startRecording called:", deviceId, cam);

  // Vault must be unlocked before recording so video gets encrypted into IndexedDB
  if (!window.recordingVault?.vaultIsUnlocked?.()) {
    _showToast("\uD83D\uDD12 Unlock the Vault first — recordings won't be playable without it.");

    if (typeof unlockVaultFromConsole === "function") {
      setTimeout(() => unlockVaultFromConsole(), 300);
    }

    return;
  }

  const stream = localCamStreams.get(deviceId);

  if (!stream) {
    _showToast("⚠ Camera stream not available.");
    console.warn("No stream found for:", deviceId, localCamStreams);
    return;
  }

  if (!window.MediaRecorder) {
    _showToast("⚠ MediaRecorder is not supported by this browser.");
    return;
  }

  let mimeType = "";

  if (MediaRecorder.isTypeSupported("video/webm;codecs=vp9")) {
    mimeType = "video/webm;codecs=vp9";
  } else if (MediaRecorder.isTypeSupported("video/webm;codecs=vp8")) {
    mimeType = "video/webm;codecs=vp8";
  } else if (MediaRecorder.isTypeSupported("video/webm")) {
    mimeType = "video/webm";
  }

  let recorder;

  try {
    recorder = mimeType
      ? new MediaRecorder(stream, { mimeType })
      : new MediaRecorder(stream);
  } catch (e) {
    console.error("MediaRecorder creation failed:", e);
    _showToast("⚠ Cannot start recording on this browser.");
    return;
  }

  const chunks = [];

  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) {
      chunks.push(e.data);
    }
  };

  recorder.onerror = (e) => {
    console.error("Recorder error:", e);
    _showToast("⚠ Recording error.");
  };

  const recState = {
    recorder,
    chunks,
    cam,
    deviceId,
    startTime: new Date().toISOString(),
    startMs: Date.now(),
    segmentStartMs: Date.now(),
    segmentStartIso: new Date().toISOString(),
    segmentIndex: 0,
    segmentCutting: false,
    uploadQueue: Promise.resolve(),
    uploadedSegments: 0,
    camId: cam.id,
    camTitle: cam.title,
    segmentTimer: null,
  };

  _activeRecorders.set(deviceId, recState);
  recorder.start(1000);

  recState.segmentTimer = setInterval(() => {
    const active = _activeRecorders.get(deviceId);
    if (!active || active.recorder?.state !== "recording") return;
    const elapsed = Date.now() - active.segmentStartMs;
    if (elapsed >= SCVA_ANALYSIS_CHUNK_SECONDS * 1000) {
      _flushRecordingSegment(deviceId, { isFinal: false }).catch((err) =>
        console.warn("Rolling segment flush failed:", err)
      );
    }
  }, 1000);

  _updateRecordBtn(deviceId, true);
  _showToast(
    "🔴 Recording started — " +
      cam.title +
      " (" +
      SCVA_ANALYSIS_CHUNK_SECONDS +
      "s segments)"
  );
}

function _clearSegmentTimer(rec) {
  if (rec?.segmentTimer) {
    clearInterval(rec.segmentTimer);
    rec.segmentTimer = null;
  }
}

async function stopRecording(deviceId, cam) {
  console.log("stopRecording called:", deviceId, cam);

  const rec = _activeRecorders.get(deviceId);

  if (!rec) return;

  _clearSegmentTimer(rec);

  return new Promise((resolve) => {
    rec.recorder.onstop = async () => {
      _showToast("⏹ Recording stopped — processing…");
      try {
        await _flushRecordingSegment(deviceId, { isFinal: true });
        await rec.uploadQueue;
      } catch (err) {
        console.warn("Final segment flush failed:", err);
      }
      const totalDurationSec = Math.max(1, Math.round((Date.now() - rec.startMs) / 1000));
      _activeRecorders.delete(deviceId);
      _updateRecordBtn(deviceId, false);
      await loadPlayback();
      _showPipelineComplete(cam.title, totalDurationSec, "");
      resolve();
    };

    try {
      if (rec.recorder.state === "recording") {
        try {
          rec.recorder.requestData();
        } catch (_) {}
      }
      rec.recorder.stop();
    } catch (e) {
      console.error("Recorder stop failed:", e);
      _clearSegmentTimer(rec);
      _activeRecorders.delete(deviceId);
      _updateRecordBtn(deviceId, false);
      resolve();
    }
  });
}

async function _flushRecordingSegment(deviceId, { isFinal = false } = {}) {
  const rec = _activeRecorders.get(deviceId);
  if (!rec) return;
  if (rec.segmentCutting) return;

  rec.segmentCutting = true;
  try {
    if (rec.recorder?.state === "recording" && !isFinal) {
      try {
        rec.recorder.requestData();
      } catch (_) {}
      await new Promise((resolve) => setTimeout(resolve, 150));
    }

    const endedAtIso = new Date().toISOString();
    const segmentChunks = rec.chunks.splice(0, rec.chunks.length);
    if (!segmentChunks.length) return;

    const startedAtIso = rec.segmentStartIso || rec.startTime;
    const durationMs = Math.max(1, new Date(endedAtIso) - new Date(startedAtIso));
    const segmentNo = rec.segmentIndex + 1;
    rec.segmentIndex = segmentNo;
    rec.segmentStartMs = Date.now();
    rec.segmentStartIso = endedAtIso;

    const blob = new Blob(segmentChunks, {
      type: rec.recorder.mimeType || "video/webm",
    });

    const cam = rec.cam;
    if (!cam) return;

    const durationSec = Math.max(1, Math.round(durationMs / 1000));
    if (!isFinal) {
      _showToast(`📤 Segment ${segmentNo} (${durationSec}s) uploading…`);
    }

    rec.uploadQueue = rec.uploadQueue.then(async () => {
      await _uploadRecordingSegment({
        blob,
        rec,
        cam,
        startedAt: startedAtIso,
        endedAt: endedAtIso,
        durationMs,
        segmentNo,
        isFinal,
      });
      rec.uploadedSegments += 1;
    });
  } finally {
    rec.segmentCutting = false;
  }

  return rec.uploadQueue;
}

async function _uploadRecordingSegment({
  blob,
  rec,
  cam,
  startedAt,
  endedAt,
  durationMs,
  segmentNo,
  isFinal,
}) {
  const durationSec = Math.max(1, Math.round(durationMs / 1000));
  const analyzeThisSegment =
    isCameraAiEnabled(getCameraAiKey(cam)) && durationSec >= SCVA_MIN_AI_SECONDS;
  const recordId = `rec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}_s${segmentNo}`;

  const arrBuf = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });

  let ivB64 = "";
  let cipherB64 = "";
  try {
    const vault = window.recordingVault;
    if (vault && vault.vaultIsUnlocked()) {
      const encrypted = await vault.vaultEncryptArrayBuffer(arrBuf.slice(0));
      ivB64 = encrypted.ivB64;
      cipherB64 = encrypted.cipherB64;
      await vault.vaultSaveRecording(
        {
          id: recordId,
          ivB64,
          cipherB64,
          mimeType: blob.type || "video/webm",
          cameraLabel: `${cam.title} (segment ${segmentNo})`,
          startedAt,
          endedAt,
          durationMs,
          sizePlain: blob.size,
        },
        { syncServer: false }
      );
    }
  } catch (e) {
    console.warn("Vault save failed:", e);
  }

  try {
    let rawB64 = "";
    if (window.recordingVault?.bufToB64) {
      rawB64 = window.recordingVault.bufToB64(new Uint8Array(arrBuf.slice(0)));
    }

    const payload = {
      record_id: recordId,
      file_url: `localvault://${recordId}`,
      resident_name: cam.resident || "This device",
      category: `${cam.title || "Camera Recording"} (segment ${segmentNo})`,
      record_type: "video",
      mime_type: blob.type || "video/webm",
      duration: durationSec,
      started_at: startedAt,
      ended_at: endedAt,
      iv_b64: ivB64 || "none",
      cipher_b64: cipherB64 || rawB64 || "",
      ai_plain_b64: rawB64 || "",
      ai_analyze: analyzeThisSegment,
      room: cam.floor || "Local",
      camera_id: String(cam.id || cam.deviceId || "local-camera"),
      notes: `Auto-recorded from ${cam.title} (segment ${segmentNo})`,
    };

    const res = await fetch(API_BASE + "/records/vault/upload", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(payload),
    });
    if (handleUnauthorizedResponse(res)) return;
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(text || `Upload failed (${res.status})`);
    }

    const uploaded = await res.json();
    if (uploaded?.record_id) {
      rec.serverRecordId = uploaded.record_id;
    }

    if (analyzeThisSegment) {
      _showToast(`💾 Segment ${segmentNo} uploaded + AI queued`);
    } else if (isFinal) {
      _showToast("💾 Segment saved (AI off for this clip)");
    }
    loadPlayback().catch(() => {});
  } catch (e) {
    console.warn("Record upload failed:", e);
    if (String(e?.message || e).includes("401")) {
      _showToast("⚠ Log in required — clip saved locally only (no SCVAM)");
    }
  }
}

function _updateRecordBtn(deviceId, isRecording) {
  const btn = document.getElementById("rec-btn-" + encodeURIComponent(deviceId));

  if (!btn) return;

  if (isRecording) {
    btn.style.color = "#ef4444";
    btn.style.animation = "pulse-rec 1s infinite";
    btn.title = "Stop Recording";

    if (!document.getElementById("rec-pulse-style")) {
      const st = document.createElement("style");
      st.id = "rec-pulse-style";
      st.textContent = `
        @keyframes pulse-rec {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `;
      document.head.appendChild(st);
    }
  } else {
    btn.style.color = "";
    btn.style.animation = "";
    btn.title = "Record / Stop Recording";
  }
}

async function _processPipeline(blob, rec, endedAt, cam) {
  const recordId = "rec_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
  const durationMs = new Date(endedAt) - new Date(rec.startTime);
  const durationSec = Math.max(1, Math.round(durationMs / 1000));

  // Convert blob to ArrayBuffer using FileReader
  const arrBuf = await new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });

  let ivB64 = "";
  let cipherB64 = "";

  try {
    const vault = window.recordingVault;

    if (vault && vault.vaultIsUnlocked()) {
      const encrypted = await vault.vaultEncryptArrayBuffer(arrBuf.slice(0));

      ivB64 = encrypted.ivB64;
      cipherB64 = encrypted.cipherB64;

      await vault.vaultSaveRecording({
        id: recordId,
        ivB64,
        cipherB64,
        mimeType: blob.type || "video/webm",
        cameraLabel: cam.title,
        startedAt: rec.startTime,
        endedAt,
        durationMs,
        sizePlain: blob.size,
      });

      _showToast("\uD83D\uDD10 Saved to encrypted vault");
    }
  } catch (e) {
    console.warn("Vault save failed:", e);
  }

  let savedRecordId = null;

  try {
    let rawB64 = "";

    if (window.recordingVault?.bufToB64) {
      rawB64 = window.recordingVault.bufToB64(new Uint8Array(arrBuf.slice(0)));
    }

    const payload = {
      record_id: recordId,
      resident_name: cam.resident || "This device",
      category: cam.title || "Camera Recording",
      record_type: "video",
      mime_type: blob.type || "video/webm",
      duration: durationSec,
      started_at: rec.startTime,
      ended_at: endedAt,
      iv_b64: ivB64 || "none",
      cipher_b64: cipherB64 || rawB64 || "",
      ai_plain_b64: rawB64 || "",
      ai_analyze: true,
      room: cam.floor || "Local",
      camera_id: String(cam.id || cam.deviceId || "local-camera"),
      notes: "Auto-recorded from " + cam.title,
    };

    const res = await fetch(API_BASE + "/records/vault/upload", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      const data = await res.json();
      savedRecordId = data.record_id;
      _showToast("💾 Record saved to library");
    }
  } catch (e) {
    console.warn("Record upload failed:", e);
  }

  // Backend does not currently have POST /records/transcribe.
  // Keep transcript disabled to avoid 405 Method Not Allowed in console.
  let transcriptText = "";
  console.log("Transcription skipped: /records/transcribe endpoint is not available.");

  if (transcriptText && savedRecordId) {
    try {
      const sRes = await fetch(API_BASE + "/records/ai-insights", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          resident_name: cam.resident || "This device",
          title: "Recording Summary: " + cam.title,
          body: transcriptText.slice(0, 2000),
          category: "recording",
          priority: "low",
          is_new: true,
          related_record_id: savedRecordId,
        }),
      });

      if (sRes.ok) {
        _showToast("🤖 AI summary generated");
      }
    } catch (e) {
      console.warn("AI summary failed:", e);
    }
  }

  await loadPlayback();

  _showPipelineComplete(cam.title, durationSec, transcriptText);
}

function _showPipelineComplete(camTitle, durationSec, transcript) {
  const existing = document.getElementById("pipeline-complete-modal");

  if (existing) existing.remove();

  const m = document.createElement("div");

  m.id = "pipeline-complete-modal";
  m.style.cssText = `
    position: fixed;
    inset: 0;
    z-index: 999999;
    background: rgba(0,0,0,0.5);
    display: flex;
    align-items: center;
    justify-content: center;
  `;

  m.innerHTML = `
    <div style="background:#fff;border-radius:18px;padding:28px 32px;max-width:460px;width:92%;font-family:Inter,sans-serif;box-shadow:0 20px 60px rgba(0,0,0,0.2);">
      <div style="font-size:18px;font-weight:800;margin-bottom:6px;">
        ✅ Recording Complete
      </div>

      <div style="font-size:13px;color:#64748b;margin-bottom:20px;">
        ${escapeHtml(camTitle)} · ${durationSec}s
      </div>

      <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:20px;">
        <div style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:#f0fdf4;border-radius:10px;border:1px solid #bbf7d0;">
          <span style="font-size:18px;">🔐</span>
          <div>
            <div style="font-size:13px;font-weight:700;color:#15803d;">Encrypted & Saved</div>
            <div style="font-size:11.5px;color:#64748b;">AES vault + server backup</div>
          </div>
        </div>

        <div style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:#eff6ff;border-radius:10px;border:1px solid #bfdbfe;">
          <span style="font-size:18px;">💾</span>
          <div>
            <div style="font-size:13px;font-weight:700;color:#1d4ed8;">Record Created</div>
            <div style="font-size:11.5px;color:#64748b;">Available in Records Library</div>
          </div>
        </div>

        <div style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:${transcript ? "#fefce8" : "#f8fafc"};border-radius:10px;border:1px solid ${transcript ? "#fef08a" : "#e2e8f0"};">
          <span style="font-size:18px;">📝</span>
          <div>
            <div style="font-size:13px;font-weight:700;color:${transcript ? "#854d0e" : "#64748b"};">
              ${transcript ? "Transcript Ready" : "No Audio Detected"}
            </div>
            <div style="font-size:11.5px;color:#64748b;">
              ${transcript ? escapeHtml(transcript.slice(0, 80)) + "…" : "Transcription skipped"}
            </div>
          </div>
        </div>
      </div>

      <div style="display:flex;gap:10px;">
        <button 
          type="button"
          onclick="document.getElementById('pipeline-complete-modal').remove()" 
          style="flex:1;padding:10px;border-radius:10px;border:1.5px solid #e2e8f0;background:#fff;cursor:pointer;font-size:13px;font-weight:600;"
        >
          Close
        </button>

        <button 
          type="button"
          onclick="document.getElementById('pipeline-complete-modal').remove();switchTab('playback',document.querySelectorAll('.page-tab')[1])" 
          style="flex:1;padding:10px;border-radius:10px;border:none;background:#0f172a;color:#fff;cursor:pointer;font-size:13px;font-weight:700;"
        >
          View in Playback ▶
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(m);

  m.addEventListener("click", (e) => {
    if (e.target === m) {
      m.remove();
    }
  });
}

// INIT
window.submitPlaybackDeleteModal = submitPlaybackDeleteModal;
window.deleteSinglePlayback = deleteSinglePlayback;

async function loadRecordingConsoleConfig() {
  try {
    const res = await fetch(`${API_BASE}/recording/config`, {
      headers: authHeaders(),
    });
    if (!res.ok) return;
    const cfg = await res.json();
    const seg = Number(cfg.segment_seconds);
    const minAi = Number(cfg.scvam_min_duration_sec);
    if (Number.isFinite(seg) && seg >= 30) {
      SCVA_ANALYSIS_CHUNK_SECONDS = Math.round(seg);
    }
    if (Number.isFinite(minAi) && minAi >= 1) {
      SCVA_MIN_AI_SECONDS = Math.round(minAi);
    }
  } catch (e) {
    console.warn("Recording config unavailable, using defaults:", e);
  }
}

async function initRecordingConsole() {
  loadCameraAiState();
  applyPlaybackRouteFromUrl();
  updateStatsFromFrontend();
  bindPlaybackActionButtonsOnce();

  await loadRecordingConsoleConfig();
  await loadLocalCameras();
  await loadFacilityCameras();
  await loadStats();
  await loadPlayback();
  loadAlerts();

  setInterval(loadStats, 30000);
}

window.switchTab = switchTab;
window.submitStagingDeleteModal = submitStagingDeleteModal;

initRecordingConsole();