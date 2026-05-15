/**
 * notification.js  — updated
 *
 * Changes vs original:
 *  1. Handles `badge_update` WebSocket messages via BadgeManager
 *  2. Calls BadgeManager.markPageRead('alerts') on load (you're on the notif page)
 *  3. markRead() now PATCHes the backend so the badge stays accurate
 *  4. flag_created / flag_resolved events refresh badge
 *
 * Requires: badge_manager.js loaded BEFORE this file.
 */

const now = new Date();
let allNotifs = [];
let activeTab = 'all';
let searchQ   = '';

function updateClock() {
  document.getElementById('topbar-date').textContent = now.toLocaleDateString('en-AU', { month:'short', day:'numeric', year:'numeric' });
  document.getElementById('topbar-time').textContent = new Date().toLocaleTimeString('en-AU', { hour:'numeric', minute:'2-digit', hour12:true }).toUpperCase();
}
updateClock();
setInterval(() => {
  document.getElementById('topbar-time').textContent = new Date().toLocaleTimeString('en-AU', { hour:'numeric', minute:'2-digit', hour12:true }).toUpperCase();
}, 30000);

function fmtDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function getMondayOf(d) { const day=d.getDay(),diff=(day===0)?-6:1-day,m=new Date(d);m.setDate(d.getDate()+diff);return m; }
function getSundayOf(d) { const mon=getMondayOf(d),sun=new Date(mon);sun.setDate(mon.getDate()+6);return sun; }

const weekMon   = getMondayOf(now);
const weekDates = [];
for (let i = 0; i < 7; i++) { const d=new Date(weekMon);d.setDate(weekMon.getDate()+i);weekDates.push(fmtDate(d)); }

function timeAgo(dateStr, timeStr) {
  try {
    const dt=new Date(`${dateStr} ${timeStr}`), diffMs=now-dt, diffMins=Math.round(diffMs/60000);
    if(diffMins<0)  return timeStr;
    if(diffMins<60) return `${diffMins} mins ago`;
    const hrs=Math.round(diffMins/60);
    if(hrs<24) return `${hrs} hour${hrs>1?'s':''} ago`;
    return `${Math.round(hrs/24)} days ago`;
  } catch { return timeStr; }
}

// ── Data loading ──────────────────────────────────────────────────────────────

