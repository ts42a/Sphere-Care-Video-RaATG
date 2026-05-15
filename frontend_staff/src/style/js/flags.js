/* ═══════════════════════════════════════════════════════════
   flags.js  —  Flags & Reviews page logic
   ═══════════════════════════════════════════════════════════ */

window._FLAGS_API = (typeof API_BASE !== 'undefined' ? API_BASE : '/api/v1');
var _allFlags   = [];   // raw data from API
var _activeFlag = null; // currently open flag object

// ── Auth header helper ────────────────────────────────────────────
function authH() {
  var t = sessionStorage.getItem('access_token') || sessionStorage.getItem('spherecare_token') || '';
  return { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + t };
}

// ── Severity config ───────────────────────────────────────────────
var SEV_CFG = {
  'Critical': { cls: 'flag-sev-critical', icon: '🚨', label: 'Critical Severity' },
  'High':     { cls: 'flag-sev-high',     icon: '🔴', label: 'High Severity'     },
  'Medium':   { cls: 'flag-sev-medium',   icon: '⚠️', label: 'Medium Severity'   },
  'Low':      { cls: 'flag-sev-low',      icon: '🟡', label: 'Low Severity'      },
};

var STATUS_COLORS = {
  'Open':           'status-open',
  'Pending Review': 'status-pending',
  'Resolved':       'status-resolved',
  'Escalated':      'status-escalated',
};

// ── Escape HTML ───────────────────────────────────────────────────
function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ══════════════════════════════════════════════════════════════════
// LOAD DATA
// ══════════════════════════════════════════════════════════════════

async function loadStats() {
  try {
    var r = await fetch(window._FLAGS_API + '/flags/stats', { headers: authH() });
    if (!r.ok) return;
    var d = await r.json();
    document.getElementById('st-ai').textContent      = d.ai_flags_today  ?? '—';
    document.getElementById('st-manual').textContent  = d.manual_flags     ?? '—';
    document.getElementById('st-pending').textContent = d.pending_review   ?? '—';
    document.getElementById('st-resolved').textContent= d.resolved         ?? '—';
  } catch(e) {}
}

async function loadFlags() {
  var tbody = document.getElementById('flags-tbody');
  tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:32px;color:#94a3b8;">Loading…</td></tr>';

  try {
    var r = await fetch(window._FLAGS_API + '/flags/?limit=100', { headers: authH() });
    if (!r.ok) throw new Error('Failed');
    _allFlags = await r.json();
    renderTable(_allFlags);
  } catch(e) {
    console.error('loadFlags error:', e);
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:32px;color:#ef4444;">Failed to load flags.</td></tr>';
  }
}

// ══════════════════════════════════════════════════════════════════
// RENDER TABLE
// ══════════════════════════════════════════════════════════════════

