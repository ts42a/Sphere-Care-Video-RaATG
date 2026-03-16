// ── DATA ──
let bookings = [];
const now = new Date();

async function loadBookings() {
  try {
    const res = await fetch(`${API_BASE}/bookings/`);
    if (!res.ok) throw new Error('Failed to fetch');
    const data = await res.json();
    // Normalise API fields to match our calendar format
    bookings = data.map(b => ({
      id:       b.id,
      date:     b.date,
      doctor:   b.doctor_name,
      resident: b.resident ? b.resident.full_name : `Resident #${b.resident_id}`,
      time:     b.time,
      type:     b.booking_type,
      status:   b.status
    }));
  } catch (e) {
    console.warn('Could not load bookings from API:', e);
    bookings = [];
  }
  renderCalendar();
}

// ── STATE ──
let currentYear  = now.getFullYear();
let currentMonth = now.getMonth();
let currentView  = 'month'; // 'month' | 'week'
// week anchor = Monday of the current week
function getMondayOf(d) {
  const day = d.getDay();
  const diff = (day === 0) ? -6 : 1 - day;
  const m = new Date(d);
  m.setDate(d.getDate() + diff);
  return m;
}
let weekStart = getMondayOf(now); // Monday

function fmtDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
const todayStr = fmtDate(now);

// ── VIEW SWITCH ──
function setView(v) {
  currentView = v;
  document.getElementById('btn-month').classList.toggle('active', v==='month');
  document.getElementById('btn-week').classList.toggle('active', v==='week');
  // show/hide grids
  const monthWrap = document.querySelector('.cal-grid-wrap');
  const weekWrap  = document.getElementById('cal-week-wrap');
  monthWrap.style.display = v === 'month' ? '' : 'none';
  weekWrap.style.display  = v === 'week'  ? 'flex' : 'none';
  renderCalendar();
}

function navPrev() { if (currentView==='month') changeMonth(-1); else changeWeek(-1); }
function navNext() { if (currentView==='month') changeMonth(1);  else changeWeek(1);  }

// ── RENDER DISPATCHER ──
function renderCalendar() {
  if (currentView === 'month') renderMonth();
  else renderWeek();
  updateStats();
  renderTodayAppts();
}

// ── MONTH VIEW ──
function renderMonth() {
  const months = ['January','February','March','April','May','June',
                  'July','August','September','October','November','December'];
  document.getElementById('cal-month-label').textContent = `${months[currentMonth]} ${currentYear}`;

  const grid = document.getElementById('cal-month-grid');
  grid.innerHTML = '';

  const firstDay  = new Date(currentYear, currentMonth, 1);
  let startDow = firstDay.getDay();
  startDow = (startDow === 0) ? 6 : startDow - 1;

  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
  const daysInPrev  = new Date(currentYear, currentMonth, 0).getDate();
  const totalCells  = Math.ceil((startDow + daysInMonth) / 7) * 7;

  for (let i = 0; i < totalCells; i++) {
    const cell = document.createElement('div');
    cell.className = 'cal-cell';

    let cellDate, isOther = false;
    if (i < startDow) {
      cellDate = new Date(currentYear, currentMonth - 1, daysInPrev - startDow + i + 1);
      isOther = true;
    } else if (i >= startDow + daysInMonth) {
      cellDate = new Date(currentYear, currentMonth + 1, i - startDow - daysInMonth + 1);
      isOther = true;
    } else {
      cellDate = new Date(currentYear, currentMonth, i - startDow + 1);
    }

    if (isOther) cell.classList.add('other-month');
    const dateStr = fmtDate(cellDate);
    if (dateStr === todayStr) cell.classList.add('today');

    const dayNum = document.createElement('div');
    dayNum.className = 'cal-day-num';
    dayNum.textContent = cellDate.getDate();
    cell.appendChild(dayNum);

    const dayBookings = bookings.filter(b => b.date === dateStr);
    const maxShow = 2;
    dayBookings.slice(0, maxShow).forEach(b => {
      const ev = document.createElement('div');
      ev.className = `cal-event ${b.status}`;
      ev.textContent = `${b.time.replace(' AM','a').replace(' PM','p')} ${b.doctor.split(' ')[2] || b.doctor.split(' ')[1]}`;
      ev.onclick = (e) => { e.stopPropagation(); openModal(b); };
      cell.appendChild(ev);
    });
    if (dayBookings.length > maxShow) {
      const more = document.createElement('div');
      more.className = 'cal-more';
      more.textContent = `+${dayBookings.length - maxShow} more`;
      more.onclick = (e) => { e.stopPropagation(); showDayModal(dateStr, dayBookings); };
      cell.appendChild(more);
    }
    grid.appendChild(cell);
  }
}

