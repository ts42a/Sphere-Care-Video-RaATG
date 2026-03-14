// CONFIG
let cameras = [], recordings = [], alertsData = [];
let alertFilterOn = false, filteredCameras = [];
let isPlaying = false, progressInterval = null;
let activeHls = null; // holds the HLS instance when real stream is playing

function authHeaders(){
  const h = {'Content-Type':'application/json'};
  const t = localStorage.getItem('access_token');
  if(t) h['Authorization'] = `Bearer ${t}`;
  return h;
}

// API — CAMERAS (Live View)
async function loadCameras(){
  try {
    const res = await fetch(`${API_BASE}/cameras/`, {headers: authHeaders()});
    if(!res.ok) throw new Error(res.status);
    const data = await res.json();
    const mapped = data.map(c => ({
      id:        c.id,
      title:     c.title,
      resident:  c.resident_name || 'Common Area',
      floor:     c.floor || '',
      status:    c.status,
      alert:     c.alert,
      desc:      c.description || '',
      streamUrl: c.stream_url || null,
    }));
    cameras = mapped;
    showApiStatus(true);
  } catch(e){
    console.warn('API unavailable, using demo cameras');
    cameras = [];
    showGridError('camera-grid', 'cameras');
    showApiStatus(false);
  }
  filteredCameras = applyFilters(cameras);
  renderCameras();
}

// API — STATS (Stat Cards)
async function loadStats(){
  try {
    const res = await fetch(`${API_BASE}/cameras/stats`, {headers: authHeaders()});
    if(!res.ok) throw new Error();
    const d = await res.json();
    document.getElementById('st-total').textContent  = d.total_cameras;
    document.getElementById('st-online').textContent = d.online;
    document.getElementById('st-alerts').textContent = d.active_alerts;
    document.getElementById('st-events').textContent = d.events_24h;
    document.querySelector('.alert-badge').textContent = d.active_alerts;
  } catch(e){ /* keep existing values */ }
}

// API — PLAYBACK (uses /records/?record_type=video)
async function loadPlayback(){
  try {
    const res = await fetch(`${API_BASE}/records/?record_type=video&limit=20`, {headers: authHeaders()});
    if(!res.ok) throw new Error();
    const data = await res.json();
    const recs = data.map(r => ({
      id:       r.id,
      title:    r.category || 'Video Recording',
      resident: r.resident_name || '—',
      date:     r.recorded_at || (r.created_at ? r.created_at.slice(0,10) : '—'),
      duration: r.duration || '—',
      flag:     'none',
      type:     r.category || 'Recording',
      fileUrl:  r.file_url || null,
    }));
    recordings = recs;
  } catch(e){
    recordings = [];
  }
  renderPlayback();
}

// API — ALERTS (AI Alerts tab)
async function loadAlerts(){
  try {
    const res = await fetch(`${API_BASE}/cameras/alerts/?limit=50`, {headers: authHeaders()});
    if(!res.ok) throw new Error();
    const data = await res.json();
    const mapped = data.map(a => ({
      id:       a.id,
      type:     a.alert_type,
      icon:     a.icon || 'fall',
      title:    a.title,
      desc:     a.description,
      time:     a.created_at,
      cam:      a.camera_title || '—',
      resolved: a.resolved,
    }));
    alertsData = mapped;
  } catch(e){
    alertsData = [];
    showGridError('alerts-list', 'alerts');
  }
  renderAlerts();
}

async function resolveAlert(id){
  // optimistic update first
  const a = alertsData.find(x => x.id === id);
  if(a) a.resolved = true;
  renderAlerts();
  // update stats badge
  const active = alertsData.filter(x => !x.resolved).length;
  document.getElementById('st-alerts').textContent = active;
  document.querySelector('.alert-badge').textContent = active;
  // then call API
  try {
    await fetch(`${API_BASE}/cameras/alerts/${id}/resolve`, {method:'PATCH', headers: authHeaders()});
  } catch(e){ console.warn('Resolve API failed (local update kept)'); }
}

