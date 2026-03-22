let staffData = [];
let editingId = null;

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
      { staff_id: 'ST-4829', full_name: 'Sarah Johnson',  shift_time: '7:00 AM - 3:00 PM',  assigned_unit: 'ICU Ward',     status: 'active',   role: 'Senior Carer' },
      { staff_id: 'ST-3746', full_name: 'Michael Chen',   shift_time: '3:00 PM - 11:00 PM', assigned_unit: 'Emergency',    status: 'on_leave', role: 'Nurse' },
      { staff_id: 'ST-5920', full_name: 'Emma Rodriguez', shift_time: '11:00 PM - 7:00 AM', assigned_unit: 'General Ward', status: 'pending',  role: 'Carer' },
      { staff_id: 'ST-1038', full_name: 'David Kim',      shift_time: '7:00 AM - 3:00 PM',  assigned_unit: 'Pediatrics',   status: 'active',   role: 'Doctor' },
      { staff_id: 'ST-2241', full_name: 'Linda Pham',     shift_time: '7:00 AM - 3:00 PM',  assigned_unit: 'Geriatrics',   status: 'active',   role: 'Carer' },
      { staff_id: 'ST-6610', full_name: 'James Carter',   shift_time: '3:00 PM - 11:00 PM', assigned_unit: 'Neurology',    status: 'active',   role: 'Nurse' },
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
    document.getElementById('stat-active').textContent  = active;
    document.getElementById('stat-pending').textContent = pending;
    document.getElementById('stat-shifts').textContent  = staffData.length;
  }
}

// ── RENDER TABLE ──
function renderTable() {
  const tbody = document.getElementById('staff-tbody');
  if (!staffData.length) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#9aa0ac;padding:24px;">No staff found.</td></tr>';
    return;
  }

  tbody.innerHTML = staffData.map(s => {
    const statusClass = s.status === 'active' ? 'status-active' : s.status === 'on_leave' ? 'status-leave' : 'status-pending';
    const statusLabel = s.status === 'active' ? 'Active' : s.status === 'on_leave' ? 'On Leave' : 'Pending';
    // Shift hours calc (just show 8 hours as label like in screenshot)
    return `
      <tr>
        <td>
          <div class="staff-name">${s.full_name}</div>
          <div class="staff-id">ID: ${s.staff_id}</div>
        </td>
        <td>
          <div class="shift-main">${s.shift_time}</div>
          <div class="shift-hours">8 hours</div>
        </td>
        <td>${s.assigned_unit}</td>
        <td><span class="status-badge ${statusClass}">${statusLabel}</span></td>
        <td>
          <button class="action-btn" title="View details" onclick="viewStaff('${s.staff_id}')">
            <svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
          </button>
          <button class="action-btn blue" title="Edit" onclick="editStaff('${s.staff_id}')">
            <svg viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
          </button>
        </td>
      </tr>`;
  }).join('');

  document.getElementById('staff-count').textContent = `${staffData.length} staff member${staffData.length !== 1 ? 's' : ''}`;
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
  document.getElementById('modal-edit').classList.add('open');
}

function viewStaff(id) {
  editStaff(id); // open same modal in view context
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