async function loadData() {
  try {
    const token = sessionStorage.getItem('access_token') || '';
    const headers = token ? { Authorization: `Bearer ${token}` } : {};

    // Load real notifications from backend (messages, calls, alerts, appointments)
    const [notifsRes, bookingsRes, flagsRes] = await Promise.all([
      fetch(`${API_BASE}/notifications/?limit=100`, { headers }),
      fetch(`${API_BASE}/bookings/`, { headers }),
      fetch(`${API_BASE}/flags/?limit=100`, { headers }),
    ]);

    allNotifs = [];

    // ── Backend notifications (messages, calls, alerts) ──
    if (notifsRes.ok) {
      const notifs = await notifsRes.json();
      notifs.forEach(n => {
        const cat = n.category || 'alert';
        let iconType = 'ai';
        if (cat === 'message')     iconType = 'message';
        else if (cat === 'call')   iconType = 'call';
        else if (cat === 'appointment') iconType = 'appt';

        allNotifs.push({
          id:       n.id,
          title:    n.title,
          desc:     n.body || '',
          time:     timeAgoFromISO(n.created_at),
          rawTime:  n.created_at,
          date:     (n.created_at || '').slice(0, 10),
          iconType,
          type:     cat === 'appointment' ? 'appt' : cat === 'alert' ? 'ai' : cat,
          status:   'active',
          unread:   !n.is_read,
          _notifId: n.id,
        });
      });
    }

    // ── This week's bookings ──
    if (bookingsRes.ok) {
      const bookings = await bookingsRes.json();
      const weekBookings = bookings.filter(b => weekDates.includes(b.appointment_date));
      weekBookings.forEach(b => {
        if (allNotifs.find(x => x._bookingId === b.id)) return;
        const resName = b.resident ? b.resident.full_name : `Resident #${b.resident_id}`;
        let title = '', desc = '', iconType = 'appt';
        if (b.booking_type.toLowerCase().includes('medication')) {
          iconType = 'meds';
          title = `Medication: ${b.booking_type}`;
          desc  = `${resName}'s ${b.booking_type.toLowerCase()} requires attention. ${b.doctor_name} · ${b.start_time}`;
        } else {
          title = `${b.booking_type} – ${resName}`;
          desc  = `${b.doctor_name} · ${b.appointment_date} at ${b.start_time}`;
        }
        allNotifs.push({
          id: b.id, title, desc,
          time: timeAgo(b.appointment_date, b.start_time),
          rawTime: b.start_time, date: b.appointment_date,
          iconType, type: 'appt', status: b.status,
          unread: b.status !== 'completed',
          booking: b, _bookingId: b.id,
        });
      });
    }

    // ── Unresolved AI flags ──
    if (flagsRes.ok) {
      const flags = await flagsRes.json();
      const DONE = new Set(['resolved', 'false_alarm']);
      flags.filter(f => !DONE.has(f.status)).forEach(f => {
        var fid = 'flag_' + f.id;
        if (allNotifs.find(x => x.id === fid)) return;
        var rawT = '';
        try { rawT = new Date(f.flagged_at).toISOString(); } catch (_) {}
        allNotifs.push({
          id: fid,
          title: f.event_type || 'AI Flag',
          desc: f.description || '',
          time: f.flagged_at || '',
          rawTime: rawT || f.flagged_at || '',
          date: rawT ? rawT.slice(0, 10) : '',
          iconType: 'ai',
          type: 'ai',
          status: 'active',
          unread: true,
          _flagId: f.id,
          _flagSeverity: f.severity,
          _flagStatus: f.status,
          _flagResidentName: f.resident_name,
        });
      });
    }

    allNotifs.sort((a, b) => (b.rawTime || '').localeCompare(a.rawTime || ''));

    renderNotifs();
    await loadPriorityAlerts();

    if (typeof BadgeManager !== 'undefined') BadgeManager.markPageRead('alerts');

  } catch(e) {
    console.warn('API error:', e);
    document.getElementById('notif-list').innerHTML =
      '<div class="empty-state">Could not load notifications.<br>Make sure the API server is running.</div>';
  }
}

async function loadPriorityAlerts() {
  try {
    const token = sessionStorage.getItem('access_token') || '';
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    const res = await fetch(`${API_BASE}/notifications/priority?limit=5`, { headers });
    if (res.ok) {
      const alerts = await res.json();
      renderPriority(alerts.map(a => ({
        alert_type: a.is_priority ? 'critical' : 'warning',
        title: a.title,
        description: a.body,
        created_at: a.created_at,
      })));
      return;
    }
  } catch (_) {}

  // Fallback: static mock data
  renderPriority([
    { alert_type:'warning',  title:'Pain Mentioned Detected',  description:'Mrs Lee reported back pain during session #AO123. Confidence: 82%',            created_at:new Date(now-5*60000).toISOString() },
    { alert_type:'critical', title:'Possible Fall Flagged',    description:'Mr Chen exhibited unsteady gait pattern in corridor camera feed. Review recommended.', created_at:new Date(now-12*60000).toISOString() },
  ]);
}

// ── Rendering ─────────────────────────────────────────────────────────────────

