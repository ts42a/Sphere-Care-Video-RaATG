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
    const res      = await fetch(`${API_BASE}/bookings/`);
    const bookings = await res.json();
    const weekBookings = bookings.filter(b => weekDates.includes(b.appointment_date));

    allNotifs = weekBookings.map(b => {
      const resName = b.resident ? b.resident.full_name : `Resident #${b.resident_id}`;
      let title='', desc='', iconType='appt', type='appt';
      if (b.booking_type.toLowerCase().includes('medication')) {
        iconType='meds';
        title=`Medication: ${b.booking_type}`;
        desc=`${resName}'s ${b.booking_type.toLowerCase()} requires attention. ${b.doctor_name} · ${b.start_time}`;
      } else {
        title=`${b.booking_type} – ${resName}`;
        desc=`${b.doctor_name} · ${b.appointment_date} at ${b.start_time}`;
      }
      return {
        id: b.id, title, desc,
        time: timeAgo(b.appointment_date, b.start_time),
        rawTime: b.start_time, date: b.appointment_date,
        iconType, type, status: b.status,
        unread: b.status !== 'completed',
        booking: b,
      };
    });

    allNotifs.sort((a,b) => {
      if(a.date===fmtDate(now)&&b.date!==fmtDate(now)) return -1;
      if(b.date===fmtDate(now)&&a.date!==fmtDate(now)) return 1;
      return a.date.localeCompare(b.date)||a.rawTime.localeCompare(b.rawTime);
    });

    renderNotifs();
    await loadPriorityAlerts();

    // ── Mark this page's badge as read ──────────────────────────
    // Notifications page covers "alerts" category
    if (typeof BadgeManager !== 'undefined') {
      BadgeManager.markPageRead('alerts');
    }

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
  if(type==='meds') return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/></svg>`;
  if(type==='ai')   return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;
  return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`;
}

function renderNotifs() {
  const list = document.getElementById('notif-list');
  let filtered = allNotifs;
  if(activeTab !== 'all') filtered = filtered.filter(n => n.type === activeTab);
  if(searchQ) {
    const q = searchQ.toLowerCase();
    filtered = filtered.filter(n => n.title.toLowerCase().includes(q) || n.desc.toLowerCase().includes(q));
  }
  if(!filtered.length) { list.innerHTML='<div class="empty-state">No notifications this week.</div>'; return; }
  list.innerHTML = filtered.map((n,i) => `
    <div class="notif-card ${n.unread?'unread':''}" style="animation-delay:${i*40}ms" id="notif-${n.id}">
      <div class="notif-icon ${n.iconType}">${iconSvg(n.iconType)}</div>
      <div class="notif-body">
        <div class="notif-top">
          <div class="notif-title">${n.title}</div>
          <div class="notif-time">${n.time}</div>
        </div>
        <div class="notif-desc">${n.desc}</div>
        <div class="notif-actions">
          <button class="btn-view" onclick="viewBooking(${n.id})">View Details</button>
          <button class="btn-read" onclick="markRead(${n.id})">Mark as read</button>
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
  const n = allNotifs.find(x => x.id === id);
  if (!n) return;
  n.unread = false;
  renderNotifs();

  // Persist to backend (best-effort)
  try {
    const token = sessionStorage.getItem('access_token') || '';
    const headers = { ...(token ? { Authorization: `Bearer ${token}` } : {}) };
    await fetch(`${API_BASE}/notifications/${id}/read`, { method: 'PATCH', headers });
  } catch (_) {}

  // Refresh badge counts
  if (typeof BadgeManager !== 'undefined') BadgeManager.refresh();
}

function viewBooking(id) {
  window.location.href = 'bookings.html';
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

      // ── flag events → refresh badge ───────────────────────────
      if (msg.type === 'flag_created' || msg.type === 'flag_resolved') {
        if (typeof BadgeManager !== 'undefined') BadgeManager.refresh();
      }
    };
  }

  connect();
})();