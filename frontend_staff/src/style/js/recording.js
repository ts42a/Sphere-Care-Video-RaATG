// CONFIG
let facilityCameras = [];
let cameras = [];
let recordings = [];
let alertsData = [];

let alertFilterOn = false;
let filteredCameras = [];
let isPlaying = false;
let progressInterval = null;
let activeHls = null;
let modalPlaybackIndex = -1;

const localCamStreams = new Map();
const LOCAL_RECORDING_INDEX_KEY = "spherecare_local_recordings_index_v1";
const _activeRecorders = new Map();

// AUTH
function authHeaders() {
  const h = { "Content-Type": "application/json" };
  const t = sessionStorage.getItem("access_token");

  if (t) {
    h["Authorization"] = `Bearer ${t}`;
  }

  return h;
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
async function loadPlayback() {
  try {
    const res = await fetch(`${API_BASE}/records/?record_type=video&limit=20`, {
      headers: authHeaders(),
    });

    if (!res.ok) throw new Error(res.status);

    const data = await res.json();

    recordings = data.map((r) => ({
      id: r.id,
      title: r.category || "Video Recording",
      resident: r.resident_name || "—",
      date: r.recorded_at || (r.created_at ? r.created_at.slice(0, 10) : "—"),
      duration: r.duration || "—",
      flag: "none",
      type: r.category || "Recording",
      fileUrl: r.file_url || null,
    }));
  } catch (e) {
    recordings = [];
  }

  renderPlayback();
}

// API — ALERTS
async function loadAlerts() {
  try {
    const res = await fetch(`${API_BASE}/cameras/alerts/?limit=50`, {
      headers: authHeaders(),
    });

    if (!res.ok) throw new Error(res.status);

    const data = await res.json();

    alertsData = data.map((a) => ({
      id: a.id,
      type: a.alert_type,
      icon: a.icon || "fall",
      title: a.title,
      desc: a.description,
      time: a.created_at,
      cam: a.camera_title || "—",
      resolved: a.resolved,
    }));
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
    await fetch(`${API_BASE}/cameras/alerts/${id}/resolve`, {
      method: "PATCH",
      headers: authHeaders(),
    });

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
      }
    });
  });
}