// RENDER — CAMERAS
const EMOJI_SETS = [
  ['🚶','👩'],
  ['🧓'],
  ['🧑‍🦽'],
  ['🚶','🧓'],
  ['👩'],
  ['🧑‍🦽','🚶'],
  ['🧓','👩'],
  ['🚶'],
];
function renderCameras(){
  const grid = document.getElementById('camera-grid');
  if(!filteredCameras.length){
    grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--text3);font-weight:600;">No cameras match the current filter.</div>';
    return;
  }
  grid.innerHTML = filteredCameras.map(c => {
    const isAlert   = c.alert === 'critical';
    const isOffline = c.status === 'offline';
    const emojis    = EMOJI_SETS[(c.id - 1) % EMOJI_SETS.length];
    const people    = emojis.map((e,i) =>
      `<div class="${i===0?'cctv-person':'cctv-person2'}" style="animation-duration:${6+i*3}s">${e}</div>`
    ).join('');

    // ── Real HLS feed (when stream_url is available from backend) ──
    // When c.streamUrl is set (e.g. "http://server/cameras/1/stream.m3u8"),
    // a <video> tag is rendered and HLS.js will attach to it in openCamera().
    const feed = isOffline
      ? `<div class="cam-feed-placeholder">
           <svg viewBox="0 0 24 24"><line x1="1" y1="1" x2="23" y2="23"/><path d="M21 21H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3m3-3h6l2 3h4a2 2 0 0 1 2 2v9.34"/></svg>
           <div class="cam-offline-txt">OFFLINE</div>
         </div>`
      : `<div class="cctv-sim" style="width:100%;height:100%">
           <div class="cctv-bg" style="width:100%;height:100%"></div>
           ${people}
           <div class="cctv-scanline"></div>
           <div class="cctv-noise"></div>
           <div class="cctv-timestamp">${new Date().toLocaleTimeString('en-AU')}</div>
           <div class="cctv-recbadge"><div class="rec-dot"></div>LIVE</div>
           ${isAlert
             ? '<div class="cam-alert-overlay"></div><div class="cam-alert-label">CRITICAL</div>'
             : '<div class="cam-fine-label">LIVE</div>'}
         </div>`;

    return `<div class="cam-card ${isAlert?'critical':c.alert==='fine'?'fine':''} ${isOffline?'offline':''}"
                 onclick="openCamera(${c.id})">
      <div class="cam-video">${feed}</div>
      <div class="cam-info">
        <div class="cam-title">${c.title}</div>
        <div class="cam-resident">👤 ${c.resident}</div>
        ${c.desc ? `<div class="cam-desc">${c.desc}</div>` : ''}
        <div class="cam-footer">
          <span class="cam-status-dot">
            ${isOffline ? '<div class="dot-offline"></div> Offline' : '<div class="dot-live"></div> Live'}
          </span>
          <div class="cam-actions">
            <button class="cam-btn" title="Fullscreen" onclick="event.stopPropagation();openCamera(${c.id})">
              <svg viewBox="0 0 24 24"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
            </button>
            <button class="cam-btn" title="Snapshot" onclick="event.stopPropagation()">
              <svg viewBox="0 0 24 24"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
            </button>
          </div>
        </div>
      </div>
    </div>`;
  }).join('');
}

// RENDER — PLAYBACK
function renderPlayback(){
  const grid = document.getElementById('playback-grid');
  if(!recordings.length){
    grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--text3);font-weight:600;">No video recordings found.</div>';
    return;
  }
  grid.innerHTML = recordings.map(r => `
    <div class="pb-card" onclick="openPlayback(${r.id})">
      <div class="pb-thumb">
        <div class="pb-play"><svg viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg></div>
        <div class="pb-duration">${r.duration}</div>
        ${r.flag==='critical' ? '<div class="pb-flagged">FLAGGED</div>' : r.flag==='warning' ? '<div class="pb-review">REVIEW</div>' : ''}
      </div>
      <div class="pb-info">
        <div class="pb-title">${r.title}</div>
        <div class="pb-meta">👤 ${r.resident} · 🕐 ${r.date}</div>
        <div class="pb-footer">
          <span style="font-size:11.5px;background:#f0fdf4;color:#15803d;padding:3px 10px;border-radius:20px;font-weight:700;">${r.type}</span>
          <button class="play-btn" onclick="event.stopPropagation();openPlayback(${r.id})">
            <svg viewBox="0 0 24 24"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
            Play
          </button>
        </div>
      </div>
    </div>`).join('');
}

