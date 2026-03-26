let staffData = [];
let editingId = null;
let viewingId = null;
/** When true, roster is view-only (staff users). */
let readOnlyMode = false;
/** Set when API returns an error message to show instead of the table body (e.g. pending approval). */
let staffListNotice = null;

function staffAuthHeaders() {
  const t = sessionStorage.getItem('access_token') || sessionStorage.getItem('spherecare_token');
  const h = { 'Content-Type': 'application/json' };
  if (t) h['Authorization'] = 'Bearer ' + t;
  return h;
}

function normalizeStaffApiRow(s) {
  const code = s.staff_code || s.staff_id;
  let shift_time = s.shift_time;
  if (!shift_time && (s.shift_start != null || s.shift_end != null)) {
    const a = s.shift_start != null ? String(s.shift_start).slice(0, 5) : '';
    const b = s.shift_end != null ? String(s.shift_end).slice(0, 5) : '';
    shift_time = a && b ? `${a} – ${b}` : (a || b || '—');
  }
  if (!shift_time) shift_time = '—';
  return {
    ...s,
    staff_id: code,
    shift_time,
    availability: s.availability || 'ready',
    location: s.location || '—',
    assigned_unit: s.assigned_unit || '—',
  };
}

function applyReadOnlyUi() {
  const banner = document.getElementById('staff-readonly-banner');
  const adminAct = document.getElementById('staff-admin-actions');
  const exp = document.getElementById('staff-export-btn');
  const viewEdit = document.getElementById('staff-view-edit-btn');
  if (banner) banner.style.display = readOnlyMode ? 'block' : 'none';
  if (adminAct) adminAct.style.display = readOnlyMode ? 'none' : '';
  if (exp) exp.style.display = readOnlyMode ? 'none' : '';
  if (viewEdit) viewEdit.style.display = readOnlyMode ? 'none' : '';
}

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

/** Portal role: same sources as login / OAuth / legacy spherecare_* keys. */
function resolvePortalRole() {
  try {
    const user = JSON.parse(sessionStorage.getItem('user') || '{}');
    const raw =
      user.role ||
      user.global_role ||
      sessionStorage.getItem('spherecare_role') ||
      '';
    return String(raw).toLowerCase().trim();
  } catch (_) {
    return '';
  }
}

const ADMIN_PORTAL_ROLES = new Set(['admin', 'super_admin', 'owner']);

// ── AUTH GUARD ──
// Admin: full management. Staff: same page, read-only roster for their center.
function checkAccess() {
  try {
    const token = sessionStorage.getItem('access_token') || sessionStorage.getItem('spherecare_token');
    const user = JSON.parse(sessionStorage.getItem('user') || '{}');
    if (!user.role && user.global_role) user.role = user.global_role;
    if (!user.role && sessionStorage.getItem('spherecare_role')) {
      user.role = sessionStorage.getItem('spherecare_role');
    }

    if (!token) {
      window.location.href = 'register-login.html';
      return false;
    }

    const role = resolvePortalRole();
    if (!role) {
      window.location.href = 'register-login.html';
      return false;
    }

    const denied = document.getElementById('access-denied');
    const panel = document.getElementById('staff-panel');
    const topbar = document.getElementById('topbar-right');
    const nameEl = document.getElementById('admin-name');
    const roleEl = document.getElementById('admin-role');

    if (denied) denied.style.display = 'none';
    if (panel) panel.style.display = 'block';
    if (topbar) topbar.style.display = '';

    if (ADMIN_PORTAL_ROLES.has(role)) {
      readOnlyMode = false;
      if (nameEl) nameEl.textContent = `Admin: ${user.full_name || 'Admin'}`;
      if (roleEl) roleEl.textContent = 'Facility Manager';
      applyReadOnlyUi();
      return true;
    }

    if (role === 'staff') {
      readOnlyMode = true;
      if (nameEl) nameEl.textContent = user.full_name || 'Staff';
      if (roleEl) roleEl.textContent = 'Staff (view only)';
      applyReadOnlyUi();
      return true;
    }

    if (denied) denied.style.display = 'flex';
    if (panel) panel.style.display = 'none';
    if (topbar) topbar.style.display = 'none';
    return false;
  } catch {
    window.location.href = 'register-login.html';
    return false;
  }
}

// ── TOPBAR CLOCK ──
function updateClock() {
  const d = new Date();
  document.getElementById('tb-date').textContent = d.toLocaleDateString('en-AU', {
    month: 'short', day: 'numeric', year: 'numeric'
  });
  document.getElementById('tb-time').textContent = d.toLocaleTimeString('en-AU', {
    hour: 'numeric', minute: '2-digit', hour12: true
  }).toUpperCase();
}
updateClock();
setInterval(updateClock, 30000);

