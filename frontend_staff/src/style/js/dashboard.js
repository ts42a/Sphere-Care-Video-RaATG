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
  var AVATAR_COLORS = [
    '#2ec4b6',
    '#7c3aed',
    '#db2777',
    '#059669',
    '#d97706',
    '#0369a1',
    '#dc2626',
    '#9333ea'
  ];

  var colorMap = {};
  var colorIdx = 0;

  function avatarColor(name) {
    if (!colorMap[name]) {
      colorMap[name] = AVATAR_COLORS[colorIdx++ % AVATAR_COLORS.length];
    }
    return colorMap[name];
  }

  function initials(name) {
    return (name || '?')
      .split(' ')
      .map(function(w) {
        return w[0];
      })
      .join('')
      .toUpperCase()
      .slice(0, 2);
  }

  function authHeaders() {
    var h = {
      'Content-Type': 'application/json'
    };

    var t =
      sessionStorage.getItem('access_token') ||
      sessionStorage.getItem('spherecare_token');

    if (t) {
      h['Authorization'] = 'Bearer ' + t;
    }

    return h;
  }

  function esc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function timeAgo(raw) {
    if (!raw) return '';

    if (typeof raw === 'string' && raw.length < 20 && !/^\d{4}-/.test(raw)) {
      return raw;
    }

    try {
      var diff = Math.floor((Date.now() - new Date(raw).getTime()) / 60000);

      if (diff < 1) return 'Just now';
      if (diff < 60) return diff + 'm ago';
      if (diff < 1440) return Math.floor(diff / 60) + 'h ago';

      return Math.floor(diff / 1440) + 'd ago';
    } catch(e) {
      return raw;
    }
  }

  function formatLocalDate(d) {
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  function normaliseBooking(b) {
    return {
      id: b.id,
      date: b.appointment_date,
      time: b.start_time,
      endTime: b.end_time,
      type: b.booking_type,
      doctor: b.doctor_name,
      specialty: b.doctor_specialty || '',
      resident: b.resident ? b.resident.full_name : 'Resident #' + b.resident_id,
      status: b.status || 'requested',
      location: b.location || '',
      notes: b.notes || ''
    };
  }

  var base = (typeof API_BASE !== 'undefined') ? API_BASE : '/api/v1';


  // ── 1. DASHBOARD STATS ──
  async function loadDashboardStats() {
    try {
      var res = await fetch(base + '/dashboard/stats', {
        headers: authHeaders()
      });

      if (!res.ok) throw new Error('stats');

      var s = await res.json();

      setText('dash-staff-duty', s.active_staff);

      // IMPORTANT:
      // dash-pending-tasks is now controlled by today's bookings.
      // Do not use s.pending_tasks here because backend counts status = pending only.
      // setText('dash-pending-tasks', s.pending_tasks);

      setText(
        'dash-active-alerts',
        s.recent_alerts ? s.recent_alerts.length : 0
      );

      renderAIFlags(s.recent_alerts || []);

    } catch(e) {
      setText('dash-staff-duty', '—');
      setText('dash-active-alerts', '—');
    }
  }


  // ── 2. TOTAL RESIDENTS ──
  async function loadResidentCount() {
    try {
      var res = await fetch(base + '/residents/', {
        headers: authHeaders()
      });

      if (!res.ok) throw new Error('residents');

      var data = await res.json();

      setText('dash-total-residents', data.length);

    } catch(e) {
      setText('dash-total-residents', '—');
    }
  }


  // ── 3. TODAY'S BOOKINGS + UPCOMING BOOKINGS ──
  async function loadTodayBookings() {
    try {
      var res = await fetch(base + '/bookings/', {
        headers: authHeaders()
      });

      if (!res.ok) throw new Error('bookings');

      var data = await res.json();

      var bookings = data.map(normaliseBooking);

      bookings.sort(function(a, b) {
        var aKey = (a.date || '') + ' ' + (a.time || '');
        var bKey = (b.date || '') + ' ' + (b.time || '');
        return aKey.localeCompare(bKey);
      });

      var todayStr = formatLocalDate(new Date());

      var todayBookings = bookings.filter(function(b) {
        return b.date === todayStr &&
          b.status !== 'cancelled' &&
          b.status !== 'completed';
      });

      var titleEl = document.getElementById('dash-tasks-title');
      var subEl   = document.getElementById('dash-tasks-sub');
      var listEl  = document.getElementById('dash-tasks-list');

      if (!listEl) return;

      var d = new Date();

      var dayLabel = d.toLocaleDateString('en-AU', {
        weekday: 'long',
        day: 'numeric',
        month: 'short'
      });

      if (titleEl) {
        titleEl.textContent = "Today's Bookings (" + dayLabel + ')';
      }

      // make dashboard number align with today's bookings
      setText('dash-pending-tasks', todayBookings.length);

      if (subEl) {
        subEl.textContent = todayBookings.length
          ? todayBookings.length + ' booking(s) scheduled for today.'
          : 'No bookings scheduled for today.';
      }

      if (!todayBookings.length) {
        listEl.innerHTML =
          '<div style="text-align:center;padding:24px 0;color:var(--text3);font-size:13px;">No bookings today.</div>';
      } else {
        listEl.innerHTML = renderBookingsTable(todayBookings, false);
      }

    } catch(e) {
      var listEl = document.getElementById('dash-tasks-list');

      if (listEl) {
        listEl.innerHTML =
          '<div style="text-align:center;padding:24px 0;color:var(--text3);font-size:13px;">Could not load bookings.</div>';
      }

      setText('dash-pending-tasks', '—');
    }
  }


  function renderBookingsTable(bookings, showDate) {
    if (!bookings.length) {
      return '<div style="text-align:center;padding:24px 0;color:var(--text3);font-size:13px;">No bookings.</div>';
    }

    var doctorMap = {};   // doctor name -> specialty
    var colSet    = {};   // col key -> display label
    var lookup    = {};   // "doctor\0colKey" -> booking

    bookings.forEach(function(b) {
      var doc    = b.doctor || 'Unknown';
      var time   = b.time   || '—';
      var colKey = showDate ? (b.date + ' ' + time) : time;
      var colLbl = showDate ? (b.date + '\n' + time) : time;

      if (!doctorMap.hasOwnProperty(doc)) doctorMap[doc] = b.specialty || '';
      colSet[colKey] = colLbl;

      var k = doc + '\x00' + colKey;
      if (!lookup[k]) lookup[k] = b;
    });

    var doctors = Object.keys(doctorMap).sort();
    var cols    = Object.keys(colSet).sort();

    var html = '<div class="bk-table-wrap"><table class="bk-sched-table">'
      + '<thead><tr><th class="bk-th-doc">Doctor</th>';

    cols.forEach(function(c) {
      var parts = colSet[c].split('\n');
      html += '<th class="bk-th-time">';
      if (parts.length > 1) {
        html += '<span class="bk-th-date">' + esc(parts[0]) + '</span>'
             +  '<span class="bk-th-t">'    + esc(parts[1]) + '</span>';
      } else {
        html += esc(parts[0]);
      }
      html += '</th>';
    });

    html += '</tr></thead><tbody>';

    doctors.forEach(function(doc) {
      html += '<tr>'
        + '<td class="bk-td-doc">'
        + '<div class="bk-doc-name">' + esc(doc) + '</div>';
      if (doctorMap[doc]) {
        html += '<div class="bk-doc-spec">' + esc(doctorMap[doc]) + '</div>';
      }
      html += '</td>';

      cols.forEach(function(c) {
        var b = lookup[doc + '\x00' + c];
        if (b) {
          var st  = b.status || 'requested';
          var cls = st === 'confirmed' ? 'done'
                  : st === 'cancelled' ? 'urgent'
                  : 'pending';
          html += '<td class="bk-td-cell">'
            + '<div class="bk-appt ' + cls + '">'
            + '<div class="bk-appt-resident">' + esc(b.resident || '—') + '</div>'
            + '<div class="bk-appt-type">'     + esc(b.type     || '')  + '</div>'
            + '</div></td>';
        } else {
          html += '<td class="bk-td-empty"></td>';
        }
      });

      html += '</tr>';
    });

    html += '</tbody></table></div>';
    return html;
  }


  // ── 4. RECENT FLAGS ──
  async function loadRecentFlags() {
    var tbody = document.getElementById('dash-flags-tbody');

    if (!tbody) return;

    try {
      var res = await fetch(base + '/flags/', {
        headers: authHeaders()
      });

      if (!res.ok) throw new Error('flags');

      var data = await res.json();

      if (!data.length) {
        tbody.innerHTML =
          '<tr><td colspan="4" style="text-align:center;padding:24px;color:var(--text3);">No flags recorded yet.</td></tr>';
        return;
      }

      tbody.innerHTML = data.slice(0, 5).map(function(f) {
        var sevCls =
          f.severity === 'High' ? 'badge progress' :
          f.severity === 'Medium' ? 'badge pending' :
          'badge complete';

        var stCls =
          f.status === 'Resolved' ? 'badge complete' :
          f.status === 'Open' ? 'badge progress' :
          'badge pending';

        return '<tr>'
          + '<td>' + esc(f.resident_name) + '</td>'
          + '<td>' + esc(f.event_type) + '</td>'
          + '<td><span class="' + sevCls + '">' + esc(f.severity) + '</span></td>'
          + '<td><span class="' + stCls + '">' + esc(f.status) + '</span></td>'
          + '</tr>';
      }).join('');

    } catch(e) {
      tbody.innerHTML =
        '<tr><td colspan="4" style="text-align:center;padding:24px;color:var(--text3);">Could not load flags.</td></tr>';
    }
  }


  // ── 5. AI FLAGS PANEL / ALERT PANEL ──
  function renderAIFlags(alerts) {
    var el = document.getElementById('dash-ai-flags');

    if (!el) return;

    if (!alerts || !alerts.length) {
      el.innerHTML =
        '<div style="text-align:center;padding:16px 0;color:var(--text3);font-size:12px;">No active alerts</div>';
      return;
    }

    el.innerHTML = alerts.map(function(a) {
      var level = (a.level || 'info').toLowerCase();

      var cls =
        level === 'critical' ? 'red-a' :
        level === 'warning' ? 'amber-a' :
        'blue-a';

      var dot =
        level === 'critical' ? 'red' :
        level === 'warning' ? 'amber' :
        'blue';

      var icon =
        level === 'critical' ? '⚠' :
        level === 'warning' ? '💡' :
        'ℹ';

      return '<div class="alert-item ' + cls + '">'
        + '<div class="alert-dot ' + dot + '">' + icon + '</div>'
        + '<div>'
        + '<div class="alert-title">' + esc(a.title) + '</div>'
        + '<div class="alert-desc">' + esc(a.message) + '</div>'
        + '</div>'
        + '</div>';
    }).join('');
  }


  // ── 6. MESSAGES WIDGET ──
  function renderDashboardMsgs(convs) {
    var el = document.getElementById('dashboard-msg-list');

    if (!el) return;

    var items = convs
      .filter(function(c) {
        return c.last_message;
      })
      .slice(0, 3);

    if (!items.length) {
      el.innerHTML =
        '<div style="text-align:center;padding:16px 0;color:var(--text3);font-size:12px;">No messages yet</div>';
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
      var res = await fetch(base + '/messages/conversations', {
        headers: authHeaders()
      });

      if (!res.ok) throw new Error('not ok');

      var convs = await res.json();

      renderDashboardMsgs(convs);

    } catch(e) {
      if (el) {
        el.innerHTML =
          '<div style="text-align:center;padding:16px 0;color:var(--text3);font-size:12px;">No messages yet</div>';
      }
    }
  }


  // ── HELPERS ──
  function setText(id, val) {
    var el = document.getElementById(id);

    if (el) {
      el.textContent = val;
    }
  }


  // ── INIT ──
  async function initDashboard() {
    await Promise.allSettled([
      loadDashboardStats(),
      loadResidentCount(),
      loadTodayBookings(),
      loadRecentFlags(),
      loadDashboardMessages()
    ]);

    if (typeof hideSkeleton === 'function') {
      hideSkeleton();
    }
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
// DASHBOARD LIVE MONITORING
// Record / Pause / Auto Record
// ══════════════════════════════════════════
(function() {
  var API = (typeof API_BASE !== 'undefined') ? API_BASE : '/api/v1';

  var monitorCameras = [];
  var localStreams = new Map();
  var recState = new Map();
  var prefsKey = 'dashboard_camera_record_prefs_v1';

  function authHeaders() {
    var h = {
      'Content-Type': 'application/json'
    };

    var t =
      sessionStorage.getItem('access_token') ||
      sessionStorage.getItem('spherecare_token');

    if (t) {
      h['Authorization'] = 'Bearer ' + t;
    }

    return h;
  }

  function getPrefs() {
    try {
      return JSON.parse(localStorage.getItem(prefsKey) || '{}');
    } catch (_) {
      return {};
    }
  }

  function setPrefs(p) {
    try {
      localStorage.setItem(prefsKey, JSON.stringify(p));
    } catch (_) {}
  }

  async function loadFacilityCameras() {
    try {
      var res = await fetch(API + '/cameras/', {
        headers: authHeaders()
      });

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
          source: 'facility'
        };
      });

    } catch (_) {
      return [];
    }
  }

  async function loadLocalCameras() {
    if (
      !navigator.mediaDevices ||
      !navigator.mediaDevices.enumerateDevices ||
      !navigator.mediaDevices.getUserMedia
    ) {
      return [];
    }

    try {
      var unlock = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: false
      });

      unlock.getTracks().forEach(function(t) {
        t.stop();
      });

    } catch (_) {}

    try {
      var devices = await navigator.mediaDevices.enumerateDevices();

      var vids = devices.filter(function(d) {
        return d.kind === 'videoinput';
      });

      return vids.map(function(d, i) {
        return {
          id: 'local:' + (d.deviceId || ('cam_' + (i + 1))),
          deviceId: d.deviceId || null,
          title: d.label || ('Local Camera ' + (i + 1)),
          resident: 'This device',
          status: 'live',
          streamUrl: null,
          source: 'local'
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
        cameraLabel: cam.title || 'Camera'
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

    recState.forEach(function(s) {
      if (s.status === 'recording') {
        recCount++;
      }
    });

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

      var statusTag =
        st.status === 'recording' ? 'RECORDING' :
        st.status === 'paused' ? 'PAUSED' :
        c.status === 'live' ? 'LIVE' :
        'OFFLINE';

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

        if (stream) {
          v.srcObject = stream;
        }

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
        var constraints = c.deviceId
          ? {
              video: {
                deviceId: {
                  exact: c.deviceId
                }
              },
              audio: false
            }
          : {
              video: true,
              audio: false
            };

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
    var cam = monitorCameras.find(function(x) {
      return x.id === camId;
    });

    if (!cam) return null;

    if (cam.source === 'local') {
      return localStreams.get(cam.id) || null;
    }

    return null;
  }

  async function saveRecording(cameraId, chunks, cameraLabel) {
    if (!chunks || !chunks.length) return;

    var blob = new Blob(chunks, {
      type: chunks[0].type || 'video/webm'
    });

    if (!window.recordingVault?.vaultIsUnlocked?.()) {
      return;
    }

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
      notes: 'Dashboard monitoring recording'
    });
  }

  async function startRecord(cameraId) {
    var st = recState.get(cameraId);

    var cam = monitorCameras.find(function(x) {
      return x.id === cameraId;
    });

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
        if (e.data && e.data.size > 0) {
          st.chunks.push(e.data);
        }
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

    if (st.recorder.state !== 'inactive') {
      st.recorder.stop();
    }

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

    if (st.auto && st.status === 'idle') {
      startRecord(cameraId);
    }
  }

  function autoStartEnabled() {
    recState.forEach(function(st, cameraId) {
      if (st.auto && st.status === 'idle') {
        startRecord(cameraId);
      }
    });
  }

  function releaseStreams() {
    localStreams.forEach(function(s) {
      s.getTracks().forEach(function(t) {
        t.stop();
      });
    });

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
