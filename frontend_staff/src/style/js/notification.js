const now = new Date();
let allNotifs = [];
let activeTab = 'all';
let searchQ   = '';

// ── TOPBAR CLOCK ──
function updateClock() {
  const d = now;
  document.getElementById('topbar-date').textContent = d.toLocaleDateString('en-AU', {
    month: 'short', day: 'numeric', year: 'numeric'
  });
  const live = new Date();
  document.getElementById('topbar-time').textContent = live.toLocaleTimeString('en-AU', {
    hour: 'numeric', minute: '2-digit', hour12: true
  }).toUpperCase();
}
updateClock();
setInterval(() => {
  document.getElementById('topbar-time').textContent =
    new Date().toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', hour12: true }).toUpperCase();
}, 30000);

// ── DATE HELPERS ──
function fmtDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function getMondayOf(d) {
  const day = d.getDay();
  const diff = (day === 0) ? -6 : 1 - day;
  const m = new Date(d);
  m.setDate(d.getDate() + diff);
  return m;
}
function getSundayOf(d) {
  const mon = getMondayOf(d);
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  return sun;
}

const weekMon = getMondayOf(now);
const weekSun = getSundayOf(now);
const weekDates = [];
for (let i = 0; i < 7; i++) {
  const d = new Date(weekMon);
  d.setDate(weekMon.getDate() + i);
  weekDates.push(fmtDate(d));
}

// ── TIME AGO ──
function timeAgo(dateStr, timeStr) {
  // dateStr = "YYYY-MM-DD", timeStr = "10:00 AM"
  try {
    const dt = new Date(`${dateStr} ${timeStr}`);
    const diffMs = now - dt;
    const diffMins = Math.round(diffMs / 60000);
    if (diffMins < 0)    return timeStr;
    if (diffMins < 60)   return `${diffMins} mins ago`;
    const hrs = Math.round(diffMins / 60);
    if (hrs < 24)        return `${hrs} hour${hrs>1?'s':''} ago`;
    return `${Math.round(hrs/24)} days ago`;
  } catch { return timeStr; }
}

// ── LOAD DATA ──
async function loadData() {
  try {
    // Load bookings
    const res = await fetch(`${API_BASE}/bookings/`);
    const bookings = await res.json();

    // Filter to this week only
    const weekBookings = bookings.filter(b => weekDates.includes(b.date));

    // Convert to notification cards
    allNotifs = weekBookings.map(b => {
      const resName = b.resident ? b.resident.full_name : `Resident #${b.resident_id}`;
      const isToday = fmtDate(now) === b.date;
      const isSoon  = isToday; // could calculate time diff for "in X min"

      // Build a natural title
      let title = `${b.booking_type} – ${resName}`;
      let desc  = `${b.doctor_name} · ${b.date} at ${b.time}`;
      let iconType = 'appt';
      let type = 'appt';

      if (b.booking_type.toLowerCase().includes('medication')) {
        iconType = 'meds';
        title = `Medication: ${b.booking_type}`;
        desc  = `${resName}'s ${b.booking_type.toLowerCase()} requires attention. ${b.doctor_name} · ${b.time}`;
      }

      return {
        id:       b.id,
        title,
        desc,
        time:     timeAgo(b.date, b.time),
        rawTime:  b.time,
        date:     b.date,
        iconType,
        type,
        status:   b.status,
        unread:   b.status !== 'completed',
        booking:  b,
      };
    });

    // Sort: today first, then by date
    allNotifs.sort((a, b) => {
      if (a.date === fmtDate(now) && b.date !== fmtDate(now)) return -1;
      if (b.date === fmtDate(now) && a.date !== fmtDate(now)) return  1;
      return a.date.localeCompare(b.date) || a.rawTime.localeCompare(b.rawTime);
    });

    renderNotifs();
    loadPriorityAlerts();
  } catch(e) {
    console.warn('API error:', e);
    document.getElementById('notif-list').innerHTML =
      '<div class="empty-state">Could not load notifications.<br>Make sure the API server is running.</div>';
  }
}

// ── PRIORITY ALERTS (static demo data) ──
function loadPriorityAlerts() {
  renderPriority([
    { alert_type: 'warning',  title: 'Pain Mentioned Detected',
      description: 'Mrs Lee reported back pain during session #AO123. Confidence: 82%',
      created_at: new Date(now - 5*60000).toISOString() },
    { alert_type: 'critical', title: 'Possible Fall Flagged',
      description: 'Mr Chen exhibited unsteady gait pattern in corridor camera feed. Review recommended.',
      created_at: new Date(now - 12*60000).toISOString() },
  ]);
}

function renderPriority(alerts) {
  const el = document.getElementById('priority-list');
  if (!alerts.length) {
    el.innerHTML = '<div class="empty-state" style="padding:14px;">No priority alerts</div>';
    return;
  }
  el.innerHTML = alerts.slice(0, 4).map(a => {
    const isCrit = a.alert_type === 'critical';
    const ago = a.created_at ? timeAgoFromISO(a.created_at) : '';
    const iconSvg = isCrit
      ? `<svg class="priority-icon" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`
      : `<svg class="priority-icon" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
    return `
      <div class="priority-item ${a.alert_type}">
        ${iconSvg}
        <div class="priority-text">
          <div class="priority-title">${a.title}</div>
          <div class="priority-body">${a.description}</div>
          ${ago ? `<div class="priority-time">${ago}</div>` : ''}
        </div>
      </div>`;
  }).join('');
}

function timeAgoFromISO(iso) {
  try {
    const dt = new Date(iso);
    const diffMins = Math.round((now - dt) / 60000);
    if (diffMins < 1)  return 'just now';
    if (diffMins < 60) return `${diffMins} mins ago`;
    return `${Math.round(diffMins/60)} hrs ago`;
  } catch { return ''; }
}

// ── RENDER NOTIFS ──
function iconSvg(type) {
  if (type === 'meds') return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/></svg>`;
  if (type === 'ai')   return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;
  // default appt
  return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`;
}

function renderNotifs() {
  const list = document.getElementById('notif-list');
  let filtered = allNotifs;

  if (activeTab !== 'all') {
    filtered = filtered.filter(n => n.type === activeTab);
  }
  if (searchQ) {
    const q = searchQ.toLowerCase();
    filtered = filtered.filter(n =>
      n.title.toLowerCase().includes(q) ||
      n.desc.toLowerCase().includes(q)
    );
  }

  if (!filtered.length) {
    list.innerHTML = '<div class="empty-state">No notifications this week.</div>';
    return;
  }

  list.innerHTML = filtered.map((n, i) => `
    <div class="notif-card ${n.unread ? 'unread' : ''}" style="animation-delay:${i*40}ms" id="notif-${n.id}">
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
    </div>
  `).join('');
}

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

function markRead(id) {
  const n = allNotifs.find(x => x.id === id);
  if (n) { n.unread = false; renderNotifs(); }
}

function viewBooking(id) {
  window.location.href = `bookings.html`;
}

// ── INIT ──
document.addEventListener('DOMContentLoaded', loadData);