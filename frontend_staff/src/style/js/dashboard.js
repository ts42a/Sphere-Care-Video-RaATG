// ── GOOGLE OAUTH TOKEN HANDLER ──
(function handleOAuthToken() {
  const params = new URLSearchParams(window.location.search);
  const token  = params.get('token');
  if (token) {
    sessionStorage.setItem('access_token', token);
    window.history.replaceState({}, document.title, window.location.pathname);
  }
})();

// ══════════════════════════════════════════
// DASHBOARD — API INTEGRATION
// ══════════════════════════════════════════
(function() {
  var AVATAR_COLORS = ['#2ec4b6','#7c3aed','#db2777','#059669','#d97706','#0369a1','#dc2626','#9333ea'];
  var colorMap = {}, colorIdx = 0;

  function avatarColor(name) {
    if (!colorMap[name]) colorMap[name] = AVATAR_COLORS[colorIdx++ % AVATAR_COLORS.length];
    return colorMap[name];
  }

  function initials(name) {
    return (name || '?').split(' ').map(function(w){ return w[0]; }).join('').toUpperCase().slice(0,2);
  }

  function authHeaders() {
    var h = { 'Content-Type': 'application/json' };
    var t = sessionStorage.getItem('access_token') || sessionStorage.getItem('spherecare_token');
    if (t) h['Authorization'] = 'Bearer ' + t;
    return h;
  }

  function esc(s) {
    return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function timeAgo(raw) {
    if (!raw) return '';
    if (typeof raw === 'string' && raw.length < 20 && !/^\d{4}-/.test(raw)) return raw;
    try {
      var diff = Math.floor((Date.now() - new Date(raw).getTime()) / 60000);
      if (diff < 1)  return 'Just now';
      if (diff < 60) return diff + 'm ago';
      if (diff < 1440) return Math.floor(diff/60) + 'h ago';
      return Math.floor(diff/1440) + 'd ago';
    } catch(e) { return raw; }
  }

  var base = (typeof API_BASE !== 'undefined') ? API_BASE : '/api/v1';

  // ── 1. DASHBOARD STATS (stat cards) ──
  async function loadDashboardStats() {
    try {
      var res = await fetch(base + '/dashboard/stats', { headers: authHeaders() });
      if (!res.ok) throw new Error('stats');
      var s = await res.json();
      setText('dash-staff-duty',     s.active_staff);
      setText('dash-pending-tasks',  s.pending_tasks);
      // alerts count from recent_alerts array
      setText('dash-active-alerts',  s.recent_alerts ? s.recent_alerts.length : 0);
      // render AI flags panel from recent alerts
      renderAIFlags(s.recent_alerts || []);
    } catch(e) {
      setText('dash-staff-duty',    '—');
      setText('dash-pending-tasks', '—');
      setText('dash-active-alerts', '—');
    }
  }

  // ── 2. TOTAL RESIDENTS (stat card) ──
  async function loadResidentCount() {
    try {
      var res = await fetch(base + '/residents/', { headers: authHeaders() });
      if (!res.ok) throw new Error('residents');
      var data = await res.json();
      setText('dash-total-residents', data.length);
    } catch(e) {
      setText('dash-total-residents', '—');
    }
  }

  // ── 3. TODAY'S BOOKINGS ──
  async function loadTodayBookings() {
    try {
      var res = await fetch(base + '/bookings/', { headers: authHeaders() });
      if (!res.ok) throw new Error('bookings');
      var data = await res.json();

      var todayStr = new Date().toISOString().slice(0, 10);
      var todayBookings = data.filter(function(b) { return b.date === todayStr; });

      var titleEl = document.getElementById('dash-tasks-title');
      var subEl   = document.getElementById('dash-tasks-sub');
      var listEl  = document.getElementById('dash-tasks-list');
      if (!listEl) return;

      var d = new Date();
      var dayLabel = d.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'short' });
      if (titleEl) titleEl.textContent = "Today's Bookings (" + dayLabel + ')';

      if (!todayBookings.length) {
        if (subEl) subEl.textContent = 'No bookings scheduled for today.';
        // Show all upcoming bookings instead
        var upcoming = data.slice(0, 5);
        if (upcoming.length) {
          if (subEl) subEl.textContent = 'No bookings today. Showing ' + data.length + ' total booking(s).';
          listEl.innerHTML = upcoming.map(function(b) {
            var resName = b.resident ? b.resident.full_name : 'Resident #' + b.resident_id;
            var statusCls = b.status === 'confirmed' ? 'done' : b.status === 'cancelled' ? 'urgent' : 'default';
            return '<div class="task-item">'
              + '<div class="task-time">' + esc(b.time || '—') + '</div>'
              + '<div class="task-bar ' + statusCls + '"></div>'
              + '<div class="task-info">'
              + '<div class="task-title">' + esc(b.booking_type) + ' — ' + esc(b.doctor_name) + ' with ' + esc(resName) + '</div>'
              + '<div class="task-status ' + statusCls + '">Date: ' + esc(b.date) + ' · Status: ' + esc(b.status.toUpperCase()) + '</div>'
              + '</div></div>';
          }).join('');
        } else {
          listEl.innerHTML = '<div style="text-align:center;padding:24px 0;color:var(--text3);font-size:13px;">No bookings found.</div>';
        }
        return;
      }

      if (subEl) subEl.textContent = todayBookings.length + ' booking(s) scheduled for today.';
      listEl.innerHTML = todayBookings.map(function(b) {
        var resName = b.resident ? b.resident.full_name : 'Resident #' + b.resident_id;
        var statusCls = b.status === 'confirmed' ? 'done' : b.status === 'cancelled' ? 'urgent' : 'default';
        return '<div class="task-item">'
          + '<div class="task-time">' + esc(b.time || '—') + '</div>'
          + '<div class="task-bar ' + statusCls + '"></div>'
          + '<div class="task-info">'
          + '<div class="task-title">' + esc(b.booking_type) + ' — ' + esc(b.doctor_name) + ' with ' + esc(resName) + '</div>'
          + '<div class="task-status ' + statusCls + '">Status: ' + esc(b.status.toUpperCase()) + '</div>'
          + '</div></div>';
      }).join('');
    } catch(e) {
      var listEl = document.getElementById('dash-tasks-list');
      if (listEl) listEl.innerHTML = '<div style="text-align:center;padding:24px 0;color:var(--text3);font-size:13px;">Could not load bookings.</div>';
    }
  }

  // ── 4. RECENT FLAGS ──
  async function loadRecentFlags() {
    var tbody = document.getElementById('dash-flags-tbody');
    if (!tbody) return;
    try {
      var res = await fetch(base + '/flags/', { headers: authHeaders() });
      if (!res.ok) throw new Error('flags');
      var data = await res.json();

      if (!data.length) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:24px;color:var(--text3);">No flags recorded yet.</td></tr>';
        return;
      }

      // Show latest 5
      tbody.innerHTML = data.slice(0, 5).map(function(f) {
        var sevCls = f.severity === 'High' ? 'badge progress' : f.severity === 'Medium' ? 'badge pending' : 'badge complete';
        var stCls  = f.status === 'Resolved' ? 'badge complete' : f.status === 'Open' ? 'badge progress' : 'badge pending';
        return '<tr>'
          + '<td>' + esc(f.resident_name) + '</td>'
          + '<td>' + esc(f.event_type) + '</td>'
          + '<td><span class="' + sevCls + '">' + esc(f.severity) + '</span></td>'
          + '<td><span class="' + stCls + '">' + esc(f.status) + '</span></td>'
          + '</tr>';
      }).join('');
    } catch(e) {
      tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:24px;color:var(--text3);">Could not load flags.</td></tr>';
    }
  }

  // ── 5. AI FLAGS PANEL (right sidebar) ──
  function renderAIFlags(alerts) {
    var el = document.getElementById('dash-ai-flags');
    if (!el) return;

    if (!alerts || !alerts.length) {
      el.innerHTML = '<div style="text-align:center;padding:16px 0;color:var(--text3);font-size:12px;">No active alerts</div>';
      return;
    }

    el.innerHTML = alerts.map(function(a) {
      var level = (a.level || 'info').toLowerCase();
      var cls  = level === 'critical' ? 'red-a' : level === 'warning' ? 'amber-a' : 'blue-a';
      var dot  = level === 'critical' ? 'red'   : level === 'warning' ? 'amber'   : 'blue';
      var icon = level === 'critical' ? '⚠'    : level === 'warning' ? '💡'      : 'ℹ';
      return '<div class="alert-item ' + cls + '">'
        + '<div class="alert-dot ' + dot + '">' + icon + '</div>'
        + '<div>'
        + '<div class="alert-title">' + esc(a.title) + '</div>'
        + '<div class="alert-desc">' + esc(a.message) + '</div>'
        + '</div></div>';
    }).join('');
  }

  // ── 6. MESSAGES WIDGET ──
  function renderDashboardMsgs(convs) {
    var el = document.getElementById('dashboard-msg-list');
    if (!el) return;

    var items = convs.filter(function(c){ return c.last_message; }).slice(0, 3);

    if (!items.length) {
      el.innerHTML = '<div style="text-align:center;padding:16px 0;color:var(--text3);font-size:12px;">No messages yet</div>';
      return;
    }

    el.innerHTML = items.map(function(c) {
      var color = avatarColor(c.name);
      var badge = c.unread_count > 0
        ? '<span style="background:var(--red);color:#fff;border-radius:10px;font-size:10px;font-weight:700;padding:1px 6px;margin-left:6px;">' + c.unread_count + '</span>'
        : '';
      return '<div class="msg-item" style="cursor:pointer;" onclick="window.location.href=\'message.html\'">'
        + '<div class="msg-avatar" style="background:' + color + ';width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:#fff;flex-shrink:0;">'
        + esc(initials(c.name))
        + '</div>'
        + '<div style="flex:1;min-width:0;">'
        + '<div style="display:flex;align-items:center;">'
        + '<span class="msg-name" style="' + (c.unread_count > 0 ? 'font-weight:800;' : '') + '">' + esc(c.name) + '</span>'
        + badge
        + '<span class="msg-time" style="margin-left:auto;">' + esc(timeAgo(c.last_message_at)) + '</span>'
        + '</div>'
        + '<div class="msg-text" style="' + (c.unread_count > 0 ? 'color:var(--text);font-weight:600;' : '') + 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">'
        + esc(c.last_message)
        + '</div>'
        + '</div>'
        + '</div>';
    }).join('');
  }

  async function loadDashboardMessages() {
    var el = document.getElementById('dashboard-msg-list');
    if (!el) return;

    try {
      var res = await fetch(base + '/messages/conversations', { headers: authHeaders() });
      if (!res.ok) throw new Error('not ok');
      var convs = await res.json();
      renderDashboardMsgs(convs);
    } catch(e) {
      if (el) el.innerHTML = '<div style="text-align:center;padding:16px 0;color:var(--text3);font-size:12px;">No messages yet</div>';
    }
  }

  // ── HELPERS ──
  function setText(id, val) {
    var el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  // ── INIT ──
  async function initDashboard() {
    // Fire all API calls in parallel
    await Promise.allSettled([
      loadDashboardStats(),
      loadResidentCount(),
      loadTodayBookings(),
      loadRecentFlags(),
      loadDashboardMessages(),
    ]);
    if (typeof hideSkeleton === 'function') hideSkeleton();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDashboard);
  } else {
    initDashboard();
  }

  // Auto-refresh messages every 30 seconds
  setInterval(loadDashboardMessages, 30000);
})();