// ── TABS ──
function switchTab(name, el) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('tab-' + name).classList.add('active');
}

// ── LOAD STAFF ──
async function loadStaff() {
  staffListNotice = null;
  try {
    const res = await fetch(`${API_BASE}/staff/`, { headers: staffAuthHeaders() });
    if (res.status === 403) {
      let msg = 'You cannot view the staff directory yet.';
      try {
        const j = await res.json();
        const d = j.detail;
        if (d && typeof d === 'object' && d.msg) msg = d.msg;
        else if (typeof d === 'string') msg = d;
      } catch (_) {}
      staffListNotice = msg;
      staffData = [];
    } else if (!res.ok) {
      throw new Error('staff list unavailable');
    } else {
      const raw = await res.json();
      staffData = Array.isArray(raw) ? raw.map(normalizeStaffApiRow) : [];
    }
  } catch {
    if (readOnlyMode) {
      staffData = [];
      staffListNotice =
        'Unable to load the team roster. Check your connection or ask your facility administrator.';
    } else {
      // Demo fallback for admins when API is down (local dev)
      staffData = [
        { staff_id: 'ST-4829', full_name: 'Sarah Johnson',  shift_time: '7:00 AM - 3:00 PM',  assigned_unit: 'ICU Ward',     status: 'active',   role: 'Senior Carer', availability: 'ready',    location: 'Nurses Station A' },
        { staff_id: 'ST-3746', full_name: 'Michael Chen',   shift_time: '3:00 PM - 11:00 PM', assigned_unit: 'Emergency',    status: 'on_leave', role: 'Nurse',        availability: 'busy',     location: 'Room 104' },
        { staff_id: 'ST-5920', full_name: 'Emma Rodriguez', shift_time: '11:00 PM - 7:00 AM', assigned_unit: 'General Ward', status: 'pending',  role: 'Carer',        availability: 'on_break', location: 'Break Room' },
        { staff_id: 'ST-1038', full_name: 'David Kim',      shift_time: '7:00 AM - 3:00 PM',  assigned_unit: 'Pediatrics',   status: 'active',   role: 'Doctor',       availability: 'busy',     location: 'Room 312' },
        { staff_id: 'ST-2241', full_name: 'Linda Pham',     shift_time: '7:00 AM - 3:00 PM',  assigned_unit: 'Geriatrics',   status: 'active',   role: 'Carer',        availability: 'ready',    location: 'Room 205' },
        { staff_id: 'ST-6610', full_name: 'James Carter',   shift_time: '3:00 PM - 11:00 PM', assigned_unit: 'Neurology',    status: 'active',   role: 'Nurse',        availability: 'on_break', location: 'Cafeteria' },
      ];
    }
  }
  renderTable();
  loadStats();
  hideSkeleton(); // Delete will trigger top of loading
}

async function loadStats() {
  const setStat = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };
  try {
    const res = await fetch(`${API_BASE}/staff/stats/summary`, { headers: staffAuthHeaders() });
    if (!res.ok) throw new Error();
    const s = await res.json();
    setStat('stat-active', s.active_staff);
    setStat('stat-pending', s.pending);
    setStat('stat-shifts', s.shifts_today);
    const onBreak =
      staffData.filter(x => x.availability === 'on_break').length;
    setStat('stat-break', onBreak);
  } catch {
    // Compute from local staffData
    const active = staffData.filter(s => s.status === 'active').length;
    const pending = staffData.filter(s => s.status === 'pending').length;
    const onBreak = staffData.filter(s => s.availability === 'on_break').length;
    setStat('stat-active', active);
    setStat('stat-pending', pending);
    setStat('stat-shifts', staffData.length);
    setStat('stat-break', onBreak);
  }
}

