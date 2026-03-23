let staffData = [];
let editingId = null;
let viewingId = null;

// ── AUTH GUARD ──
// Only admin role can see this page
function checkAccess() {
  try {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    const token = localStorage.getItem('access_token');

    if (!token || !user.role) {
      // Not logged in — redirect to login
      window.location.href = 'register-login.html';
      return false;
    }

    if (user.role !== 'admin') {
      // Logged in but not admin — show access denied
      document.getElementById('access-denied').style.display = 'flex';
      document.getElementById('staff-panel').style.display = 'none';
      document.getElementById('topbar-right').style.display = 'none';
      return false;
    }

    // Admin — show name in topbar
    document.getElementById('admin-name').textContent = `Admin: ${user.full_name || 'Admin'}`;
    document.getElementById('admin-role').textContent = user.role === 'admin' ? 'Facility Manager' : user.role;
    document.getElementById('topbar-right').style.display = '';
    document.getElementById('staff-panel').style.display = '';
    document.getElementById('access-denied').style.display = 'none';
    return true;
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
  try {
    const res = await fetch(`${API_BASE}/staff/`, {
      headers: { 'Authorization': `Bearer ${localStorage.getItem('access_token')}` }
    });
    if (!res.ok) throw new Error();
    staffData = await res.json();
  } catch {
    // Fallback demo data matching seed.py
    staffData = [
      { staff_id: 'ST-4829', full_name: 'Sarah Johnson',  shift_time: '7:00 AM - 3:00 PM',  assigned_unit: 'ICU Ward',     status: 'active',   role: 'Senior Carer', availability: 'ready',    location: 'Nurses Station A' },
      { staff_id: 'ST-3746', full_name: 'Michael Chen',   shift_time: '3:00 PM - 11:00 PM', assigned_unit: 'Emergency',    status: 'on_leave', role: 'Nurse',        availability: 'busy',     location: 'Room 104' },
      { staff_id: 'ST-5920', full_name: 'Emma Rodriguez', shift_time: '11:00 PM - 7:00 AM', assigned_unit: 'General Ward', status: 'pending',  role: 'Carer',        availability: 'on_break', location: 'Break Room' },
      { staff_id: 'ST-1038', full_name: 'David Kim',      shift_time: '7:00 AM - 3:00 PM',  assigned_unit: 'Pediatrics',   status: 'active',   role: 'Doctor',       availability: 'busy',     location: 'Room 312' },
      { staff_id: 'ST-2241', full_name: 'Linda Pham',     shift_time: '7:00 AM - 3:00 PM',  assigned_unit: 'Geriatrics',   status: 'active',   role: 'Carer',        availability: 'ready',    location: 'Room 205' },
      { staff_id: 'ST-6610', full_name: 'James Carter',   shift_time: '3:00 PM - 11:00 PM', assigned_unit: 'Neurology',    status: 'active',   role: 'Nurse',        availability: 'on_break', location: 'Cafeteria' },
    ];
  }
  renderTable();
  loadStats();
  hideSkeleton(); // Delete will trigger top of loading
}

async function loadStats() {
  try {
    const res = await fetch(`${API_BASE}/staff/stats/summary`, {
      headers: { 'Authorization': `Bearer ${localStorage.getItem('access_token')}` }
    });
    if (!res.ok) throw new Error();
    const s = await res.json();
    document.getElementById('stat-active').textContent  = s.active_staff;
    document.getElementById('stat-pending').textContent = s.pending;
    document.getElementById('stat-shifts').textContent  = s.shifts_today;
  } catch {
    // Compute from local staffData
    const active  = staffData.filter(s => s.status === 'active').length;
    const pending = staffData.filter(s => s.status === 'pending').length;
    const onBreak = staffData.filter(s => s.availability === 'on_break').length;
    document.getElementById('stat-active').textContent  = active;
    document.getElementById('stat-pending').textContent = pending;
    document.getElementById('stat-shifts').textContent  = staffData.length;
    document.getElementById('stat-break').textContent   = onBreak;
  }
}

// ── RENDER TABLE ──
function renderTable() {
  const tbody = document.getElementById('staff-tbody');
  if (!staffData.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#9aa0ac;padding:24px;">No staff found.</td></tr>';
    return;
  }

  tbody.innerHTML = staffData.map(s => {
    const avail = s.availability || 'ready';
    const availClass = avail === 'ready' ? 'avail-ready' : avail === 'busy' ? 'avail-busy' : 'avail-break';
    const availLabel = avail === 'ready' ? 'Ready' : avail === 'busy' ? 'Busy' : 'On Break';
    const loc = s.location || '—';
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
          <button class="action-btn green" title="Call" onclick="callStaff('${s.staff_id}')">
            <svg viewBox="0 0 24 24"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.362 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.338 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
          </button>
          <button class="action-btn" title="View details" onclick="viewStaff('${s.staff_id}')">
            <svg viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
          </button>
          <button class="action-btn blue" title="Edit" onclick="editStaff('${s.staff_id}')">
            <svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
        </td>
      </tr>`;
  }).join('');

  document.getElementById('staff-count').textContent = `${staffData.length} staff member${staffData.length !== 1 ? 's' : ''}`;
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
    const res = await fetch(`${API_BASE}/staff/${editingId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${localStorage.getItem('access_token')}`
      },
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
  if (!editingId || !confirm(`Delete staff member ${editingId}?`)) return;
  try {
    await fetch(`${API_BASE}/staff/${editingId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${localStorage.getItem('access_token')}` }
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
  const full_name = document.getElementById('add-name').value.trim();
  if (!full_name) { alert('Please enter a full name.'); return; }

  const payload = {
    full_name,
    shift_time:    document.getElementById('add-shift').value,
    assigned_unit: document.getElementById('add-unit').value,
    role:          document.getElementById('add-role').value,
  };

  try {
    const res = await fetch(`${API_BASE}/admin-console/staff/create?full_name=${encodeURIComponent(payload.full_name)}&shift_time=${encodeURIComponent(payload.shift_time)}&assigned_unit=${encodeURIComponent(payload.assigned_unit)}&role=${encodeURIComponent(payload.role)}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${localStorage.getItem('access_token')}` }
    });
    if (!res.ok) throw new Error();
    const created = await res.json();
    staffData.push({
      staff_id:      created.staff_id,
      full_name:     created.full_name,
      shift_time:    created.shift_time,
      assigned_unit: created.assigned_unit,
      status:        'active',
      role:          created.role || payload.role
    });
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