// ── WEEK VIEW ──
const HOURS = [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23];
const DOWS  = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
const HOUR_H = 52; // px per hour

function timeToMinutes(t) {
  // "10:00 AM" / "02:30 PM"
  const [hm, ampm] = t.split(' ');
  let [h, m] = hm.split(':').map(Number);
  if (ampm === 'PM' && h !== 12) h += 12;
  if (ampm === 'AM' && h === 12) h = 0;
  return h * 60 + m;
}

function renderWeek() {
  // Label
  const ws = weekStart;
  const we = new Date(ws); we.setDate(ws.getDate() + 6);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  let label;
  if (ws.getMonth() === we.getMonth()) {
    label = `${ws.getDate()} – ${we.getDate()} ${months[ws.getMonth()]} ${ws.getFullYear()}`;
  } else {
    label = `${ws.getDate()} ${months[ws.getMonth()]} – ${we.getDate()} ${months[we.getMonth()]} ${ws.getFullYear()}`;
  }
  document.getElementById('cal-month-label').textContent = label;

  // Header
  const header = document.getElementById('cal-week-header');
  header.innerHTML = '<div class="cal-week-header-time"></div>';
  for (let d = 0; d < 7; d++) {
    const day = new Date(ws); day.setDate(ws.getDate() + d);
    const ds = fmtDate(day);
    const isToday = ds === todayStr;
    const div = document.createElement('div');
    div.className = 'cal-week-day-head' + (isToday ? ' today-col' : '');
    div.innerHTML = `<div class="dow">${DOWS[d]}</div><div class="day-n">${day.getDate()}</div>`;
    header.appendChild(div);
  }

  // Body
  const body = document.getElementById('cal-week-body');
  body.innerHTML = '';

  // Time column
  const timesCol = document.createElement('div');
  timesCol.className = 'cal-week-times';
  HOURS.forEach(h => {
    const slot = document.createElement('div');
    slot.className = 'cal-week-time-slot';
    slot.textContent = h === 0 ? '' : (h < 12 ? `${h}:00 AM` : h === 12 ? '12:00 PM' : `${h-12}:00 PM`);
    timesCol.appendChild(slot);
  });
  body.appendChild(timesCol);

  // Day columns
  for (let d = 0; d < 7; d++) {
    const day = new Date(ws); day.setDate(ws.getDate() + d);
    const ds  = fmtDate(day);
    const isToday = ds === todayStr;

    const col = document.createElement('div');
    col.className = 'cal-week-col' + (isToday ? ' today-col' : '');

    // Hour lines
    HOURS.forEach((h, i) => {
      const line = document.createElement('div');
      line.className = 'cal-week-hour-line';
      line.style.top = `${i * HOUR_H}px`;
      col.appendChild(line);
    });

    // Events
    const dayBookings = bookings.filter(b => b.date === ds);
    dayBookings.forEach(b => {
      const mins  = timeToMinutes(b.time);
      const topPx = (mins / 60) * HOUR_H;
      const ev = document.createElement('div');
      ev.className = `cal-week-event ${b.status}`;
      ev.style.top    = `${topPx}px`;
      ev.style.height = `${HOUR_H - 4}px`;
      ev.innerHTML = `<div>${b.time}</div><div style="opacity:.8">${b.doctor.replace('Dr. ','')}</div>`;
      ev.onclick = () => openModal(b);
      col.appendChild(ev);
    });

    body.appendChild(col);
  }
}