function renderPriority(alerts) {
  const el = document.getElementById('priority-list');
  if (!alerts.length) { el.innerHTML='<div class="empty-state" style="padding:14px;">No priority alerts</div>'; return; }
  el.innerHTML = alerts.slice(0,4).map(a => {
    const isCrit = a.alert_type==='critical';
    const ago    = a.created_at ? timeAgoFromISO(a.created_at) : '';
    const stroke = isCrit ? '#ef4444' : '#f59e0b';
    const iconSvg = `<svg class="priority-icon" viewBox="0 0 24 24" fill="none" stroke="${stroke}" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
    return `
      <div class="priority-item ${a.alert_type}">
        ${iconSvg}
        <div class="priority-text">
          <div class="priority-title">${a.title}</div>
          <div class="priority-body">${a.description||a.body||a.message||''}</div>
          ${ago ? `<div class="priority-time">${ago}</div>` : ''}
        </div>
      </div>`;
  }).join('');
}

function timeAgoFromISO(iso) {
  try {
    const dt=new Date(iso), diffMins=Math.round((now-dt)/60000);
    if(diffMins<1) return 'just now';
    if(diffMins<60) return `${diffMins} mins ago`;
    return `${Math.round(diffMins/60)} hrs ago`;
  } catch { return ''; }
}

function iconSvg(type) {
  if(type==='meds')    return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/></svg>`;
  if(type==='ai')      return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;
  if(type==='message') return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;
  if(type==='call')    return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.42 19.42 0 0 1 4.43 9.68 19.79 19.79 0 0 1 1.36 1.05 2 2 0 0 1 3.33 3h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L7.3 10.68"/><line x1="23" y1="1" x2="17" y2="7"/><line x1="17" y1="1" x2="23" y2="7"/></svg>`;
  return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`;
}

function renderNotifs() {
  const list = document.getElementById('notif-list');
  let filtered = allNotifs.filter(n => n.unread); // only show unread
  if(activeTab !== 'all') filtered = filtered.filter(n => n.type === activeTab);
  if(searchQ) {
    const q = searchQ.toLowerCase();
    filtered = filtered.filter(n => n.title.toLowerCase().includes(q) || n.desc.toLowerCase().includes(q));
  }
  if(!filtered.length) { list.innerHTML='<div class="empty-state">No unread notifications.</div>'; return; }
  list.innerHTML = filtered.map((n,i) => `
    <div class="notif-card unread" style="animation-delay:${i*40}ms" id="notif-${n.id}">
      <div class="notif-icon ${n.iconType}">${iconSvg(n.iconType)}</div>
      <div class="notif-body">
        <div class="notif-top">
          <div class="notif-title">${n.title}</div>
          <div class="notif-time">${n.time}</div>
        </div>
        <div class="notif-desc">${n.desc}</div>
        <div class="notif-actions">
          <button class="btn-view" onclick="viewBooking('${n.id}')">View Details</button>
          <button class="btn-read" onclick="markRead('${n.id}')">Mark as read</button>
        </div>
      </div>
    </div>`).join('');
}

// ── Actions ───────────────────────────────────────────────────────────────────

function setTab(tab, el) {
  activeTab = tab;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  renderNotifs();
}

function filterNotifs() {
  searchQ = document.getElementById('search-input').value.trim();
  renderNotifs();
}

async function markRead(id) {
  const n = allNotifs.find(x => String(x.id) === String(id));
  if (!n || !n.unread) return;
  n.unread = false;
  renderNotifs();

  // Only PATCH backend if this is a real Notification row (has _notifId)
  const backendId = n._notifId ?? (n._bookingId ? null : n.id);
  if (backendId) {
    try {
      const token = sessionStorage.getItem('access_token') || '';
      const headers = { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
      await fetch(`${API_BASE}/notifications/${backendId}/read`, { method: 'PATCH', headers });
    } catch (_) {}
  }

  // Refresh badge counts
  if (typeof BadgeManager !== 'undefined') BadgeManager.refresh();
}

function viewBooking(id) {
  const n = allNotifs.find(x => String(x.id) === String(id));
  if (!n) return;

  // Flag entries → navigate to flags page instead of showing a modal
  if (n._flagId) {
    markRead(id);
    window.location.href = '/pages/flags.html';
    return;
  }

  const existing = document.getElementById('_notif_detail_modal');
  if (existing) existing.remove();

  let content = '';

  if (n.type === 'appt' && n.booking) {
    const b = n.booking;
    const resName = b.resident?.full_name || `Resident #${b.resident_id}`;
    const statusColor = b.status === 'completed' ? '#15803d' : b.status === 'cancelled' ? '#b91c1c' : '#1d4ed8';
    const statusBg    = b.status === 'completed' ? '#f0fdf4' : b.status === 'cancelled' ? '#fef2f2' : '#eff6ff';
    content = `
      <div style="display:flex;flex-direction:column;gap:14px;">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
          ${_detailRow('👤 Resident',  resName)}
          ${_detailRow('🏥 Type',       b.booking_type || '—')}
          ${_detailRow('👨‍⚕️ Doctor',   b.doctor_name || '—')}
          ${_detailRow('📅 Date',       b.appointment_date || '—')}
          ${_detailRow('🕐 Time',       b.start_time || '—')}
          ${_detailRow('📍 Location',   b.location || 'On-site')}
        </div>
        <div style="display:flex;align-items:center;gap:8px;padding:10px 14px;border-radius:10px;background:${statusBg};border:1px solid ${statusColor}22;">
          <span style="font-size:12px;font-weight:700;color:${statusColor};text-transform:capitalize;">Status: ${b.status || 'scheduled'}</span>
        </div>
        ${b.notes ? `<div style="padding:12px;background:#f8fafc;border-radius:10px;font-size:13px;color:#475569;line-height:1.6;">${_esc(b.notes)}</div>` : ''}
        <button onclick="window.location.href='/pages/booking.html'"
          style="width:100%;padding:10px;border-radius:10px;border:none;background:#0f172a;color:#fff;font-size:13px;font-weight:700;cursor:pointer;">
          Open in Bookings →
        </button>
      </div>`;

  } else if (n.type === 'message') {
    content = `
      <div style="display:flex;flex-direction:column;gap:12px;">
        <div style="padding:16px;background:#f0f9ff;border-radius:12px;border-left:4px solid #3b82f6;">
          <div style="font-size:13px;color:#1e40af;font-weight:700;margin-bottom:6px;">${_esc(n.title)}</div>
          <div style="font-size:13.5px;color:#1e293b;line-height:1.7;">${_esc(n.desc)}</div>
        </div>
        <div style="font-size:12px;color:#94a3b8;">🕐 ${_esc(n.time)}</div>
        <button onclick="window.location.href='/pages/messages.html'"
          style="width:100%;padding:10px;border-radius:10px;border:none;background:#0f172a;color:#fff;font-size:13px;font-weight:700;cursor:pointer;">
          Open in Messages →
        </button>
      </div>`;

  } else if (n.type === 'call') {
    content = `
      <div style="display:flex;flex-direction:column;gap:12px;">
        <div style="padding:16px;background:#fef2f2;border-radius:12px;border-left:4px solid #ef4444;">
          <div style="font-size:13px;color:#b91c1c;font-weight:700;margin-bottom:6px;">📵 Missed Call</div>
          <div style="font-size:13.5px;color:#1e293b;line-height:1.7;">${_esc(n.desc)}</div>
        </div>
        <div style="font-size:12px;color:#94a3b8;">🕐 ${_esc(n.time)}</div>
      </div>`;

  } else {
    // AI alert / generic
    content = `
      <div style="display:flex;flex-direction:column;gap:12px;">
        <div style="padding:16px;background:#fffbeb;border-radius:12px;border-left:4px solid #f59e0b;">
          <div style="font-size:13px;color:#92400e;font-weight:700;margin-bottom:6px;">⚠️ AI Alert</div>
          <div style="font-size:13.5px;color:#1e293b;line-height:1.7;">${_esc(n.desc)}</div>
        </div>
        <div style="font-size:12px;color:#94a3b8;">🕐 ${_esc(n.time)}</div>
      </div>`;
  }

  const modal = document.createElement('div');
  modal.id = '_notif_detail_modal';
  modal.style.cssText = `
    position:fixed;inset:0;z-index:999999;
    background:rgba(15,27,45,0.55);backdrop-filter:blur(3px);
    display:flex;align-items:center;justify-content:center;padding:20px;
  `;
  modal.innerHTML = `
    <div style="background:#fff;border-radius:18px;width:100%;max-width:480px;
      box-shadow:0 24px 60px rgba(0,0,0,0.2);overflow:hidden;">
      <div style="display:flex;align-items:center;justify-content:space-between;
        padding:20px 24px 0;">
        <div style="font-size:16px;font-weight:800;color:#0f172a;">${_esc(n.title)}</div>
        <button id="_notif_close"
          style="width:32px;height:32px;border-radius:8px;border:none;
            background:#f0f4f8;cursor:pointer;font-size:18px;color:#64748b;
            display:flex;align-items:center;justify-content:center;">✕</button>
      </div>
      <div style="padding:20px 24px 24px;">${content}</div>
    </div>
  `;
  document.body.appendChild(modal);

  document.getElementById('_notif_close').addEventListener('click', () => modal.remove());
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });

  // Also mark as read when viewing
  markRead(id);
}