// ── RENDER TABLE ──
function renderTable() {
  const tbody = document.getElementById('staff-tbody');
  const countEl = document.getElementById('staff-count');
  if (staffListNotice) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:#64748b;padding:32px;line-height:1.5;">${escapeHtml(staffListNotice)}</td></tr>`;
    if (countEl) countEl.textContent = '';
    return;
  }
  if (!staffData.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#9aa0ac;padding:24px;">No staff found.</td></tr>';
    if (countEl) countEl.textContent = '0 staff members';
    return;
  }

  tbody.innerHTML = staffData.map(s => {
    const avail = s.availability || 'ready';
    const availClass = avail === 'ready' ? 'avail-ready' : avail === 'busy' ? 'avail-busy' : 'avail-break';
    const availLabel = avail === 'ready' ? 'Ready' : avail === 'busy' ? 'Busy' : 'On Break';
    const loc = s.location || '—';
    const sid = (s.staff_id || '').replace(/'/g, "\\'");
    const editBtn = readOnlyMode ? '' : `
          <button class="action-btn blue" title="Edit" onclick="editStaff('${sid}')">
            <svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>`;
    return `
      <tr>
        <td>
          <div class="staff-name">${s.full_name}</div>
          <div class="staff-id">ID: ${s.staff_id} · ${s.role || 'Staff'}</div>
        </td>
        <td>
          <div class="shift-main">${s.shift_time}</div>
          <div class="shift-hours">8 hours</div>
        </td>
        <td>${s.assigned_unit}</td>
        <td><span class="avail-badge ${availClass}">${availLabel}</span></td>
        <td><span class="loc-text">${loc}</span></td>
        <td class="actions-cell">
          <button class="action-btn green" title="Call" onclick="callStaff('${sid}')">
            <svg viewBox="0 0 24 24"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.362 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.338 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
          </button>
          <button class="action-btn" title="View details" onclick="viewStaff('${sid}')">
            <svg viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
          </button>${editBtn}
        </td>
      </tr>`;
  }).join('');

  if (countEl) countEl.textContent = `${staffData.length} staff member${staffData.length !== 1 ? 's' : ''}`;
}

// ── VIEW STAFF ──
function viewStaff(id) {
  const s = staffData.find(x => x.staff_id === id);
  if (!s) return;
  viewingId = id;
  const initials = s.full_name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  document.getElementById('view-avatar').textContent = initials;
  document.getElementById('view-name').textContent = s.full_name;
  document.getElementById('view-role').textContent = s.role || 'Staff';
  document.getElementById('view-id').textContent = s.staff_id;
  document.getElementById('view-shift').textContent = s.shift_time;
  document.getElementById('view-unit').textContent = s.assigned_unit;

  const statusLabel = s.status === 'active' ? 'Active' : s.status === 'on_leave' ? 'On Leave' : 'Pending';
  const statusClass = s.status === 'active' ? 'status-active' : s.status === 'on_leave' ? 'status-leave' : 'status-pending';
  document.getElementById('view-status').innerHTML = `<span class="status-badge ${statusClass}">${statusLabel}</span>`;

  const avail = s.availability || 'ready';
  const availLabel = avail === 'ready' ? 'Ready' : avail === 'busy' ? 'Busy' : 'On Break';
  const availClass = avail === 'ready' ? 'avail-ready' : avail === 'busy' ? 'avail-busy' : 'avail-break';
  document.getElementById('view-avail').innerHTML = `<span class="avail-badge ${availClass}">${availLabel}</span>`;

  document.getElementById('view-location').textContent = s.location || '—';
  document.getElementById('modal-view').classList.add('open');
}

function closeViewModal() {
  document.getElementById('modal-view').classList.remove('open');
  viewingId = null;
}

// ── CALL STAFF ──
function callStaff(id) {
  const s = staffData.find(x => x.staff_id === id);
  if (!s) return;
  // Navigate to the call page with the staff member pre-selected
  window.location.href = `call.html?staff=${encodeURIComponent(s.staff_id)}&name=${encodeURIComponent(s.full_name)}`;
}

// ── EDIT / DELETE ──
function editStaff(id) {
  if (readOnlyMode) {
    viewStaff(id);
    return;
  }
  const s = staffData.find(x => x.staff_id === id);
  if (!s) return;
  editingId = id;
  document.getElementById('edit-name').value  = s.full_name;
  document.getElementById('edit-id').value    = s.staff_id;
  document.getElementById('edit-shift').value = s.shift_time;
  document.getElementById('edit-unit').value  = s.assigned_unit;
  document.getElementById('edit-status').value = s.status;
  document.getElementById('edit-role').value  = s.role;
  document.getElementById('edit-availability').value = s.availability || 'ready';
  document.getElementById('edit-location').value = s.location || '';
  document.getElementById('modal-edit').classList.add('open');
}

function closeModal() {
  document.getElementById('modal-edit').classList.remove('open');
  editingId = null;
}