function renderTable(flags) {
  var tbody = document.getElementById('flags-tbody');
  if (!flags || !flags.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:32px;color:#94a3b8;">No flags found.</td></tr>';
    return;
  }

  tbody.innerHTML = flags.map(function(f) {
    var initials = (f.resident_name || 'U').split(' ').map(function(w){ return w[0]; }).join('').toUpperCase().slice(0,2);
    var sevCfg   = SEV_CFG[f.severity] || SEV_CFG['Medium'];
    var statusCls = STATUS_COLORS[f.status] || 'status-open';
    var confidence = f.ai_confidence ? (parseFloat(f.ai_confidence) * 100).toFixed(0) + '%' : '';
    var srcBadge = f.source === 'AI'
      ? '<span style="font-size:11px;color:#6366f1;">AI ' + esc(confidence) + '</span>'
      : '<span style="font-size:11px;color:#0ea5e9;">Staff</span>';

    return '<tr style="border-bottom:1px solid #f1f5f9;">' +
      '<td style="padding:10px 12px;">' +
        '<div style="display:flex;align-items:center;gap:8px;">' +
          '<div style="width:30px;height:30px;border-radius:50%;background:#7c3aed;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:11px;flex-shrink:0;cursor:pointer;" onclick="openResidentContact(' + (f.resident_id||0) + ',\'' + esc(f.resident_name||'').replace(/'/g,"\\'") + '\')">' + esc(initials) + '</div>' +
          '<span style="font-weight:600;font-size:13px;cursor:pointer;color:#1e293b;" onclick="openResidentContact(' + (f.resident_id||0) + ',\'' + esc(f.resident_name||'').replace(/'/g,"\\'") + '\')">' + esc(f.resident_name || '—') + '</span>' +
        '</div>' +
      '</td>' +
      '<td style="padding:10px 12px;font-size:13px;font-weight:600;">' + esc(f.event_type) + '</td>' +
      '<td style="padding:10px 12px;max-width:200px;font-size:12.5px;color:#64748b;">' + esc((f.description||'').slice(0,70)) + (f.description && f.description.length > 70 ? '…' : '') + '</td>' +
      '<td style="padding:10px 12px;"><span class="sev-pill sev-' + esc(f.severity.toLowerCase()) + '">' + sevCfg.icon + ' ' + esc(f.severity) + '</span></td>' +
      '<td style="padding:10px 12px;font-size:12px;color:#64748b;white-space:nowrap;">' + esc(f.flagged_at || f.created_at || '—') + '</td>' +
      '<td style="padding:10px 12px;">' +
        '<div style="display:flex;flex-direction:column;gap:2px;">' +
          '<span class="' + statusCls + '">' + esc(f.status) + '</span>' +
          srcBadge +
        '</div>' +
      '</td>' +
      '<td style="padding:10px 12px;">' +
        '<button class="view-btn" onclick="openFlag(' + f.id + ')">👁 View</button>' +
      '</td>' +
    '</tr>';
  }).join('');

  if (typeof window.hideSkeleton === 'function') window.hideSkeleton();
}

// ══════════════════════════════════════════════════════════════════
// FILTER
// ══════════════════════════════════════════════════════════════════

function filterFlags() {
  var search = (document.getElementById('flag-search') ? document.getElementById('flag-search').value : '').toLowerCase().trim();
  var etype  = document.getElementById('f-etype')  ? document.getElementById('f-etype').value  : '';
  var sev    = document.getElementById('f-sev')    ? document.getElementById('f-sev').value    : '';
  var status = document.getElementById('f-status') ? document.getElementById('f-status').value : '';

  var filtered = _allFlags.filter(function(f) {
    if (search && !(
      (f.resident_name  || '').toLowerCase().includes(search) ||
      (f.event_type     || '').toLowerCase().includes(search) ||
      (f.description    || '').toLowerCase().includes(search)
    )) return false;
    if (etype  && f.event_type !== etype)  return false;
    if (sev    && f.severity   !== sev)    return false;
    if (status && f.status     !== status) return false;
    return true;
  });

  renderTable(filtered);
}

// ══════════════════════════════════════════════════════════════════
// OPEN FLAG DETAIL MODAL
// ══════════════════════════════════════════════════════════════════

// ── Parse structured context from sev_desc ───────────────────────
function _parseContext(flag) {
  try {
    var ctx = JSON.parse(flag.sev_desc || '{}');
    if (ctx.source) return { source: ctx.source, conversation_id: ctx.conversation_id || null, call_room_id: ctx.call_room_id || null, sev_desc: ctx.sev_desc || '' };
  } catch(e) {}
  var desc = (flag.description || '').toLowerCase();
  var source = 'unknown';
  if (desc.includes('chat message')) source = 'message';
  else if (desc.includes('call') || desc.includes('transcript')) source = 'call';
  else if (flag.camera_id || desc.includes('camera') || desc.includes('recording')) source = 'recording';
  var convMatch = (flag.description || '').match(/Conversation ID[:\s]+(\d+)/i);
  var roomMatch = (flag.description || '').match(/Call room[:\s]+([^\s|]+)/i);
  return { source: source, conversation_id: convMatch ? parseInt(convMatch[1]) : null, call_room_id: roomMatch ? roomMatch[1] : null, sev_desc: flag.sev_desc || '' };
}

function _buildSourceAction(flag, ctx) {
  var labels = { message: 'Chat message', call: 'Video/audio call', transcript: 'Call transcript', recording: 'Recording Console', unknown: 'System' };
  var icons  = { message: '💬', call: '📹', transcript: '📹', recording: '🎥', unknown: '📋' };
  var label  = labels[ctx.source] || ctx.source;
  var icon   = icons[ctx.source]  || '📋';
  var btn    = '';
  if (ctx.source === 'message' && ctx.conversation_id) {
    btn = '<button onclick="goToMessage(' + ctx.conversation_id + ')" style="margin-top:8px;display:flex;align-items:center;gap:7px;padding:8px 14px;border-radius:8px;border:none;background:#6366f1;color:#fff;font-weight:700;font-size:12px;cursor:pointer;">💬 Open in Messages</button>';
  } else if (ctx.source === 'call' || ctx.source === 'transcript') {
    btn = '<button onclick="showCallSnapshot()" style="margin-top:8px;display:flex;align-items:center;gap:7px;padding:8px 14px;border-radius:8px;border:none;background:#0ea5e9;color:#fff;font-weight:700;font-size:12px;cursor:pointer;">📹 View Call Screenshot</button>';
  } else if (ctx.source === 'recording' || flag.camera_id) {
    btn = '<button onclick="showRecordingSnapshot()" style="margin-top:8px;display:flex;align-items:center;gap:7px;padding:8px 14px;border-radius:8px;border:none;background:#10b981;color:#fff;font-weight:700;font-size:12px;cursor:pointer;">🎥 View Recording Screenshot</button>';
  }
  return '<div style="background:#f8fafc;border-radius:10px;padding:10px 13px;margin-bottom:14px;">' +
    '<div style="font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;margin-bottom:5px;">Detected In</div>' +
    '<div style="font-size:13px;font-weight:600;color:#334155;">' + icon + ' ' + esc(label) + '</div>' +
    btn + '</div>';
}

function goToMessage(convId) {
  sessionStorage.setItem('open_conversation_id', convId);
  window.location.href = '/pages/message.html';
}

function showCallSnapshot() {
  var s = document.getElementById('fm-call-snapshot');
  if (s) s.style.display = (s.style.display === 'none' || !s.style.display) ? 'block' : 'none';
}

function showRecordingSnapshot() {
  var s = document.getElementById('fm-recording-snapshot');
  if (s) s.style.display = (s.style.display === 'none' || !s.style.display) ? 'block' : 'none';
}

async function openFlag(flagId) {
  var flag = _allFlags.find(function(f){ return f.id === flagId; });
  try {
    var r = await fetch(window._FLAGS_API + '/flags/' + flagId, { headers: authH() });
    if (r.ok) flag = await r.json();
  } catch(e) {}
  if (!flag) return;
  _activeFlag = flag;

  var ctx = _parseContext(flag);

  document.getElementById('fm-name').textContent   = flag.resident_name || '—';
  document.getElementById('fm-etype').textContent  = flag.event_type    || '—';
  document.getElementById('fm-source').textContent = flag.source === 'AI'
    ? '🤖 AI Detected' + (flag.ai_confidence ? ' · ' + (parseFloat(flag.ai_confidence)*100).toFixed(0) + '% confidence' : '')
    : '👤 Staff Reported';

  // Status pill in header
  var statusPillEl = document.getElementById('fm-status-pill');
  if (statusPillEl) statusPillEl.innerHTML = renderStatusPill(flag.status);

  var sevCfg = SEV_CFG[flag.severity] || SEV_CFG['Medium'];
  document.getElementById('fm-sev-box').className = 'flag-sev-box ' + sevCfg.cls;
  document.getElementById('fm-sev-icon').textContent = sevCfg.icon;
  document.getElementById('fm-sev-text').textContent = sevCfg.label;
  document.getElementById('fm-sev-desc').textContent = ctx.sev_desc || flag.description || '—';

  // Source action button
  var saEl = document.getElementById('fm-source-action');
  if (saEl) saEl.innerHTML = _buildSourceAction(flag, ctx);

  // Call snapshot panel
  var callSnap = document.getElementById('fm-call-snapshot');
  if (callSnap) {
    callSnap.style.display = 'none';
    callSnap.innerHTML =
      '<div style="background:#0f172a;border-radius:10px;overflow:hidden;height:120px;position:relative;margin-bottom:4px;">' +
        '<div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;">' +
          '<div style="font-size:32px;opacity:.4;">📹</div>' +
          '<div style="font-size:11px;color:rgba(255,255,255,.4);">Video call · ' + esc(flag.video_timestamp || 'no timestamp') + '</div>' +
          (ctx.call_room_id ? '<div style="font-size:10px;color:rgba(255,255,255,.3);">Room: ' + esc(ctx.call_room_id) + '</div>' : '') +
        '</div>' +
        '<div style="position:absolute;top:7px;left:8px;background:rgba(239,68,68,.85);color:#fff;font-size:10px;font-weight:700;padding:2px 7px;border-radius:4px;">⚠ HAZARD DETECTED</div>' +
      '</div>' +
      '<div style="font-size:11px;color:#94a3b8;margin-bottom:10px;">Screenshot at time of detection</div>';
  }

  // Recording snapshot panel
  var recSnap = document.getElementById('fm-recording-snapshot');
  if (recSnap) {
    recSnap.style.display = 'none';
    recSnap.innerHTML =
      '<div style="background:#0f172a;border-radius:10px;overflow:hidden;height:120px;position:relative;margin-bottom:4px;cursor:pointer;">' +
        '<div style="position:absolute;inset:0;background:linear-gradient(135deg,#0f2030,#1a3a50);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;">' +
          '<div style="font-size:32px;opacity:.4;">🎥</div>' +
          '<div style="font-size:11px;color:rgba(255,255,255,.4);">CCTV · ' + esc(flag.video_timestamp || '—') + '</div>' +
          (flag.camera_id ? '<div style="font-size:10px;color:rgba(255,255,255,.3);">Camera #' + flag.camera_id + '</div>' : '') +
        '</div>' +
        '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;">' +
          '<svg viewBox="0 0 24 24" style="width:26px;height:26px;fill:#fff;opacity:.6;"><polygon points="5 3 19 12 5 21 5 3"/></svg>' +
        '</div>' +
        '<div style="position:absolute;top:7px;left:8px;background:rgba(239,68,68,.85);color:#fff;font-size:10px;font-weight:700;padding:2px 7px;border-radius:4px;">⚠ INCIDENT DETECTED</div>' +
        '<div style="position:absolute;bottom:6px;right:8px;font-size:10px;color:rgba(255,255,255,.6);background:rgba(0,0,0,.45);padding:2px 7px;border-radius:5px;">⏱ ' + esc(flag.video_timestamp || '—') + '</div>' +
      '</div>' +
      '<div style="font-size:11px;color:#94a3b8;margin-bottom:10px;">Recording snapshot at flagged moment</div>';
  }

  var transcriptEl = document.getElementById('fm-transcript');
  transcriptEl.textContent = flag.transcript || flag.description || 'No transcript available.';

  var statusSel = document.getElementById('fm-status-sel');
  if (statusSel) statusSel.value = flag.status || 'Open';

  var metaEl = document.getElementById('fm-meta');
  if (metaEl) {
    metaEl.innerHTML =
      '<span>📅 ' + esc(flag.flagged_at || flag.created_at || '—') + '</span>' +
      (flag.resident_id ? ' &nbsp;·&nbsp; <span style="cursor:pointer;color:#6366f1;font-weight:600;" onclick="openResidentContact(' + flag.resident_id + ',\'' + esc(flag.resident_name||'').replace("'","\\'") + '\')">👤 ' + esc(flag.resident_name||'Resident') + ' ↗</span>' : '');
  }

  renderComments(flag.comments || []);
  renderReviewHistory(flag.reviews || []);
  openModal('modal-flag');
}

// ══════════════════════════════════════════════════════════════════
// COMMENTS
// ══════════════════════════════════════════════════════════════════

function renderComments(comments) {
  var el = document.getElementById('fm-comments');
  if (!el) return;
  if (!comments || !comments.length) {
    el.innerHTML = '<div style="font-size:13px;color:#94a3b8;padding:8px 0;">No comments yet.</div>';
    return;
  }
  el.innerHTML = comments.map(function(c) {
    return '<div style="background:#f8fafc;border-radius:10px;padding:10px 13px;margin-bottom:8px;">' +
      '<div style="display:flex;justify-content:space-between;margin-bottom:4px;">' +
        '<span style="font-weight:700;font-size:13px;">' + esc(c.author_name) + '</span>' +
        '<span style="font-size:11px;color:#94a3b8;">' + esc(c.created_at||'') + '</span>' +
      '</div>' +
      '<div style="font-size:13px;color:#334155;">' + esc(c.body) + '</div>' +
    '</div>';
  }).join('');
}

async function submitComment() {
  if (!_activeFlag) return;
  var input = document.getElementById('fm-comment-input');
  var body  = (input ? input.value : '').trim();
  if (!body) return;
  var user = {};
  try { user = JSON.parse(sessionStorage.getItem('user')||'{}'); } catch(e) {}
  try {
    var r = await fetch(window._FLAGS_API + '/flags/' + _activeFlag.id + '/comments', {
      method: 'POST', headers: authH(),
      body: JSON.stringify({ author_name: user.full_name||'Staff', body: body })
    });
    if (r.ok) {
      var c = await r.json();
      _activeFlag.comments = (_activeFlag.comments||[]).concat([c]);
      renderComments(_activeFlag.comments);
      if (input) input.value = '';
    }
  } catch(e) { alert('Failed to post comment.'); }
}

// ══════════════════════════════════════════════════════════════════
// STATUS UPDATE
// ══════════════════════════════════════════════════════════════════

async function updateFlagStatus() {
  if (!_activeFlag) return;
  var sel = document.getElementById('fm-status-sel');
  var newStatus = sel ? sel.value : null;
  if (!newStatus) return;
  try {
    var r = await fetch(window._FLAGS_API + '/flags/' + _activeFlag.id + '/status', {
      method: 'PATCH', headers: authH(),
      body: JSON.stringify({ status: newStatus })
    });
    if (r.ok) {
      _activeFlag.status = newStatus;
      var idx = _allFlags.findIndex(function(f){ return f.id === _activeFlag.id; });
      if (idx >= 0) _allFlags[idx].status = newStatus;
      showToast('Status updated to ' + newStatus);
      renderTable(_allFlags);
    } else { showToast('Failed to update status.', true); }
  } catch(e) { showToast('Network error.', true); }
}

// ══════════════════════════════════════════════════════════════════
// MODAL HELPERS
// ══════════════════════════════════════════════════════════════════

function openModal(id) {
  var el = document.getElementById(id);
  if (!el) return;
  el.classList.add('open');   // triggers opacity:1 + pointer-events:all in flags.css
  el.style.display = 'flex'; // handles modals that start with inline display:none
  document.body.style.overflow = 'hidden';
}

function closeModal(id) {
  var el = document.getElementById(id);
  if (el) {
    el.classList.remove('open');
    el.style.display = 'none';
    document.body.style.overflow = '';
  }
  if (id === 'modal-flag') _activeFlag = null;
}

document.addEventListener('click', function(e) {
  if (e.target.classList && e.target.classList.contains('overlay')) closeModal(e.target.id);
});

// ══════════════════════════════════════════════════════════════════
// TAB SWITCHING
// ══════════════════════════════════════════════════════════════════

function switchMainTab(tab, btn) {
  document.querySelectorAll('.tab-btn').forEach(function(b){ b.classList.remove('active'); });
  document.querySelectorAll('.tab-content').forEach(function(c){ c.classList.remove('active'); });
  if (btn) btn.classList.add('active');
  var el = document.getElementById('tab-' + tab);
  if (el) el.classList.add('active');
}

// ══════════════════════════════════════════════════════════════════
// RESIDENT CONTACT MODAL
// ══════════════════════════════════════════════════════════════════

var _contactResidentId = null, _contactResidentName = '';

function openResidentContact(residentId, residentName) {
  _contactResidentId   = residentId;
  _contactResidentName = residentName;
  var el = document.getElementById('mc-name');
  if (el) el.textContent = residentName || 'Resident';
  openModal('modal-contact');
}

function contactAction(type) {
  closeModal('modal-contact');
  var name = _contactResidentName;
  var residentId = _contactResidentId;

  if (type === 'message') {
    sessionStorage.setItem('open_resident_name', name);
    window.location.href = '/pages/message.html';

  } else if (type === 'call' || type === 'video') {
    _startDirectCall(residentId, name, type === 'video' ? 'video' : 'audio');

  } else if (type === 'flag') {
    showToast('Welfare check raised for ' + name + '. On-duty staff notified.');
  }
}

async function _startDirectCall(residentId, residentName, kind) {
  var token = sessionStorage.getItem('access_token') || sessionStorage.getItem('spherecare_token') || '';
  var h = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token };
  var api = window._FLAGS_API || '/api/v1';

  showToast((kind === 'video' ? '📹' : '📞') + ' Calling ' + residentName + '…');

  try {
    // Resolve callee_user_id from resident
    var calleeUserId = null;
    if (residentId) {
      var rr = await fetch(api + '/residents/' + residentId, { headers: h });
      if (rr.ok) {
        var resident = await rr.json();
        calleeUserId = resident.client_user_id || null;
      }
    }
    if (!calleeUserId && residentName) {
      var rs = await fetch(api + '/residents/?search=' + encodeURIComponent(residentName), { headers: h });
      if (rs.ok) {
        var list = await rs.json();
        var match = list.find(function(r){ return (r.full_name||'') === residentName; });
        if (match) calleeUserId = match.client_user_id || null;
      }
    }
    if (!calleeUserId) {
      showToast('Cannot call: resident has no linked mobile account', true);
      return;
    }

    // POST directly to call API — no redirect needed
    var cr = await fetch(api + '/calls', {
      method: 'POST', headers: h,
      body: JSON.stringify({ callee_user_id: calleeUserId, kind: kind })
    });
    if (cr.ok) {
      showToast('✅ Call started — waiting for ' + residentName + ' to answer');
    } else {
      var err = await cr.json().catch(function(){ return {}; });
      showToast(err.detail || 'Failed to start call', true);
    }
  } catch(e) {
    showToast('Network error starting call', true);
  }
}

// ══════════════════════════════════════════════════════════════════
// REVIEW WORKFLOW
// ══════════════════════════════════════════════════════════════════

var REVIEW_LABELS = {
  confirm:     { label: 'Confirmed',        color: '#2563eb', bg: '#eff6ff' },
  false_alarm: { label: 'False Alarm',      color: '#6b7280', bg: '#f3f4f6' },
  escalate:    { label: 'Escalated',        color: '#dc2626', bg: '#fef2f2' },
  resolve:     { label: 'Resolved',         color: '#16a34a', bg: '#f0fdf4' },
  reopen:      { label: 'Reopened',         color: '#d97706', bg: '#fffbeb' },
};

var STATUS_LABELS = {
  new:         { label: 'New',              color: '#6366f1', bg: '#ede9fe' },
  in_review:   { label: 'In Review',        color: '#2563eb', bg: '#dbeafe' },
  confirmed:   { label: 'Confirmed',        color: '#0891b2', bg: '#cffafe' },
  escalated:   { label: 'Escalated',        color: '#dc2626', bg: '#fee2e2' },
  resolved:    { label: 'Resolved',         color: '#16a34a', bg: '#dcfce7' },
  false_alarm: { label: 'False Alarm',      color: '#6b7280', bg: '#f3f4f6' },
  // legacy
  Open:            { label: 'Open',         color: '#6366f1', bg: '#ede9fe' },
  'Pending Review':{ label: 'Pending',      color: '#d97706', bg: '#fef3c7' },
  Resolved:        { label: 'Resolved',     color: '#16a34a', bg: '#dcfce7' },
  Escalated:       { label: 'Escalated',    color: '#dc2626', bg: '#fee2e2' },
};

function renderStatusPill(status) {
  var cfg = STATUS_LABELS[status] || { label: status, color: '#64748b', bg: '#f1f5f9' };
  return '<span style="display:inline-block;padding:2px 9px;border-radius:20px;font-size:11.5px;font-weight:700;background:' + cfg.bg + ';color:' + cfg.color + ';">' + cfg.label + '</span>';
}

function renderReviewHistory(reviews) {
  var el = document.getElementById('fm-review-history');
  if (!el || !reviews || !reviews.length) return;
  el.innerHTML = '<div style="font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px;">Review History</div>' +
    reviews.map(function(r) {
      var cfg = REVIEW_LABELS[r.review_action] || { label: r.review_action, color: '#64748b', bg: '#f1f5f9' };
      return '<div style="display:flex;gap:10px;padding:8px 10px;border-radius:8px;background:#f8fafc;margin-bottom:6px;">' +
        '<div style="flex-shrink:0;width:8px;height:8px;border-radius:50%;background:' + cfg.color + ';margin-top:5px;"></div>' +
        '<div style="flex:1;">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2px;">' +
            '<span style="font-size:12.5px;font-weight:700;color:' + cfg.color + ';">' + esc(cfg.label) + '</span>' +
            '<span style="font-size:11px;color:#94a3b8;">' + esc(r.reviewed_at||'') + '</span>' +
          '</div>' +
          '<div style="font-size:12px;color:#64748b;">' + esc(r.reviewer_name) + (r.reviewer_role ? ' · ' + esc(r.reviewer_role) : '') + '</div>' +
          (r.notes ? '<div style="font-size:12px;color:#475569;margin-top:3px;font-style:italic;">"' + esc(r.notes) + '"</div>' : '') +
          '<div style="margin-top:3px;font-size:11px;color:#94a3b8;">' + esc(r.previous_status||'') + ' → ' + esc(r.new_status||'') + '</div>' +
        '</div>' +
      '</div>';
    }).join('');
}

async function submitReview(action) {
  if (!_activeFlag) return;
  var notes = (document.getElementById('fm-review-notes') || {}).value || '';
  var user  = {};
  try { user = JSON.parse(sessionStorage.getItem('user')||'{}'); } catch(e) {}
  var reviewerName = user.full_name || 'Staff';
  var reviewerRole = user.role || null;

  var actionLabels = { confirm:'Confirm', false_alarm:'False Alarm', escalate:'Escalate', resolve:'Resolve', reopen:'Reopen' };
  if (!confirm('Submit review: ' + (actionLabels[action]||action) + (notes ? ' · "' + notes + '"' : '') + '?')) return;

  try {
    var r = await fetch(window._FLAGS_API + '/flags/' + _activeFlag.id + '/review', {
      method: 'POST', headers: authH(),
      body: JSON.stringify({
        review_action:    action,
        reviewer_name:    reviewerName,
        reviewer_role:    reviewerRole,
        reviewer_user_id: user.id || user.user_id || null,
        notes:            notes || null,
      })
    });

    if (r.ok) {
      var review = await r.json();
      // Update local flag status
      var cfg = REVIEW_LABELS[action] || {};
      showToast('✅ ' + (cfg.label||action) + ' — flag updated');

      // Clear notes
      var notesEl = document.getElementById('fm-review-notes');
      if (notesEl) notesEl.value = '';

      // Refresh flag from API to get updated status + history
      var fr = await fetch(window._FLAGS_API + '/flags/' + _activeFlag.id, { headers: authH() });
      if (fr.ok) {
        _activeFlag = await fr.json();
        // Update status pill in modal header
        var sourceEl = document.getElementById('fm-source');
        // Update review history
        renderReviewHistory(_activeFlag.reviews || []);
        // Update in local table cache
        var idx = _allFlags.findIndex(function(f){ return f.id === _activeFlag.id; });
        if (idx >= 0) _allFlags[idx] = _activeFlag;
        renderTable(_allFlags);
        // Reload stats
        loadStats();
      }
    } else {
      var err = await r.json().catch(function(){ return {}; });
      showToast(err.detail || 'Failed to submit review', true);
    }
  } catch(e) {
    showToast('Network error', true);
  }
}

// ══════════════════════════════════════════════════════════════════
// TOAST
// ══════════════════════════════════════════════════════════════════

function showToast(msg, isError) {
  var t = document.createElement('div');
  t.textContent = msg;
  t.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:99999;background:' +
    (isError ? '#ef4444' : '#22c55e') +
    ';color:#fff;padding:11px 18px;border-radius:10px;font-size:13px;font-weight:600;box-shadow:0 4px 16px rgba(0,0,0,0.18);';
  document.body.appendChild(t);
  setTimeout(function(){ t.style.opacity='0'; t.style.transition='opacity .4s'; setTimeout(function(){ t.remove(); }, 400); }, 2500);
}

// ══════════════════════════════════════════════════════════════════
// STYLES
// ══════════════════════════════════════════════════════════════════

(function injectStyles() {
  var s = document.createElement('style');
  s.textContent = `
    .flags-table { width:100%;border-collapse:collapse;font-family:'Inter',sans-serif; }
    .flags-table thead tr { background:#f8fafc;border-bottom:2px solid #e2e8f0; }
    .flags-table thead th { padding:10px 12px;font-size:11.5px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px; }
    .flags-table tbody tr:hover { background:#f8fafc; }
    .flags-table tbody tr { border-bottom:1px solid #f1f5f9; }

    .sev-pill { display:inline-flex;align-items:center;gap:4px;padding:3px 9px;border-radius:20px;font-size:11.5px;font-weight:700; }
    .sev-critical { background:#fee2e2;color:#991b1b; }
    .sev-high     { background:#fef3c7;color:#92400e; }
    .sev-medium   { background:#fef9c3;color:#854d0e; }
    .sev-low      { background:#dcfce7;color:#166534; }

    .status-open     { display:inline-block;padding:2px 9px;border-radius:20px;font-size:11.5px;font-weight:700;background:#ede9fe;color:#5b21b6; }
    .status-pending  { display:inline-block;padding:2px 9px;border-radius:20px;font-size:11.5px;font-weight:700;background:#fef3c7;color:#92400e; }
    .status-resolved { display:inline-block;padding:2px 9px;border-radius:20px;font-size:11.5px;font-weight:700;background:#dcfce7;color:#166534; }
    .status-escalated{ display:inline-block;padding:2px 9px;border-radius:20px;font-size:11.5px;font-weight:700;background:#fee2e2;color:#991b1b; }

    .view-btn { background:#fff;border:1.5px solid #e2e8f0;border-radius:7px;padding:4px 12px;font-size:12px;font-weight:600;cursor:pointer;color:#334155;transition:all .15s;display:inline-flex;align-items:center;gap:5px; }
    .view-btn:hover { background:#f1f5f9;border-color:#6366f1;color:#6366f1; }

    #modal-flag .modal { background:#fff;border-radius:16px;width:520px;max-width:95vw;max-height:88vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,0.2);font-family:'Inter',sans-serif; }
    #modal-flag .mhdr { display:flex;justify-content:space-between;align-items:flex-start;padding:18px 20px 12px;border-bottom:1px solid #f1f5f9; }
    #modal-flag .mhdr h3 { font-size:16px;font-weight:800;color:#1e293b;margin:0 0 3px; }
    #modal-flag .mhdr .mclose { background:none;border:none;font-size:18px;cursor:pointer;color:#94a3b8;padding:0;line-height:1; }
    #modal-flag .mbody { padding:14px 20px 20px; }

    .flag-sev-box { display:flex;align-items:flex-start;gap:10px;padding:10px 13px;border-radius:10px;margin-bottom:14px; }
    .flag-sev-icon { font-size:20px;flex-shrink:0;margin-top:1px; }
    .flag-sev-text { font-size:12.5px;font-weight:700;color:#1e293b;margin-bottom:2px; }
    .flag-sev-desc { font-size:12px;color:#64748b;line-height:1.5; }
    .flag-sev-critical { background:#fff1f2;border-left:3px solid #ef4444; }
    .flag-sev-high     { background:#fffbeb;border-left:3px solid #f59e0b; }
    .flag-sev-medium   { background:#fefce8;border-left:3px solid #eab308; }
    .flag-sev-low      { background:#f0fdf4;border-left:3px solid #22c55e; }

    .fm-section { margin-top:14px; }
    .fm-section-title { font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;margin-bottom:7px; }
    .fm-meta { font-size:12px;color:#94a3b8;padding:5px 20px 0;display:flex;gap:10px; }
    .transcript-box { background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:9px 12px;font-size:12.5px;color:#334155;line-height:1.6;max-height:90px;overflow-y:auto; }
    .video-snap { position:relative;border-radius:10px;overflow:hidden;height:90px;cursor:pointer;margin-bottom:4px; }
    .video-snap-bg { position:absolute;inset:0;background:#0f172a; }
    .video-play-btn { position:absolute;inset:0;display:flex;align-items:center;justify-content:center; }
    .video-play-btn svg { width:28px;height:28px;fill:#fff;opacity:.8; }
    .video-jump { position:absolute;bottom:5px;right:7px;font-size:10px;color:rgba(255,255,255,.7);background:rgba(0,0,0,.4);padding:2px 6px;border-radius:5px; }
    .video-ctx { font-size:11px;color:#94a3b8;margin-bottom:10px; }
    .fm-status-row { display:flex;align-items:center;gap:8px;margin-top:7px; }
    .fm-status-row select { flex:1;padding:7px 10px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:12.5px;font-family:inherit;outline:none; }
    .fm-status-row button { padding:7px 14px;border-radius:8px;border:none;background:#1e293b;color:#fff;font-weight:700;font-size:12px;cursor:pointer; }
    .fm-comment-row { display:flex;gap:7px;margin-top:9px; }
    .fm-comment-row input { flex:1;padding:7px 11px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:12.5px;font-family:inherit;outline:none; }
    .fm-comment-row input:focus { border-color:#6366f1; }
    .fm-comment-row button { padding:7px 13px;border-radius:8px;border:none;background:#6366f1;color:#fff;font-weight:700;font-size:12px;cursor:pointer; }
    .rev-btn { padding:8px 6px;border-radius:8px;border:1.5px solid #e2e8f0;background:#fff;font-size:12px;font-weight:700;cursor:pointer;transition:all .15s; }
    .rev-confirm:hover  { background:#eff6ff;border-color:#2563eb;color:#2563eb; }
    .rev-false:hover    { background:#f3f4f6;border-color:#6b7280;color:#6b7280; }
    .rev-escalate:hover { background:#fef2f2;border-color:#dc2626;color:#dc2626; }
    .rev-resolve:hover  { background:#f0fdf4;border-color:#16a34a;color:#16a34a; }
  `;
  document.head.appendChild(s);
})();

// ══════════════════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', function() {
  var mbody = document.querySelector('#modal-flag .mbody');
  if (mbody) {
    var mhdr = document.querySelector('#modal-flag .mhdr');
    if (mhdr && !document.getElementById('fm-meta')) {
      var meta = document.createElement('div');
      meta.id = 'fm-meta';
      meta.style.cssText = 'font-size:12px;color:#94a3b8;padding:5px 20px 0;display:flex;gap:10px;';
      mhdr.after(meta);
    }
    if (!document.getElementById('fm-review-actions')) {
      var rs = document.createElement('div');
      rs.className = 'fm-section';
      rs.id = 'fm-review-actions';
      rs.innerHTML =
        '<div class="fm-section-title">Review Action</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-bottom:10px;">' +
          '<button onclick="submitReview(&quot;confirm&quot;)"    class="rev-btn rev-confirm">✅ Confirm</button>' +
          '<button onclick="submitReview(&quot;false_alarm&quot;)" class="rev-btn rev-false">🚫 False Alarm</button>' +
          '<button onclick="submitReview(&quot;escalate&quot;)"   class="rev-btn rev-escalate">🚨 Escalate</button>' +
          '<button onclick="submitReview(&quot;resolve&quot;)"    class="rev-btn rev-resolve">✔ Resolve</button>' +
        '</div>' +
        '<input id="fm-review-notes" type="text" placeholder="Optional notes for this review…" style="width:100%;padding:7px 11px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:12.5px;font-family:inherit;outline:none;"/>' +
        '<div id="fm-review-history" style="margin-top:12px;"></div>';
      mbody.appendChild(rs);
    }
    if (!document.getElementById('fm-comments')) {
      var cs = document.createElement('div');
      cs.className = 'fm-section';
      cs.innerHTML = '<div class="fm-section-title">Staff Comments</div>' +
        '<div id="fm-comments"></div>' +
        '<div class="fm-comment-row"><input id="fm-comment-input" type="text" placeholder="Add a comment…" onkeydown="if(event.key===\'Enter\') submitComment()"/>' +
        '<button onclick="submitComment()">Post</button></div>';
      mbody.appendChild(cs);
    }
  }
  loadStats();
  loadFlags();

  // ── Auto-refresh flags + stats ────────────────────────────────
  // Every 60 seconds: refresh stats counts (new flags come in frequently)
  setInterval(function() { loadStats(); }, 60 * 1000);

  // Every 24 hours: full reload of flags list + stats
  setInterval(function() { loadStats(); loadFlags(); }, 24 * 60 * 60 * 1000);

  // ── Live date & time ──────────────────────────────────────────
  function updateDateTime() {
    var now = new Date();
    var dateEl = document.getElementById('tb-date');
    var timeEl = document.getElementById('tb-time');
    if (dateEl) dateEl.textContent = now.toLocaleDateString('en-AU', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
    if (timeEl) timeEl.textContent = now.toLocaleTimeString('en-AU', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
  }
  updateDateTime();
  setInterval(updateDateTime, 1000);
});