// ══════════════════════════════════════════
// DASHBOARD LIVE MONITORING (Record / Pause / Auto Record)
// ══════════════════════════════════════════
(function() {
  var API = (typeof API_BASE !== 'undefined') ? API_BASE : '/api/v1';
  var monitorCameras = [];
  var localStreams = new Map(); // cameraId -> MediaStream
  var recState = new Map(); // cameraId -> {recorder,chunks,status,auto,cameraLabel}
  var prefsKey = 'dashboard_camera_record_prefs_v1';

  function authHeaders() {
    var h = { 'Content-Type': 'application/json' };
    var t = sessionStorage.getItem('access_token') || sessionStorage.getItem('spherecare_token');
    if (t) h['Authorization'] = 'Bearer ' + t;
    return h;
  }

  function getPrefs() {
    try { return JSON.parse(localStorage.getItem(prefsKey) || '{}'); }
    catch (_) { return {}; }
  }

  function setPrefs(p) {
    try { localStorage.setItem(prefsKey, JSON.stringify(p)); } catch (_) {}
  }

  async function loadFacilityCameras() {
    try {
      var res = await fetch(API + '/cameras/', { headers: authHeaders() });
      if (!res.ok) throw new Error();
      var rows = await res.json();
      return rows.map(function(c) {
        return {
          id: 'facility:' + c.id,
          deviceId: null,
          title: c.title || ('Camera ' + c.id),
          resident: c.resident_name || 'Common Area',
          status: (c.stream_status || c.status || 'offline') === 'live' ? 'live' : 'offline',
          streamUrl: c.stream_url || null,
          source: 'facility',
        };
      });
    } catch (_) {
      return [];
    }
  }

  async function loadLocalCameras() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices || !navigator.mediaDevices.getUserMedia) {
      return [];
    }
    try {
      var unlock = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      unlock.getTracks().forEach(function(t) { t.stop(); });
    } catch (_) {}

    try {
      var devices = await navigator.mediaDevices.enumerateDevices();
      var vids = devices.filter(function(d) { return d.kind === 'videoinput'; });
      return vids.map(function(d, i) {
        return {
          id: 'local:' + (d.deviceId || ('cam_' + (i + 1))),
          deviceId: d.deviceId || null,
          title: d.label || ('Local Camera ' + (i + 1)),
          resident: 'This device',
          status: 'live',
          streamUrl: null,
          source: 'local',
        };
      });
    } catch (_) {
      return [];
    }
  }

  function ensureState(cam) {
    if (!recState.has(cam.id)) {
      var prefs = getPrefs();
      var auto = !!prefs[cam.id];
      recState.set(cam.id, {
        recorder: null,
        chunks: [],
        status: 'idle',
        auto: auto,
        cameraLabel: cam.title || 'Camera',
      });
    }
    return recState.get(cam.id);
  }

  function getPreviewElementId(camId) {
    return 'monitor-preview-' + camId.replace(/[^a-zA-Z0-9_-]/g, '_');
  }

  function updateSummary() {
    var el = document.getElementById('monitoring-summary');
    if (!el) return;
    var total = monitorCameras.length;
    var recCount = 0;
    recState.forEach(function(s) { if (s.status === 'recording') recCount++; });
    el.textContent = total + ' camera(s) · ' + recCount + ' recording';
  }

  function renderMonitoring() {
    var wrap = document.getElementById('monitoring-cameras');
    if (!wrap) return;
    if (!monitorCameras.length) {
      wrap.innerHTML = '<div class="monitoring-empty">No cameras found.</div>';
      updateSummary();
      return;
    }
    wrap.innerHTML = monitorCameras.map(function(c) {
      var st = ensureState(c);
      var previewId = getPreviewElementId(c.id);
      var statusTag = st.status === 'recording' ? 'RECORDING' : st.status === 'paused' ? 'PAUSED' : (c.status === 'live' ? 'LIVE' : 'OFFLINE');
      return ''
        + '<div class="monitoring-card">'
        + '  <div class="monitoring-preview">'
        + '    <video id="' + previewId + '" autoplay muted playsinline></video>'
        + '    <div class="monitoring-preview-overlay">' + statusTag + '</div>'
        + '  </div>'
        + '  <div class="monitoring-body">'
        + '    <div class="monitoring-title">' + (c.title || 'Camera') + '</div>'
        + '    <div class="monitoring-meta">' + (c.resident || '—') + ' · ' + c.source + '</div>'
        + '    <div class="monitoring-controls">'
        + '      <button class="monitoring-btn rec" onclick="dashboardMonitoringStartRecord(\'' + c.id + '\')">Record</button>'
        + '      <button class="monitoring-btn pause" onclick="dashboardMonitoringTogglePause(\'' + c.id + '\')">' + (st.status === 'paused' ? 'Resume' : 'Pause') + '</button>'
        + '      <button class="monitoring-btn auto ' + (st.auto ? 'active' : '') + '" onclick="dashboardMonitoringToggleAuto(\'' + c.id + '\')">Auto Record</button>'
        + '      <button class="monitoring-btn" onclick="dashboardMonitoringStopRecord(\'' + c.id + '\')">Stop</button>'
        + '    </div>'
        + '  </div>'
        + '</div>';
    }).join('');

    monitorCameras.forEach(function(c) {
      var v = document.getElementById(getPreviewElementId(c.id));
      if (!v) return;
      if (c.source === 'local') {
        var stream = localStreams.get(c.id);
        if (stream) v.srcObject = stream;
      } else if (c.streamUrl) {
        v.src = c.streamUrl;
      }
    });
    updateSummary();
  }

  async function attachLocalStreams() {
    for (var i = 0; i < monitorCameras.length; i++) {
      var c = monitorCameras[i];
      if (c.source !== 'local') continue;
      if (localStreams.has(c.id)) continue;
      try {
        var constraints = c.deviceId ? { video: { deviceId: { exact: c.deviceId } }, audio: false } : { video: true, audio: false };
        var s = await navigator.mediaDevices.getUserMedia(constraints);
        localStreams.set(c.id, s);
      } catch (_) {}
    }
  }

  async function refreshMonitoring() {
    var local = await loadLocalCameras();
    var facility = await loadFacilityCameras();
    monitorCameras = local.concat(facility);
    await attachLocalStreams();
    renderMonitoring();
    autoStartEnabled();
  }

  function pickRecordableStream(camId) {
    var cam = monitorCameras.find(function(x) { return x.id === camId; });
    if (!cam) return null;
    if (cam.source === 'local') return localStreams.get(cam.id) || null;
    return null;
  }

  async function saveRecording(cameraId, chunks, cameraLabel) {
    if (!chunks || !chunks.length) return;
    var blob = new Blob(chunks, { type: chunks[0].type || 'video/webm' });
    if (!window.recordingVault?.vaultIsUnlocked?.()) return;
    var plain = await blob.arrayBuffer();
    var enc = await window.recordingVault.vaultEncryptArrayBuffer(plain);
    var now = new Date().toISOString();
    await window.recordingVault.vaultSaveRecording({
      id: 'dash_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
      createdAt: now,
      startedAt: now,
      endedAt: now,
      cameraLabel: cameraLabel || cameraId,
      mimeType: blob.type || 'video/webm',
      sizePlain: plain.byteLength,
      ivB64: enc.ivB64,
      cipherB64: enc.cipherB64,
      durationMs: null,
      notes: 'Dashboard monitoring recording',
    });
  }

  async function startRecord(cameraId) {
    var st = recState.get(cameraId);
    var cam = monitorCameras.find(function(x) { return x.id === cameraId; });
    if (!st || !cam) return;
    if (st.status === 'recording') return;
    var stream = pickRecordableStream(cameraId);
    if (!stream) {
      alert('Recording is currently supported for local camera feeds on dashboard.');
      return;
    }
    try {
      st.chunks = [];
      st.recorder = new MediaRecorder(stream);
      st.recorder.ondataavailable = function(e) {
        if (e.data && e.data.size > 0) st.chunks.push(e.data);
      };
      st.recorder.onstop = async function() {
        try {
          await saveRecording(cameraId, st.chunks, st.cameraLabel);
        } catch (_) {}
        st.recorder = null;
        st.chunks = [];
        st.status = 'idle';
        renderMonitoring();
      };
      st.recorder.start(1000);
      st.status = 'recording';
      renderMonitoring();
    } catch (_) {
      alert('Unable to start recording for this camera.');
    }
  }

  function stopRecord(cameraId) {
    var st = recState.get(cameraId);
    if (!st || !st.recorder) return;
    if (st.recorder.state !== 'inactive') st.recorder.stop();
    st.status = 'idle';
    renderMonitoring();
  }

  function togglePause(cameraId) {
    var st = recState.get(cameraId);
    if (!st || !st.recorder) return;
    if (st.recorder.state === 'recording') {
      st.recorder.pause();
      st.status = 'paused';
    } else if (st.recorder.state === 'paused') {
      st.recorder.resume();
      st.status = 'recording';
    }
    renderMonitoring();
  }

  function toggleAuto(cameraId) {
    var st = recState.get(cameraId);
    if (!st) return;
    st.auto = !st.auto;
    var p = getPrefs();
    p[cameraId] = st.auto;
    setPrefs(p);
    renderMonitoring();
    if (st.auto && st.status === 'idle') startRecord(cameraId);
  }

  function autoStartEnabled() {
    recState.forEach(function(st, cameraId) {
      if (st.auto && st.status === 'idle') startRecord(cameraId);
    });
  }

  function releaseStreams() {
    localStreams.forEach(function(s) { s.getTracks().forEach(function(t) { t.stop(); }); });
    localStreams.clear();
  }

  window.dashboardMonitoringRefresh = refreshMonitoring;
  window.dashboardMonitoringStartRecord = startRecord;
  window.dashboardMonitoringStopRecord = stopRecord;
  window.dashboardMonitoringTogglePause = togglePause;
  window.dashboardMonitoringToggleAuto = toggleAuto;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', refreshMonitoring);
  } else {
    refreshMonitoring();
  }

  window.addEventListener('beforeunload', releaseStreams);
})();