function updateStats() {
  const todayBookings = bookings.filter(b => b.date === todayStr);
  document.getElementById('stat-today').textContent     = todayBookings.length;
  document.getElementById('stat-cancelled').textContent = bookings.filter(b=>b.status==='requested').length;
  document.getElementById('stat-pending').textContent   = bookings.filter(b=>b.status==='ongoing').length;
}

function renderTodayAppts() {
  const todayBookings = bookings.filter(b => b.date === todayStr);
  const list = document.getElementById('appt-list');
  list.innerHTML = '';

  if (!todayBookings.length) {
    list.innerHTML = '<div style="text-align:center;color:#9aa0ac;font-size:13px;padding:24px 0;">No appointments today</div>';
    return;
  }

  todayBookings.forEach(b => {
    const card = document.createElement('div');
    card.className = 'appt-card';
    card.innerHTML = `
      <div class="appt-doctor">${b.doctor}</div>
      <div class="appt-time">${b.time} – ${b.type} with ${b.resident}</div>
      <span class="appt-badge legend-tag ${b.status}">${b.status.charAt(0).toUpperCase()+b.status.slice(1)}</span>
    `;
    card.onclick = () => openModal(b);
    list.appendChild(card);
  });
}

function changeMonth(dir) {
  currentMonth += dir;
  if (currentMonth < 0)  { currentMonth = 11; currentYear--; }
  if (currentMonth > 11) { currentMonth = 0;  currentYear++; }
  renderCalendar();
}

function changeWeek(dir) {
  weekStart = new Date(weekStart);
  weekStart.setDate(weekStart.getDate() + dir * 7);
  renderCalendar();
}

function goToday() {
  currentYear  = now.getFullYear();
  currentMonth = now.getMonth();
  weekStart    = getMondayOf(now);
  renderCalendar();
}

function openModal(b) {
  document.getElementById('modal-title').textContent = b.type;
  document.getElementById('modal-body').innerHTML = `
    <div class="modal-row"><span>Doctor</span><span>${b.doctor}</span></div>
    <div class="modal-row"><span>Resident</span><span>${b.resident}</span></div>
    <div class="modal-row"><span>Date</span><span>${b.date}</span></div>
    <div class="modal-row"><span>Time</span><span>${b.time}</span></div>
    <div class="modal-row"><span>Status</span><span class="appt-badge legend-tag ${b.status}">${b.status.charAt(0).toUpperCase()+b.status.slice(1)}</span></div>
  `;
  document.getElementById('modal-overlay').classList.add('open');
}

function showDayModal(dateStr, dayBookings) {
  document.getElementById('modal-title').textContent = `Bookings – ${dateStr}`;
  document.getElementById('modal-body').innerHTML = dayBookings.map(b => `
    <div style="border:1px solid #e8edf4;border-radius:8px;padding:8px 10px;margin-bottom:8px;">
      <div style="font-size:12.5px;font-weight:800;">${b.doctor}</div>
      <div style="font-size:11.5px;color:#6b7280;">${b.time} · ${b.type}</div>
      <span class="appt-badge legend-tag ${b.status}" style="margin-top:4px;display:inline-block;">${b.status}</span>
    </div>
  `).join('');
  document.getElementById('modal-overlay').classList.add('open');
}

function closeModal(e) {
  if (e.target === document.getElementById('modal-overlay')) {
    document.getElementById('modal-overlay').classList.remove('open');
  }
}

// ── INIT ──
document.addEventListener('DOMContentLoaded', () => {
  // Topbar date
  const d = new Date();
  document.getElementById('topbar-date').textContent = d.toLocaleDateString('en-AU', {
    weekday:'long', day:'numeric', month:'long', year:'numeric'
  });

  // Avatar initials from localStorage (matches script.js pattern)
  try {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    const name = user.full_name || 'Sphere Care';
    const initials = name.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2);
    document.getElementById('user-avatar').textContent = initials;
  } catch(e) {}

  loadBookings();
});