async function saveStaff() {
  if (readOnlyMode) return;
  if (!editingId) return;
  const updates = {
    shift_time:    document.getElementById('edit-shift').value,
    assigned_unit: document.getElementById('edit-unit').value,
    status:        document.getElementById('edit-status').value,
    role:          document.getElementById('edit-role').value,
    availability:  document.getElementById('edit-availability').value,
    location:      document.getElementById('edit-location').value,
  };
  try {
    const res = await fetch(`${API_BASE}/staff/${encodeURIComponent(editingId)}`, {
      method: 'PATCH',
      headers: staffAuthHeaders(),
      body: JSON.stringify(updates)
    });
    if (!res.ok) throw new Error();
    const updated = await res.json();
    const idx = staffData.findIndex(s => s.staff_id === editingId);
    if (idx >= 0) staffData[idx] = updated;
  } catch {
    // Update locally if API unavailable
    const idx = staffData.findIndex(s => s.staff_id === editingId);
    if (idx >= 0) Object.assign(staffData[idx], updates);
  }
  closeModal();
  renderTable();
  loadStats();
}

async function deleteStaff() {
  if (readOnlyMode) return;
  if (!editingId || !confirm(`Delete staff member ${editingId}?`)) return;
  try {
    await fetch(`${API_BASE}/staff/${encodeURIComponent(editingId)}`, {
      method: 'DELETE',
      headers: staffAuthHeaders()
    });
  } catch {}
  staffData = staffData.filter(s => s.staff_id !== editingId);
  closeModal();
  renderTable();
  loadStats();
}

// ── EXPORT PDF ──
function exportPDF() {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  doc.setFontSize(16);
  doc.text('Staff Activity Report – Sphere Care', 14, 18);
  doc.setFontSize(10);
  doc.setTextColor(120);
  doc.text(`Generated: ${new Date().toLocaleString('en-AU')}`, 14, 26);
  doc.autoTable({
    startY: 32,
    head: [['Staff Name', 'Staff ID', 'Shift Time', 'Assigned Unit', 'Status', 'Role']],
    body: staffData.map(s => [s.full_name, s.staff_id, s.shift_time, s.assigned_unit, s.status, s.role]),
    styles: { fontSize: 10 },
    headStyles: { fillColor: [46, 196, 182] }
  });
  doc.save('staff_report.pdf');
}

// ── ADD STAFF MODAL ──
function openAddModal() {
  if (readOnlyMode) return;
  document.getElementById('add-name').value = '';
  document.getElementById('add-role').selectedIndex = 0;
  document.getElementById('add-shift').selectedIndex = 0;
  document.getElementById('add-unit').selectedIndex = 0;
  document.getElementById('modal-add').classList.add('open');
}

function closeAddModal() {
  document.getElementById('modal-add').classList.remove('open');
}

async function submitAddStaff() {
  if (readOnlyMode) return;
  const full_name = document.getElementById('add-name').value.trim();
  if (!full_name) { alert('Please enter a full name.'); return; }

  const payload = {
    full_name,
    shift_time:    document.getElementById('add-shift').value,
    assigned_unit: document.getElementById('add-unit').value,
    role:          document.getElementById('add-role').value,
  };

  try {
    const q = new URLSearchParams({
      full_name: payload.full_name,
      assigned_unit: payload.assigned_unit,
      role: payload.role,
    });
    const res = await fetch(`${API_BASE}/admin/staff/create?${q}`, {
      method: 'POST',
      headers: staffAuthHeaders()
    });
    if (!res.ok) throw new Error();
    const created = await res.json();
    const code = created.staff_code || created.staff_id;
    staffData.push(normalizeStaffApiRow({
      staff_code: code,
      full_name: created.full_name || payload.full_name,
      shift_time: payload.shift_time,
      assigned_unit: created.assigned_unit || payload.assigned_unit,
      status: 'active',
      role: created.role || payload.role
    }));
  } catch {
    // Fallback: add locally with generated ID
    const ts = Date.now().toString().slice(-4);
    const rnd = Math.floor(1000 + Math.random() * 9000);
    staffData.push({
      staff_id:      `ST-${ts}-${rnd}`,
      full_name:     payload.full_name,
      shift_time:    payload.shift_time,
      assigned_unit: payload.assigned_unit,
      status:        'active',
      role:          payload.role
    });
  }
  closeAddModal();
  renderTable();
  loadStats();
}

// ── INIT ──
document.addEventListener('DOMContentLoaded', () => {
  if (checkAccess()) loadStaff();
});

// Hide Bootstrap skeleton once page content is ready (Option)
(function() {
  var sk = document.getElementById('page-skeleton');
  if (!sk) return;
  // Hide after JS has had a chance to render real content
  // Each page's own JS should call hideSkeleton() when data is loaded
  window.hideSkeleton = function() {
    var el = document.getElementById('page-skeleton');
    if (el) el.style.display = 'none';
  };
  // Fallback: hide after 3s regardless
  setTimeout(window.hideSkeleton, 3000);
})();