// RENDER — ALERTS
const alertIcons = {
  fall:   '<svg viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  person: '<svg viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
  sound:  '<svg viewBox="0 0 24 24"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>',
  motion: '<svg viewBox="0 0 24 24"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>',
  check:  '<svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>',
};
function renderAlerts(){
  const list = document.getElementById('alerts-list');
  if(!alertsData.length){
    list.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text3);font-weight:600;">No alerts found.</div>';
    return;
  }
  list.innerHTML = alertsData.map(a => {
    const cls   = a.resolved ? 'resolved' : a.type;
    const label = a.resolved ? 'Resolved' : a.type.charAt(0).toUpperCase() + a.type.slice(1);
    return `
    <div class="alert-row ${cls}">
      <div class="alert-icon ai-${cls}">${alertIcons[a.icon] || alertIcons.fall}</div>
      <div class="alert-body">
        <div class="alert-title">${a.title}
          <span class="alert-badge ab-${cls}">${label}</span>
        </div>
        <div class="alert-desc">${a.desc}</div>
      </div>
      <div style="text-align:right;flex-shrink:0;">
        <div class="alert-time">${a.time}</div>
        <div style="font-size:11px;color:var(--text3);margin-top:3px;">📷 ${a.cam}</div>
        ${!a.resolved
          ? `<button onclick="resolveAlert(${a.id})"
               style="margin-top:6px;padding:4px 10px;border-radius:7px;border:1.5px solid var(--border);
                      background:#fff;font-family:Manrope,sans-serif;font-size:11.5px;font-weight:700;cursor:pointer;">
               Resolve
             </button>`
          : ''}
      </div>
    </div>`;
  }).join('');
}

// FILTER / SEARCH
function applyFilters(list){
  const s     = document.getElementById('cam-search').value.toLowerCase();
  const floor = document.getElementById('f-floor').value;
  const stat  = document.getElementById('f-camstatus').value;
  return list.filter(c => {
    const ms = !s     || c.title.toLowerCase().includes(s) || c.resident.toLowerCase().includes(s);
    const mf = !floor || c.floor === floor;
    const mv = !stat  || c.status === stat;
    const ma = !alertFilterOn || c.alert === 'critical';
    return ms && mf && mv && ma;
  });
}

function filterCameras(){
  filteredCameras = applyFilters(cameras);
  renderCameras();
}

function toggleAlertFilter(){
  alertFilterOn = !alertFilterOn;
  document.getElementById('alert-filter-btn').classList.toggle('active', alertFilterOn);
  filterCameras();
}

// GRID COLS / TABS
function setGridCols(n){
  const grid = document.getElementById('camera-grid');
  grid.className = 'camera-grid' + (n===2?' two-col':n===1?' one-col':'');
  ['vbtn-4','vbtn-2','vbtn-1'].forEach(id => document.getElementById(id).classList.remove('active'));
  document.getElementById('vbtn-'+n).classList.add('active');
}