// PLAYBACK
function renderPlayback() {
  const grid = document.getElementById("playback-grid");

  if (!grid) return;

  if (!recordings.length) {
    grid.innerHTML = `
      <div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--text3);font-weight:600;">
        No video recordings found.
      </div>
    `;
    return;
  }

  grid.innerHTML = recordings.map((r) => `
    <div class="pb-card" onclick="openPlayback(${JSON.stringify(r.id)})">
      <div class="pb-thumb">
        <div class="pb-play">
          <svg viewBox="0 0 24 24">
            <polygon points="5 3 19 12 5 21 5 3"/>
          </svg>
        </div>

        <div class="pb-duration">${escapeHtml(r.duration)}</div>

        ${
          r.flag === "critical"
            ? '<div class="pb-flagged">FLAGGED</div>'
            : r.flag === "warning"
            ? '<div class="pb-review">REVIEW</div>'
            : ""
        }
      </div>

      <div class="pb-info">
        <div class="pb-title">${escapeHtml(r.title)}</div>
        <div class="pb-meta">👤 ${escapeHtml(r.resident)} · 🕐 ${escapeHtml(r.date)}</div>

        <div class="pb-footer">
          <span style="font-size:11.5px;background:#f0fdf4;color:#15803d;padding:3px 10px;border-radius:20px;font-weight:700;">
            ${escapeHtml(r.type)}
          </span>

          <button 
            type="button"
            class="play-btn" 
            onclick="event.preventDefault(); event.stopPropagation(); openPlayback(${JSON.stringify(r.id)});"
          >
            <svg viewBox="0 0 24 24">
              <polygon points="23 7 16 12 23 17 23 7"/>
              <rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
            </svg>
            Play
          </button>
        </div>
      </div>
    </div>
  `).join("");
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
function openPlayback(id) {
  const rec = recordings.find((r) => String(r.id) === String(id));

  if (!rec) return;

  modalPlaybackIndex = recordings.findIndex((r) => String(r.id) === String(id));

  if (activeHls) {
    activeHls.destroy();
    activeHls = null;
  }

  clearInterval(window._modalTick);

  const titleEl = document.getElementById("vm-title");
  const cameraEl = document.getElementById("vm-camera");
  const residentEl = document.getElementById("vm-resident");
  const dateEl = document.getElementById("vm-date");
  const typeEl = document.getElementById("vm-type");
  const statusEl = document.getElementById("vm-status");
  const fillEl = document.getElementById("vm-progress-fill");
  const timeEl = document.getElementById("vm-time");

  if (titleEl) titleEl.textContent = rec.title;
  if (cameraEl) cameraEl.textContent = rec.title;
  if (residentEl) residentEl.textContent = rec.resident;
  if (dateEl) dateEl.textContent = rec.date;
  if (typeEl) typeEl.textContent = rec.type;
  if (statusEl) statusEl.textContent = "▶ Playback";
  if (fillEl) fillEl.style.width = "0%";
  if (timeEl) timeEl.textContent = "00:00 / " + rec.duration;

  const screenEl = document.querySelector(".vm-screen-inner");

  if (!screenEl) return;

  if (rec.fileUrl && rec.fileUrl !== "#") {
    const video = document.createElement("video");

    video.style.cssText = "width:100%;height:100%;object-fit:cover;display:block;";
    video.controls = false;
    video.src = rec.fileUrl;

    screenEl.innerHTML = "";
    screenEl.appendChild(video);

    video.addEventListener("timeupdate", () => {
      if (!video.duration) return;

      const pct = (video.currentTime / video.duration) * 100;

      const fill = document.getElementById("vm-progress-fill");
      const time = document.getElementById("vm-time");

      if (fill) fill.style.width = pct + "%";

      const fmt = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

      if (time) {
        time.textContent = `${fmt(video.currentTime)} / ${fmt(video.duration)}`;
      }
    });

    window._modalVideo = video;
  } else {
    window._modalVideo = null;

    screenEl.innerHTML = `
      <div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:#0b1220;color:#94a3b8;">
        <div style="text-align:center;">
          <div style="font-size:14px;font-weight:700;margin-bottom:6px;">No playback source</div>
          <div style="font-size:12px;">This record does not have a playable URL.</div>
        </div>
      </div>
    `;
  }

  const modal = document.getElementById("modal-video");

  if (modal) {
    modal.classList.add("open");
  }

  document.body.style.overflow = "hidden";
  isPlaying = false;
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
  const icon = document.getElementById("vm-play-icon");

  if (window._modalVideo) {
    if (window._modalVideo.paused) {
      window._modalVideo.play();
      isPlaying = true;
    } else {
      window._modalVideo.pause();
      isPlaying = false;
    }

    if (icon) {
      icon.innerHTML = isPlaying
        ? '<rect x="6" y="4" width="4" height="16" fill="white"/><rect x="14" y="4" width="4" height="16" fill="white"/>'
        : '<polygon points="5 3 19 12 5 21 5 3" fill="white" stroke="none"/>';
    }

    return;
  }

  isPlaying = !isPlaying;

  if (isPlaying) {
    if (icon) {
      icon.innerHTML = '<rect x="6" y="4" width="4" height="16" fill="white"/><rect x="14" y="4" width="4" height="16" fill="white"/>';
    }

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
    if (icon) {
      icon.innerHTML = '<polygon points="5 3 19 12 5 21 5 3" fill="white" stroke="none"/>';
    }

    clearInterval(progressInterval);
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

// BEFORE UNLOAD
window.addEventListener("beforeunload", () => {
  for (const stream of localCamStreams.values()) {
    stream.getTracks().forEach((t) => t.stop());
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

  openRcModal("vault-delete-modal");
}

async function submitDeleteVaultModal() {
  const confirmText = document.getElementById("vault-delete-confirm")?.value?.trim();

  if (confirmText !== "DELETE") {
    setRcStatus("vault-delete-status", "Type DELETE to confirm this action.", "err");
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
      const res = await fetch(`${API_BASE}/records/?record_type=video&limit=200`, {
        headers: authHeaders(),
      });

      if (res.ok) {
        const serverRows = await res.json();

        for (const r of Array.isArray(serverRows) ? serverRows : []) {
          if (!String(r?.file_url || "").startsWith("localvault://")) continue;

          const d = await fetch(`${API_BASE}/records/${encodeURIComponent(r.id)}`, {
            method: "DELETE",
            headers: authHeaders(),
          });

          if (d.ok) serverDeleted += 1;
        }
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

  recorder.start(1000);

  _activeRecorders.set(deviceId, {
    recorder,
    chunks,
    startTime: new Date().toISOString(),
    camId: cam.id,
    camTitle: cam.title,
  });

  _updateRecordBtn(deviceId, true);
  _showToast("🔴 Recording started — " + cam.title);
}

async function stopRecording(deviceId, cam) {
  console.log("stopRecording called:", deviceId, cam);

  const rec = _activeRecorders.get(deviceId);

  if (!rec) return;

  return new Promise((resolve) => {
    rec.recorder.onstop = async () => {
      _activeRecorders.delete(deviceId);
      _updateRecordBtn(deviceId, false);

      const blob = new Blob(rec.chunks, {
        type: rec.recorder.mimeType || "video/webm",
      });

      const endedAt = new Date().toISOString();

      _showToast("⏹ Recording stopped — processing…");

      await _processPipeline(blob, rec, endedAt, cam);

      resolve();
    };

    try {
      rec.recorder.stop();
    } catch (e) {
      console.error("Recorder stop failed:", e);
      _activeRecorders.delete(deviceId);
      _updateRecordBtn(deviceId, false);
      resolve();
    }
  });
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

  let ivB64 = "";
  let cipherB64 = "";

  try {
    const vault = window.recordingVault;

    if (vault && vault.vaultIsUnlocked()) {
      const arrBuf = await blob.arrayBuffer();
      const encrypted = await vault.vaultEncryptArrayBuffer(arrBuf);

      ivB64 = encrypted.ivB64;
      cipherB64 = encrypted.cipherB64;

      await vault.vaultSaveRecording({
        id: recordId,
        ivB64,
        cipherB64,
        mimeType: blob.type,
        cameraLabel: cam.title,
        startedAt: rec.startTime,
        endedAt,
        durationMs,
        sizePlain: blob.size,
      });

      _showToast("🔐 Saved to encrypted vault");
    }
  } catch (e) {
    console.warn("Vault save failed:", e);
  }

  let savedRecordId = null;

  try {
    let rawB64 = "";

    if (!cipherB64 && window.recordingVault?.bufToB64) {
      rawB64 = window.recordingVault.bufToB64(new Uint8Array(await blob.arrayBuffer()));
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

  let transcriptText = "";

  try {
    const formData = new FormData();
    formData.append("file", blob, recordId + ".webm");

    const tRes = await fetch(API_BASE + "/records/transcribe", {
      method: "POST",
      headers: {
        Authorization: authHeaders()["Authorization"],
      },
      body: formData,
    });

    if (tRes.ok) {
      const tData = await tRes.json();
      transcriptText = tData.transcript || tData.text || "";
      _showToast("📝 Transcript ready");
    }
  } catch (e) {
    console.warn("Transcription failed:", e);
    transcriptText = "";
  }

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
async function initRecordingConsole() {
  updateStatsFromFrontend();

  await loadLocalCameras();
  await loadFacilityCameras();
  await loadStats();

  loadPlayback();
  loadAlerts();

  setInterval(loadStats, 30000);
}

initRecordingConsole();