function _esc(v) {
  return String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function _detailRow(label, value) {
  return `
    <div style="background:#f8fafc;border-radius:10px;padding:10px 12px;">
      <div style="font-size:10.5px;font-weight:700;color:#94a3b8;margin-bottom:3px;">${label}</div>
      <div style="font-size:13px;font-weight:600;color:#0f172a;">${_esc(value)}</div>
    </div>`;
}

document.addEventListener('DOMContentLoaded', loadData);

// ── WebSocket real-time layer ─────────────────────────────────────────────────
(function () {
  var proto = location.protocol === 'https:' ? 'wss' : 'ws', ws;

  function connect() {
    var token = sessionStorage.getItem('access_token') || '';
    ws = new WebSocket(proto + '://' + location.host + '/ws?token=' + encodeURIComponent(token));
    ws.onclose = function () { setTimeout(connect, 3000); };
    ws.onerror = function () {};
    ws.onmessage = function (e) {
      var msg;
      try { msg = JSON.parse(e.data); } catch (err) { return; }

      // ── badge_update → delegate to BadgeManager ──────────────
      if (msg.type === 'badge_update') {
        if (typeof BadgeManager !== 'undefined') BadgeManager.handleWsMessage(msg);
        return;
      }

      // ── ai_alert → Priority Alerts panel ─────────────────────
      if (msg.type === 'ai_alert') {
        var a = msg.alert, existing = document.getElementById('priority-list');
        if (existing) {
          var isCrit  = a.alert_type === 'critical';
          var stroke  = isCrit ? '#ef4444' : '#f59e0b';
          var iconStr = `<svg class="priority-icon" viewBox="0 0 24 24" fill="none" stroke="${stroke}" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
          var item = document.createElement('div');
          item.className = 'priority-item ' + (a.alert_type || 'warning');
          item.innerHTML = iconStr + `<div class="priority-text"><div class="priority-title">${a.title||''}</div><div class="priority-body">${a.description||a.body||a.message||''}</div><div class="priority-time">just now</div></div>`;
          existing.insertBefore(item, existing.firstChild);
        }
        allNotifs.unshift({ id: a.id||Date.now(), title: a.title||'AI Alert', desc: a.description||a.body||a.message||'', time:'just now', rawTime:'', date:fmtDate(new Date()), iconType:'ai', type:'ai', status:'active', unread:true });
        renderNotifs();
      }

      // ── booking_created ───────────────────────────────────────
      if (msg.type === 'booking_created') {
        var b = msg.booking;
        if (!weekDates.includes(b.appointment_date)) return;
        var resName = b.resident ? b.resident.full_name : ('Resident #' + b.resident_id);
        var newN = { id:b.id, title:b.booking_type+' – '+resName, desc:b.doctor_name+' · '+b.appointment_date+' at '+b.start_time, time:timeAgo(b.appointment_date,b.start_time), rawTime:b.start_time, date:b.appointment_date, iconType:'appt', type:'appt', status:b.status, unread:true, booking:b };
        if (!allNotifs.find(x => x.id === newN.id)) { allNotifs.unshift(newN); renderNotifs(); }
      }

      // ── booking_updated ───────────────────────────────────────
      if (msg.type === 'booking_updated') {
        var u = msg.booking, n = allNotifs.find(x => x.id === u.id);
        if (n) { n.status=u.status; n.unread=(u.status!=='completed'); renderNotifs(); }
      }

      // ── booking_deleted ───────────────────────────────────────
      if (msg.type === 'booking_deleted') {
        allNotifs = allNotifs.filter(x => x.id !== msg.booking_id);
        renderNotifs();
      }

      // ── message_received → show in notification list ──────────
      if (msg.type === 'message_received') {
        var m = msg.message || msg;
        var newN = {
          id: m.id || Date.now(),
          title: '💬 New Message' + (m.sender_name ? ' from ' + m.sender_name : ''),
          desc:  m.body || m.content || m.text || '',
          time:  'just now', rawTime: new Date().toISOString(),
          date:  fmtDate(new Date()),
          iconType: 'message', type: 'message',
          status: 'active', unread: true,
        };
        if (!allNotifs.find(x => x.id === newN.id)) {
          allNotifs.unshift(newN);
          renderNotifs();
        }
        if (typeof BadgeManager !== 'undefined') BadgeManager.refresh();
      }

      // ── missed_call → show in notification list ───────────────
      if (msg.type === 'missed_call' || msg.type === 'call_missed') {
        var c = msg.call || msg;
        var callN = {
          id: c.id || ('call_' + Date.now()),
          title: '📵 Missed Call' + (c.caller_name ? ' from ' + c.caller_name : ''),
          desc:  c.resident_name ? 'From ' + c.resident_name : 'Incoming call was not answered',
          time:  'just now', rawTime: new Date().toISOString(),
          date:  fmtDate(new Date()),
          iconType: 'call', type: 'call',
          status: 'missed', unread: true,
        };
        if (!allNotifs.find(x => x.id === callN.id)) {
          allNotifs.unshift(callN);
          renderNotifs();
        }
        if (typeof BadgeManager !== 'undefined') BadgeManager.refresh();
      }

      // ── flag_created → add to notification list ───────────────
      if (msg.type === 'flag_created') {
        var f = msg.flag || {};
        var fid = 'flag_' + (msg.flag_id || f.id);
        if (!allNotifs.find(x => x.id === fid)) {
          allNotifs.unshift({
            id: fid,
            title: f.event_type || 'AI Flag',
            desc: (f.description || '') + (f.resident_name ? ' — ' + f.resident_name : ''),
            time: 'just now',
            rawTime: new Date().toISOString(),
            date: fmtDate(new Date()),
            iconType: 'ai',
            type: 'ai',
            status: 'active',
            unread: true,
            _flagId: msg.flag_id || f.id,
          });
          renderNotifs();
        }
        if (typeof BadgeManager !== 'undefined') BadgeManager.refresh();
      }

      // ── flag_resolved → remove from notification list ─────────
      if (msg.type === 'flag_resolved') {
        var resolvedId = msg.flag_id;
        allNotifs = allNotifs.filter(x => x._flagId !== resolvedId);
        renderNotifs();
        if (typeof BadgeManager !== 'undefined') BadgeManager.refresh();
      }

      // ── flag_updated (non-terminal review) → badge refresh ────
      if (msg.type === 'flag_updated') {
        if (typeof BadgeManager !== 'undefined') BadgeManager.refresh();
      }
    };
  }

  connect();
})();