function switchTab(tab, el){
  ['live','playback','alerts'].forEach(t => document.getElementById('tab-'+t).style.display='none');
  document.getElementById('tab-'+tab).style.display = 'block';
  document.querySelectorAll('.page-tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
}

// VIDEO MODAL — CAMERA (Live)
function openCamera(id){
  const cam = cameras.find(c => c.id === id);
  if(!cam) return;

  // destroy previous HLS instance if any
  if(activeHls){ activeHls.destroy(); activeHls = null; }

  document.getElementById('vm-title').textContent    = cam.title;
  document.getElementById('vm-camera').textContent   = cam.title;
  document.getElementById('vm-resident').textContent = cam.resident;
  document.getElementById('vm-date').textContent     = new Date().toLocaleDateString('en-AU',{day:'numeric',month:'long',year:'numeric'});
  document.getElementById('vm-type').textContent     = cam.alert === 'critical' ? '⚠ Alert Active' : '🔴 Live Stream';
  document.getElementById('vm-status').textContent   = cam.status === 'live' ? '🟢 Live' : '⚫ Offline';
  document.getElementById('vm-progress-fill').style.width = '0%';
  document.getElementById('vm-time').textContent     = 'LIVE';

  const screenEl = document.querySelector('.vm-screen-inner');

  if(cam.streamUrl){
    // ── REAL HLS STREAM ──
    // Requires HLS.js in <head>: cdn.jsdelivr.net/npm/hls.js@latest
    // Your backend must serve FFmpeg → HLS:
    //   ffmpeg -i rtsp://camera-ip/stream -c:v copy -hls_time 2 -hls_list_size 3 -f hls /static/cam1/stream.m3u8
    const video = document.createElement('video');
    video.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
    video.autoplay = true;
    video.muted    = true;
    video.playsInline = true;
    screenEl.innerHTML = '';
    screenEl.appendChild(video);
    if(typeof Hls !== 'undefined' && Hls.isSupported()){
      activeHls = new Hls({lowLatencyMode: true});
      activeHls.loadSource(cam.streamUrl);
      activeHls.attachMedia(video);
      activeHls.on(Hls.Events.MANIFEST_PARSED, () => video.play());
    } else if(video.canPlayType('application/vnd.apple.mpegurl')){
      // Safari native HLS
      video.src = cam.streamUrl;
      video.play();
    }
  } else {
    // ── SIMULATED CCTV (no stream_url yet) ──
    const emojis = EMOJI_SETS[(id - 1) % EMOJI_SETS.length];
    const people = emojis.map((e,i) =>
      `<div class="${i===0?'cctv-person':'cctv-person2'}" style="font-size:42px;animation-duration:${6+i*3}s">${e}</div>`
    ).join('');
    screenEl.innerHTML = `
      <div class="cctv-sim" style="width:100%;height:100%">
        <div class="cctv-bg" style="width:100%;height:100%"></div>
        ${people}
        <div class="cctv-scanline"></div>
        <div class="cctv-noise"></div>
        <div class="cctv-timestamp" id="modal-ts" style="font-size:12px;top:10px;left:14px"></div>
        <div class="cctv-recbadge" style="top:10px;right:14px;font-size:12px"><div class="rec-dot"></div>LIVE</div>
        ${cam.alert==='critical' ? '<div class="cam-alert-overlay"></div><div class="cam-alert-label" style="font-size:13px;padding:5px 12px;bottom:12px;left:12px">CRITICAL ALERT</div>' : ''}
      </div>`;
    // tick timestamp in modal
    clearInterval(window._modalTick);
    window._modalTick = setInterval(() => {
      const el = document.getElementById('modal-ts');
      if(el) el.textContent = new Date().toLocaleTimeString('en-AU');
    }, 1000);
  }

  document.getElementById('modal-video').classList.add('open');
  document.body.style.overflow = 'hidden';
}

// VIDEO MODAL — PLAYBACK (from Records API)
function openPlayback(id){
  const rec = recordings.find(r => r.id === id);
  if(!rec) return;

  if(activeHls){ activeHls.destroy(); activeHls = null; }
  clearInterval(window._modalTick);

  document.getElementById('vm-title').textContent    = rec.title;
  document.getElementById('vm-camera').textContent   = rec.title;
  document.getElementById('vm-resident').textContent = rec.resident;
  document.getElementById('vm-date').textContent     = rec.date;
  document.getElementById('vm-type').textContent     = rec.type;
  document.getElementById('vm-status').textContent   = '▶ Playback';
  document.getElementById('vm-progress-fill').style.width = '0%';
  document.getElementById('vm-time').textContent     = '00:00 / ' + rec.duration;

  const screenEl = document.querySelector('.vm-screen-inner');

  if(rec.fileUrl && rec.fileUrl !== '#'){
    // ── REAL VIDEO FILE ──
    const video = document.createElement('video');
    video.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
    video.controls = false;
    video.src      = rec.fileUrl;
    screenEl.innerHTML = '';
    screenEl.appendChild(video);
    video.addEventListener('timeupdate', () => {
      if(!video.duration) return;
      const pct = (video.currentTime / video.duration) * 100;
      document.getElementById('vm-progress-fill').style.width = pct + '%';
      const fmt = s => `${String(Math.floor(s/60)).padStart(2,'0')}:${String(Math.floor(s%60)).padStart(2,'0')}`;
      document.getElementById('vm-time').textContent = `${fmt(video.currentTime)} / ${fmt(video.duration)}`;
    });
    // store ref so togglePlay / seekVideo can use it
    document.getElementById('vm-progress').dataset.videoEl = 'true';
    window._modalVideo = video;
  } else {
    // ── SIMULATED PLAYBACK FEED ──
    window._modalVideo = null;
    const emojis = EMOJI_SETS[(id - 1) % EMOJI_SETS.length];
    const people = emojis.map((e,i) =>
      `<div class="${i===0?'cctv-person':'cctv-person2'}" style="font-size:42px;animation-duration:${6+i*3}s;animation-play-state:paused" class="sim-person">${e}</div>`
    ).join('');
    screenEl.innerHTML = `
      <div class="cctv-sim" style="width:100%;height:100%">
        <div class="cctv-bg" style="width:100%;height:100%"></div>
        ${people}
        <div class="cctv-scanline"></div>
        <div class="cctv-noise"></div>
        <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;">
          <div style="width:60px;height:60px;background:rgba(46,196,182,0.2);border-radius:50%;border:2px solid rgba(46,196,182,0.5);display:flex;align-items:center;justify-content:center;">
            <svg viewBox="0 0 24 24" style="width:24px;height:24px;fill:#2ec4b6;stroke:none"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          </div>
        </div>
      </div>`;
  }

  document.getElementById('modal-video').classList.add('open');
  document.body.style.overflow = 'hidden';
  isPlaying = false;
}

// ════════════════════════════════════════
// MODAL CONTROLS
// ════════════════════════════════════════
function closeModal(){
  document.getElementById('modal-video').classList.remove('open');
  document.body.style.overflow = '';
  isPlaying = false;
  clearInterval(progressInterval);
  clearInterval(window._modalTick);
  if(activeHls){ activeHls.destroy(); activeHls = null; }
  if(window._modalVideo){ window._modalVideo.pause(); window._modalVideo = null; }
}

document.getElementById('modal-video').addEventListener('click', e => {
  if(e.target === document.getElementById('modal-video')) closeModal();
});

function togglePlay(){
  const icon = document.getElementById('vm-play-icon');

  // if real video element exists
  if(window._modalVideo){
    if(window._modalVideo.paused){ window._modalVideo.play(); isPlaying = true; }
    else { window._modalVideo.pause(); isPlaying = false; }
    icon.innerHTML = isPlaying
      ? '<rect x="6" y="4" width="4" height="16" fill="white"/><rect x="14" y="4" width="4" height="16" fill="white"/>'
      : '<polygon points="5 3 19 12 5 21 5 3" fill="white" stroke="none"/>';
    return;
  }

  // simulated progress bar
  isPlaying = !isPlaying;
  if(isPlaying){
    icon.innerHTML = '<rect x="6" y="4" width="4" height="16" fill="white"/><rect x="14" y="4" width="4" height="16" fill="white"/>';
    // also animate sim persons
    document.querySelectorAll('.sim-person').forEach(el => el.style.animationPlayState = 'running');
    progressInterval = setInterval(() => {
      const fill = document.getElementById('vm-progress-fill');
      const w = parseFloat(fill.style.width) || 0;
      if(w >= 100){ clearInterval(progressInterval); isPlaying = false; return; }
      fill.style.width = (w + 0.25) + '%';
    }, 100);
  } else {
    icon.innerHTML = '<polygon points="5 3 19 12 5 21 5 3" fill="white" stroke="none"/>';
    document.querySelectorAll('.sim-person').forEach(el => el.style.animationPlayState = 'paused');
    clearInterval(progressInterval);
  }
}

function seekVideo(e){
  const bar = e.currentTarget;
  const pct = (e.offsetX / bar.offsetWidth) * 100;
  document.getElementById('vm-progress-fill').style.width = pct + '%';
  if(window._modalVideo && window._modalVideo.duration){
    window._modalVideo.currentTime = (pct / 100) * window._modalVideo.duration;
  }
}

// CLOCK
function tick(){
  const d = new Date();
  document.getElementById('tb-date').textContent = d.toLocaleDateString('en-AU',{day:'numeric',month:'long',year:'numeric'});
  document.getElementById('tb-time').textContent = d.toLocaleTimeString('en-AU',{hour:'2-digit',minute:'2-digit'});
}
tick(); setInterval(tick, 1000);

// STATUS TOAST
function showApiStatus(connected){
  let el = document.getElementById('api-status-toast');
  if(!el){
    el = document.createElement('div');
    el.id = 'api-status-toast';
    el.style.cssText = 'position:fixed;bottom:18px;right:18px;padding:8px 14px;border-radius:10px;font-size:12px;font-weight:700;z-index:9999;transition:opacity 3s;font-family:Manrope,sans-serif;';
    document.body.appendChild(el);
  }
  el.textContent  = connected ? '✓ Connected to API' : '⚠ Using demo data (API offline)';
  el.style.background = connected ? '#dcfce7' : '#fff7ed';
  el.style.color      = connected ? '#15803d' : '#c2410c';
  el.style.opacity    = '1';
  setTimeout(() => el.style.opacity = '0', 3000);
}

// TOP ALERTS BUTTON → switch to Alerts tab
document.getElementById('alerts-topbtn').addEventListener('click', () => {
  switchTab('alerts', document.querySelectorAll('.page-tab')[2]);
});

function showGridError(elId, type){
  const el = document.getElementById(elId);
  if(el) el.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--red);font-size:13px;font-weight:600;">⚠ Unable to load ${type}. Please check your connection.</div>`;
}

// INIT
loadStats();
loadCameras();
loadPlayback();
loadAlerts();
