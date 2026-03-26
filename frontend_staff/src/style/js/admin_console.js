//Admin Console - RBAC

const token = sessionStorage.getItem('access_token') || sessionStorage.getItem('spherecare_token');
const adminId = sessionStorage.getItem('spherecare_admin_id');
const centerIdDisplay = sessionStorage.getItem('spherecare_center_id');

function portalUserRole() {
  try {
    let u = JSON.parse(sessionStorage.getItem('user') || '{}');
    if (!u.role) {
      u.role = u.global_role || sessionStorage.getItem('spherecare_role') || '';
    }
    return (u.role || '').toLowerCase();
  } catch (_) {
    return '';
  }
}

function isStaffPortalAdmin() {
  return portalUserRole() === 'admin';
}

function authH() {
  const activeToken = sessionStorage.getItem('access_token') || sessionStorage.getItem('spherecare_token') || token;
  return { 'Authorization': `Bearer ${activeToken}`, 'Content-Type': 'application/json' };
}

function safeShowSkeleton() { if (typeof showSkeleton === 'function') showSkeleton(); }
function safeHideSkeleton() { if (typeof hideSkeleton === 'function') hideSkeleton(); }

// Store center ID globally
let centerID = centerIdDisplay || '';

function openAddStaff() {}
function closeAddStaff() {}
function switchModalTab() {}

/* ── Resident modal helpers ── */
function openAddResident() {
  const modal = document.getElementById('modal-add-resident');
  if (modal) modal.classList.add('open');
}
function closeAddResident() {
  const modal = document.getElementById('modal-add-resident');
  if (modal) modal.classList.remove('open');
  const msg = document.getElementById('resident-message');
  if (msg) msg.innerHTML = '';
}
function closeEditResident() {
  const modal = document.getElementById('modal-edit-resident');
  if (modal) modal.classList.remove('open');
}

document.addEventListener('DOMContentLoaded', () => {
  // Close resident modal on overlay click
  const residentModal = document.getElementById('modal-add-resident');
  if (residentModal) {
    residentModal.addEventListener('click', e => {
      if (e.target === residentModal) closeAddResident();
    });
  }
  
  const residentForm = document.getElementById('resident-form');
  if (residentForm) residentForm.addEventListener('submit', handleResidentFormSubmit);

  displayCenterId();
});

// STAFF MANAGEMENT (legacy functions for tab-based admin system)

function loadStaffList() {
  const staffTable = document.getElementById('staff-table');
  const staffTbody = document.getElementById('staff-tbody');
  const staffLoading = document.getElementById('staff-list-loading');

  if (!staffLoading) return;

  staffLoading.style.display = 'block';
  if (staffTable) staffTable.style.display = 'none';

  fetch(`${API_BASE}/admin/staff`, {
    method: 'GET',
    headers: authH()
  })
    .then(res => res.json())
    .then(staff => {
      if (!staffTbody) return;
      
      staffTbody.innerHTML = '';
      
      if (staff.length === 0) {
        staffTbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text3);">No staff members yet</td></tr>';
      } else {
        staff.forEach(s => {
          const row = document.createElement('tr');
          row.innerHTML = `
            <td><strong>${s.staff_id}</strong></td>
            <td>${s.full_name}</td>
            <td>${s.role}</td>
            <td>${s.shift_time}</td>
            <td>${s.assigned_unit}</td>
            <td><span class="admin-badge ${s.status === 'active' ? 'active' : 'inactive'}">${s.status.toUpperCase()}</span></td>
            <td style="display:flex;gap:6px;flex-wrap:wrap;">
              <button type="button" class="admin-action-btn" style="background:#cce5ff;color:#004085;padding:6px 10px;border:none;border-radius:4px;cursor:pointer;font-size:12px;font-weight:600;" onclick="editStaff('${s.staff_id}', '${s.full_name}')">✏️ Edit</button>
              <button type="button" class="admin-action-btn" style="background:#f8d7da;color:#721c24;padding:6px 10px;border:none;border-radius:4px;cursor:pointer;font-size:12px;font-weight:600;" onclick="deleteStaff('${s.staff_id}', '${s.full_name}')">🗑️ Delete</button>
            </td>
          `;
          staffTbody.appendChild(row);
        });
      }

      staffLoading.style.display = 'none';
      if (staffTable) staffTable.style.display = 'table';
    })
    .catch(err => {
      console.error('Error loading staff:', err);
      if (staffLoading) staffLoading.innerHTML = '<div class="admin-error">Failed to load staff list</div>';
    });
}

async function handleStaffFormSubmit(e) {
  e.preventDefault();

  const formData = new FormData(e.target);
  const data = {
    full_name: (formData.get('full_name') || '').toString().trim(),
    role: (formData.get('role') || '').toString().trim(),
    shift_time: (formData.get('shift_time') || '').toString().trim(),
    assigned_unit: (formData.get('assigned_unit') || '').toString().trim()
  };

  const messageDiv = document.getElementById('staff-message');
  if (!data.full_name || !data.shift_time || !data.assigned_unit) {
    if (messageDiv) messageDiv.innerHTML = '<div class="admin-error">✗ Please complete all required fields.</div>';
    return;
  }

  if (messageDiv) messageDiv.innerHTML = '<div class="admin-loading">Creating staff member...</div>';

  try {
    const params = new URLSearchParams(data);
    const res = await fetch(`${API_BASE}/admin/staff/create?${params}`, {
      method: 'POST',
      headers: authH()
    });

    const result = await res.json().catch(() => ({}));
    if (!res.ok || !result?.success) {
      const msg = result?.detail?.msg || result?.message || 'Failed to create staff';
      throw new Error(msg);
    }

    if (messageDiv) messageDiv.innerHTML = `<div class="admin-success">✓ ${result.message || 'Staff member created successfully'}</div>`;
    e.target.reset();

    setTimeout(async () => {
      if (messageDiv) messageDiv.innerHTML = '';
      closeAddStaff();

      // Refresh the active admin console dataset/table used by this page.
      await loadStaff();

      // Refresh legacy widgets only if they exist on the current page.
      if (document.getElementById('pending-staff-loading')) loadPendingStaffApprovals();
      if (document.getElementById('registration-list-loading')) loadRegistrationRequests();
      if (document.getElementById('staff-list-loading')) loadStaffList();
    }, 1200);
  } catch (err) {
    console.error('Error creating staff:', err);
    if (messageDiv) messageDiv.innerHTML = `<div class="admin-error">✗ ${err.message || 'Error creating staff member'}</div>`;
  }
}

function deleteStaff(staffId, fullName) {
  if (!confirm(`Delete staff member ${fullName || staffId}?`)) return;

  fetch(`${API_BASE}/admin/staff/${encodeURIComponent(staffId)}`, {
    method: 'DELETE',
    headers: authH()
  })
    .then(res => res.json())
    .then(result => {
      if (result.success) {
        alert(result.message);
        loadStaffList();
      } else {
        alert('Failed to delete staff member');
      }
    })
    .catch(err => {
      console.error('Error deleting staff:', err);
      alert('Error deleting staff member');
    });
}

function editStaff(staffId, fullName) {
  alert(`Edit functionality for ${fullName || staffId} - Coming soon!`);
}

// RESIDENT MANAGEMENT

function loadResidentsList() {
  const residentTable = document.getElementById('resident-table');
  const residentTbody = document.getElementById('resident-tbody');
  const residentLoading = document.getElementById('resident-list-loading');

  if (!residentLoading) return;

  residentLoading.style.display = 'block';
  if (residentTable) residentTable.style.display = 'none';

  fetch(`${API_BASE}/admin/residents`, {
    method: 'GET',
    headers: authH()
  })
    .then(res => res.json())
    .then(residents => {
      if (!residentTbody) return;
      
      residentTbody.innerHTML = '';
      
      if (residents.length === 0) {
        residentTbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text3);">No residents yet</td></tr>';
      } else {
        residents.forEach(r => {
          const row = document.createElement('tr');
          row.innerHTML = `
            <td><strong>${r.id}</strong></td>
            <td>${r.full_name}</td>
            <td>${r.age}</td>
            <td>${r.room}</td>
            <td><span class="admin-badge ${r.status === 'stable' ? 'active' : 'inactive'}">${r.status.toUpperCase()}</span></td>
            <td>
              <button class="admin-action-btn admin-action-edit" onclick="editResident(${r.id})">Edit</button>
              <button class="admin-action-btn admin-action-delete" onclick="deleteResident(${r.id})">Delete</button>
            </td>
          `;
          residentTbody.appendChild(row);
        });
      }

      residentLoading.style.display = 'none';
      if (residentTable) residentTable.style.display = 'table';
    })
    .catch(err => {
      console.error('Error loading residents:', err);
      if (residentLoading) residentLoading.innerHTML = '<div class="admin-error">Failed to load residents list</div>';
    });
}

function handleResidentFormSubmit(e) {
  e.preventDefault();

  const formData = new FormData(e.target);
  const data = {
    full_name: formData.get('full_name'),
    age: parseInt(formData.get('age')),
    room: formData.get('room'),
    status: formData.get('status')
  };

  const messageDiv = document.getElementById('resident-message');
  if (messageDiv) messageDiv.innerHTML = '<div class="admin-loading">Creating resident...</div>';

  const params = new URLSearchParams(data);
  fetch(`${API_BASE}/admin/resident/create?${params}`, {
    method: 'POST',
    headers: authH()
  })
    .then(res => res.json())
    .then(result => {
      if (messageDiv) {
        if (result.success) {
          messageDiv.innerHTML = `<div class="admin-success">✓ ${result.message}</div>`;
          e.target.reset();
          setTimeout(() => {
            messageDiv.innerHTML = '';
            closeAddResident();
            loadStaff();
          }, 2000);
        } else {
          messageDiv.innerHTML = `<div class="admin-error">✗ ${result.detail?.msg || 'Failed to create resident'}</div>`;
        }
      }
    })
    .catch(err => {
      console.error('Error creating resident:', err);
      if (messageDiv) messageDiv.innerHTML = '<div class="admin-error">✗ Error creating resident</div>';
    });
}

function deleteResident(residentId) {
  if (!confirm(`Delete resident ${residentId}?`)) return;

  fetch(`${API_BASE}/admin/resident/${residentId}`, {
    method: 'DELETE',
    headers: authH()
  })
    .then(res => res.json())
    .then(result => {
      if (result.success) {
        alert(result.message);
        loadResidentsList();
      } else {
        alert('Failed to delete resident');
      }
    })
    .catch(err => {
      console.error('Error deleting resident:', err);
      alert('Error deleting resident');
    });
}

function editResident(residentId) {
  alert(`Edit functionality for resident ${residentId} - Coming soon!`);
}

// STAFF APPROVALS MANAGEMENT

function loadPendingStaffApprovals() {
  const pendingTable = document.getElementById('pending-staff-table');
  const pendingTbody = document.getElementById('pending-staff-tbody');
  const pendingLoading = document.getElementById('pending-staff-loading');

  if (!pendingLoading) return;

  pendingLoading.style.display = 'block';
  if (pendingTable) pendingTable.style.display = 'none';

  fetch(`${API_BASE}/admin/staff/pending`, {
    method: 'GET',
    headers: authH()
  })
    .then(res => res.json().then(body => ({ ok: res.ok, body })))
    .then(({ ok, body: staffList }) => {
      if (!pendingTbody) return;
      
      pendingTbody.innerHTML = '';
      
      if (!ok || !Array.isArray(staffList)) {
        pendingTbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text3);">Could not load pending approvals. Refresh or log in again as admin.</td></tr>';
      } else if (staffList.length === 0) {
        pendingTbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text3);">No pending staff approvals</td></tr>';
      } else {
        staffList.forEach(s => {
          const createdDate = s.created_at ? new Date(s.created_at).toLocaleDateString() : '—';
          const code = (s.staff_code || s.staff_id || '').replace(/'/g, "\\'");
          const sname = (s.full_name || '').replace(/'/g, "\\'");
          const row = document.createElement('tr');
          row.innerHTML = `
            <td><strong>${s.staff_code || s.staff_id || 'N/A'}</strong></td>
            <td>${s.full_name}</td>
            <td>${s.email}</td>
            <td>${s.role || 'staff'}</td>
            <td>${createdDate}</td>
            <td><span class="admin-badge inactive">PENDING</span></td>
            <td style="display:flex;gap:6px;flex-wrap:wrap;">
              <button class="admin-action-btn" style="background:#d4edda;color:#155724;padding:6px 10px;border:none;border-radius:4px;cursor:pointer;font-size:12px;font-weight:600;" onclick="approveStaffMember('${code}', '${sname}')">✓ Approve</button>
              <button class="admin-action-btn" style="background:#f8d7da;color:#721c24;padding:6px 10px;border:none;border-radius:4px;cursor:pointer;font-size:12px;font-weight:600;" onclick="rejectStaffMember('${code}', '${sname}')">✗ Reject</button>
            </td>
          `;
          pendingTbody.appendChild(row);
        });
      }

      pendingLoading.style.display = 'none';
      if (pendingTable) pendingTable.style.display = 'table';
    })
    .catch(err => {
      console.error('Error loading pending staff:', err);
      if (pendingLoading) pendingLoading.innerHTML = '<div class="admin-error">Failed to load pending approvals</div>';
    });
}

function approveStaffMember(staffId, fullName) {
  if (!confirm(`Approve ${fullName} for staff role?`)) return;

  const messageDiv = document.getElementById('approval-message');
  if (messageDiv) {
    messageDiv.style.display = 'block';
    messageDiv.className = 'admin-loading';
    messageDiv.textContent = 'Processing approval...';
  }

  fetch(`${API_BASE}/admin/staff/${encodeURIComponent(staffId)}/approve`, {
    method: 'POST',
    headers: authH()
  })
    .then(res => res.json())
    .then(result => {
      if (messageDiv) {
        messageDiv.className = result.success ? 'admin-success' : 'admin-error';
        messageDiv.innerHTML = `<strong>${result.message || 'Approval processed'}</strong>`;
      }
      setTimeout(() => {
        if (messageDiv) messageDiv.style.display = 'none';
        loadPendingStaffApprovals();
        loadRegistrationRequests();
        loadStaffList();
      }, 2000);
    })
    .catch(err => {
      console.error('Error approving staff:', err);
      if (messageDiv) {
        messageDiv.className = 'admin-error';
        messageDiv.textContent = 'Error approving staff member';
      }
    });
}

function rejectStaffMember(staffId, fullName) {
  const reason = prompt(`Enter rejection reason for ${fullName}:`, 'Does not meet requirements');
  if (reason === null) return;

  const messageDiv = document.getElementById('approval-message');
  if (messageDiv) {
    messageDiv.style.display = 'block';
    messageDiv.className = 'admin-loading';
    messageDiv.textContent = 'Processing rejection...';
  }

  fetch(`${API_BASE}/admin/staff/${encodeURIComponent(staffId)}/reject?reason=${encodeURIComponent(reason)}`, {
    method: 'POST',
    headers: authH()
  })
    .then(res => res.json())
    .then(result => {
      if (messageDiv) {
        messageDiv.className = result.success ? 'admin-success' : 'admin-error';
        messageDiv.innerHTML = `<strong>${result.message || 'Rejection processed'}</strong>`;
      }
      setTimeout(() => {
        if (messageDiv) messageDiv.style.display = 'none';
        loadPendingStaffApprovals();
        loadRegistrationRequests();
        loadStaffList();
      }, 2000);
    })
    .catch(err => {
      console.error('Error rejecting staff:', err);
      if (messageDiv) {
        messageDiv.className = 'admin-error';
        messageDiv.textContent = 'Error rejecting staff member';
      }
    });
}

// MODAL PENDING APPROVALS (targets elements inside #modal-add)

function loadModalPendingApprovals() {
  const loading = document.getElementById('modal-pending-loading');
  const table = document.getElementById('modal-pending-table');
  const tbody = document.getElementById('modal-pending-tbody');
  if (!loading) return;

  loading.style.display = 'block';
  loading.textContent = 'Loading pending approvals…';
  if (table) table.style.display = 'none';

  fetch(`${API_BASE}/admin/staff/pending`, { method: 'GET', headers: authH() })
    .then(res => res.json().then(body => ({ ok: res.ok, body })))
    .then(({ ok, body: staffList }) => {
      if (!tbody) return;
      tbody.innerHTML = '';
      if (!ok || !Array.isArray(staffList)) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#94A3B8;padding:24px;">Could not load pending approvals</td></tr>';
      } else if (staffList.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#94A3B8;padding:24px;">No pending approvals</td></tr>';
      } else {
        staffList.forEach(s => {
          const date = s.created_at ? new Date(s.created_at).toLocaleDateString() : '—';
          const sid = (s.staff_code || s.staff_id || '').replace(/'/g, "\\'");
          const sname = (s.full_name || '').replace(/'/g, "\\'");
          const row = document.createElement('tr');
          row.innerHTML = `
            <td><strong>${s.full_name}</strong></td>
            <td style="font-size:12px;">${s.email}</td>
            <td>${s.role || 'staff'}</td>
            <td style="font-size:12px;">${date}</td>
            <td><span class="admin-badge inactive">PENDING</span></td>
            <td style="display:flex;gap:6px;flex-wrap:wrap;">
              <button class="admin-action-btn" style="background:#d4edda;color:#155724;padding:6px 10px;border:none;border-radius:4px;cursor:pointer;font-size:12px;font-weight:600;" onclick="approveModalStaff('${sid}', '${sname}')">✓ Approve</button>
              <button class="admin-action-btn" style="background:#f8d7da;color:#721c24;padding:6px 10px;border:none;border-radius:4px;cursor:pointer;font-size:12px;font-weight:600;" onclick="rejectModalStaff('${sid}', '${sname}')">✗ Reject</button>
            </td>
          `;
          tbody.appendChild(row);
        });
      }
      loading.style.display = 'none';
      if (table) table.style.display = 'table';
    })
    .catch(err => {
      console.error('Error loading modal pending staff:', err);
      if (loading) loading.innerHTML = '<div class="admin-error">Failed to load pending approvals</div>';
    });
}

function approveModalStaff(staffId, fullName) {
  if (!confirm(`Approve ${fullName} for staff role?`)) return;
  const msg = document.getElementById('modal-approval-message');
  if (msg) { msg.style.display = 'block'; msg.className = 'admin-loading'; msg.textContent = 'Processing approval…'; }

  fetch(`${API_BASE}/admin/staff/${encodeURIComponent(staffId)}/approve`, { method: 'POST', headers: authH() })
    .then(res => res.json())
    .then(result => {
      if (msg) {
        msg.style.background = result.success ? '#d4edda' : '#f8d7da';
        msg.style.color = result.success ? '#155724' : '#721c24';
        msg.style.display = 'block';
        msg.textContent = result.message || 'Processed';
      }
      setTimeout(() => {
        if (msg) msg.style.display = 'none';
        loadModalPendingApprovals();
        loadStaff();
        if (document.getElementById('pending-staff-loading')) loadPendingStaffApprovals();
        if (document.getElementById('registration-list-loading')) loadRegistrationRequests();
        if (document.getElementById('staff-list-loading')) loadStaffList();
      }, 1800);
    })
    .catch(() => { if (msg) { msg.style.display='block'; msg.style.background='#f8d7da'; msg.style.color='#721c24'; msg.textContent='Error approving staff member'; } });
}

function rejectModalStaff(staffId, fullName) {
  const reason = prompt(`Enter rejection reason for ${fullName}:`, 'Does not meet requirements');
  if (reason === null) return;
  const msg = document.getElementById('modal-approval-message');
  if (msg) { msg.style.display = 'block'; msg.className = 'admin-loading'; msg.textContent = 'Processing rejection…'; }

  fetch(`${API_BASE}/admin/staff/${encodeURIComponent(staffId)}/reject?reason=${encodeURIComponent(reason)}`, { method: 'POST', headers: authH() })
    .then(res => res.json())
    .then(result => {
      if (msg) {
        msg.style.background = result.success ? '#d4edda' : '#f8d7da';
        msg.style.color = result.success ? '#155724' : '#721c24';
        msg.style.display = 'block';
        msg.textContent = result.message || 'Processed';
      }
      setTimeout(() => {
        if (msg) msg.style.display = 'none';
        loadModalPendingApprovals();
        loadStaff();
        if (document.getElementById('pending-staff-loading')) loadPendingStaffApprovals();
        if (document.getElementById('registration-list-loading')) loadRegistrationRequests();
        if (document.getElementById('staff-list-loading')) loadStaffList();
      }, 1800);
    })
    .catch(() => { if (msg) { msg.style.display='block'; msg.style.background='#f8d7da'; msg.style.color='#721c24'; msg.textContent='Error rejecting staff member'; } });
}

// STAFF REGISTRATION MANAGEMENT

function displayCenterId() {
  const centerIdElement = document.getElementById('center-id-display');
  if (centerIdElement && centerID) {
    centerIdElement.textContent = centerID;
  }
}

function copyCenterId() {
  const centerIdElement = document.getElementById('center-id-display');
  if (!centerIdElement) return;

  const centerIdText = centerIdElement.textContent.trim();
  if (!centerIdText) {
    alert('No center ID to copy');
    return;
  }

  navigator.clipboard.writeText(centerIdText).then(() => {
    const copyBtn = document.getElementById('copy-center-id-btn');
    if (copyBtn) {
      const originalText = copyBtn.textContent;
      copyBtn.textContent = '✓ Copied!';
      copyBtn.style.background = '#d4edda';
      copyBtn.style.color = '#155724';
      
      setTimeout(() => {
        copyBtn.textContent = originalText;
        copyBtn.style.background = '';
        copyBtn.style.color = '';
      }, 2000);
    }
  }).catch(err => {
    console.error('Failed to copy center ID:', err);
    alert('Failed to copy center ID');
  });
}

function loadRegistrationRequests() {
  const registrationTable = document.getElementById('registration-table');
  const registrationTbody = document.getElementById('registration-tbody');
  const loadingDiv = document.getElementById('registration-list-loading');

  if (!loadingDiv) return;

  loadingDiv.style.display = 'block';
  if (registrationTable) registrationTable.style.display = 'none';

  fetch(`${API_BASE}/admin/staff/requests`, {
    method: 'GET',
    headers: authH()
  })
    .then(res => res.json())
    .then(registrations => {
      if (!registrationTbody) return;
      
      registrationTbody.innerHTML = '';
      
      if (!registrations || registrations.length === 0) {
        registrationTbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text3);">No registration requests</td></tr>';
      } else {
        registrations.forEach(reg => {
          const createdDate = new Date(reg.created_at).toLocaleDateString('en-AU', {
            day: 'numeric',
            month: 'short',
            year: 'numeric'
          });
          const row = document.createElement('tr');
          
          let statusBadgeClass = 'inactive';
          let statusText = 'PENDING';
          if (reg.approval_status === 'approved') {
            statusBadgeClass = 'active';
            statusText = 'APPROVED';
          } else if (reg.approval_status === 'rejected') {
            statusBadgeClass = 'inactive';
            statusText = 'REJECTED';
          }
          
          const rsid = (reg.staff_code || reg.staff_id || '').replace(/'/g, "\\'");
          const rsname = (reg.full_name || '').replace(/'/g, "\\'");
          row.innerHTML = `
            <td>${createdDate}</td>
            <td>${reg.staff_code || reg.staff_id || 'N/A'}</td>
            <td><strong>${reg.full_name}</strong></td>
            <td>${reg.email}</td>
            <td>${reg.role || 'staff'}</td>
            <td><span class="admin-badge ${statusBadgeClass}">${statusText}</span></td>
            <td>
              ${reg.approval_status === 'pending' ? `
                <div style="display:flex;gap:6px;flex-wrap:wrap;">
                  <button class="admin-action-btn" style="background:#d4edda;color:#155724;padding:6px 10px;border:none;border-radius:4px;cursor:pointer;font-size:12px;font-weight:600;" onclick="approveStaffMember('${rsid}', '${rsname}')">✓ Approve</button>
                  <button class="admin-action-btn" style="background:#f8d7da;color:#721c24;padding:6px 10px;border:none;border-radius:4px;cursor:pointer;font-size:12px;font-weight:600;" onclick="rejectStaffMember('${rsid}', '${rsname}')">✗ Reject</button>
                </div>
              ` : `<span style="color:var(--text3);font-size:12px;">No action needed</span>`}
            </td>
          `;
          registrationTbody.appendChild(row);
        });
      }

      loadingDiv.style.display = 'none';
      if (registrationTable) registrationTable.style.display = 'table';
    })
    .catch(err => {
      console.error('Error loading registration requests:', err);
      if (loadingDiv) {
        loadingDiv.style.display = 'none';
        loadingDiv.innerHTML = '<div class="admin-error">Failed to load registration requests</div>';
      }
    });
}

/* ═══ CLOCK ═══ */
function updateClock() {
  const now = new Date();

  const dateEl = document.getElementById('tb-date');
  const timeEl = document.getElementById('tb-time');

  if (dateEl) {
    dateEl.textContent = now.toLocaleDateString('en-AU', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  }

  if (timeEl) {
    timeEl.textContent = now.toLocaleTimeString('en-AU', {
      hour: '2-digit',
      minute: '2-digit'
    });
  }
}


let currentUser = null;

function initUser() {
  try {
    let u = {};
    try { u = JSON.parse(sessionStorage.getItem('user') || '{}'); } catch(_){ }
    // fallback: build user from spherecare_* keys if 'user' is empty
    // Normalise: backend stores global_role, frontend expects role
    if (!u.role) {
      u.role = u.global_role || sessionStorage.getItem('spherecare_role') || '';
      u.full_name = u.full_name || sessionStorage.getItem('spherecare_user_name') || '';
      u.email = u.email || sessionStorage.getItem('spherecare_user_email') || '';
    }
    currentUser = u;
    const roleNorm = String(u.role || '').toLowerCase();
    const isAdmin = roleNorm === 'admin';

    const adminNameEl = document.getElementById('admin-name');
    const adminRoleEl = document.getElementById('admin-role');
    const adminPanel = document.getElementById('admin-panel');
    const accessDenied = document.getElementById('access-denied');

    if (adminNameEl) {
      adminNameEl.textContent =
        isAdmin ? `Admin: ${u.full_name || 'Admin'}` : (u.full_name || 'Staff');
    }

    if (adminRoleEl) {
      adminRoleEl.textContent = isAdmin ? 'Facility Manager' : (u.global_role || u.role || 'Staff');
    }

    if (!isAdmin) {
      if (adminPanel) adminPanel.style.display = 'none';
      if (accessDenied) accessDenied.style.display = 'flex';
      return false;
    }

    if (accessDenied) accessDenied.style.display = 'none';
    if (adminPanel) adminPanel.style.display = 'block';
    return true;
  } catch (e) {
    const adminPanel = document.getElementById('admin-panel');
    const accessDenied = document.getElementById('access-denied');

    if (adminPanel) adminPanel.style.display = 'none';
    if (accessDenied) accessDenied.style.display = 'flex';
    return false;
  }
}

/* ═══ DEMO DATA */
const DEMO_STAFF = [
  { id: 1, staff_id: 'STF-48291037', full_name: 'Sarah Johnson', shift_time: '7:00 AM – 3:00 PM', hours: '8 hours', assigned_unit: 'ICU Ward', status: 'active', role: 'Senior Carer' },
  { id: 2, staff_id: 'STF-37462918', full_name: 'Michael Chen', shift_time: '3:00 PM – 11:00 PM', hours: '8 hours', assigned_unit: 'Emergency', status: 'on_leave', role: 'Nurse' },
  { id: 3, staff_id: 'STF-59201846', full_name: 'Emma Rodriguez', shift_time: '11:00 PM – 7:00 AM', hours: '8 hours', assigned_unit: 'General Ward', status: 'pending', role: 'Carer' },
  { id: 4, staff_id: 'STF-10385729', full_name: 'David Kim', shift_time: '7:00 AM – 3:00 PM', hours: '8 hours', assigned_unit: 'Pediatrics', status: 'active', role: 'Doctor' },
  { id: 5, staff_id: 'STF-22418365', full_name: 'Linda Pham', shift_time: '7:00 AM – 3:00 PM', hours: '8 hours', assigned_unit: 'Geriatrics', status: 'active', role: 'Carer' },
  { id: 6, staff_id: 'STF-66109284', full_name: 'James Carter', shift_time: '3:00 PM – 11:00 PM', hours: '8 hours', assigned_unit: 'Neurology', status: 'active', role: 'Nurse' }
];

const DEMO_ALERTS = [
  { level: 'warning', title: 'Staff Shortage Warning', message: 'ICU Ward requires additional coverage for night shift' },
  { level: 'critical', title: 'Critical Task Overdue', message: 'Equipment maintenance check pending for 2 days' },
  { level: 'info', title: 'System Update', message: 'New staff scheduling features now available' }
];

const DEMO_TASKS = [
  { title: 'Equipment Maintenance Check', status: 'overdue', desc: 'ICU Ward ventilator maintenance overdue by 2 days.', assignee: 'Sarah Johnson', due: 'Mar 12' },
  { title: 'Medication Stock Audit', status: 'inprogress', desc: 'Monthly medication inventory audit in progress.', assignee: 'Michael Chen', due: 'Mar 15' },
  { title: 'Resident Care Plan Update', status: 'inprogress', desc: "Update Dorothy Williams' care plan with new medications.", assignee: 'Emma Rodriguez', due: 'Mar 14' },
  { title: 'Staff Training Module', status: 'done', desc: 'All night-shift staff completed fire safety training.', assignee: 'All Staff', due: 'Mar 10' },
  { title: 'CCTV System Calibration', status: 'overdue', desc: 'Monthly camera calibration for Floor 2.', assignee: 'David Kim', due: 'Mar 11' },
  { title: 'Visitor Log Review', status: 'inprogress', desc: 'Review visitor logs for this week.', assignee: 'Linda Pham', due: 'Mar 16' }
];

const DEMO_RESIDENTS = [
  { id: 1, full_name: 'Dorothy Williams', age: 82, room: 'Room 104', status: 'stable' },
  { id: 2, full_name: 'Harold Mitchell', age: 79, room: 'Room 207', status: 'critical' },
  { id: 3, full_name: 'Margaret Chen', age: 88, room: 'Room 112', status: 'stable' },
  { id: 4, full_name: 'Robert Clarke', age: 74, room: 'Room 305', status: 'recovering' },
  { id: 5, full_name: 'Eleanor Davis', age: 91, room: 'Room 201', status: 'observation' },
  { id: 6, full_name: 'Frank Nguyen', age: 85, room: 'Room 108', status: 'stable' }
];

let allStaff = [];
let allResidents = [];
let editingId = null;
let editingStaffId = null;
let editingResidentId = null;
let usingDemo = false;
let usingDemoResidents = false;
let usingDemoStats = true;
let usingDemoAlerts = true;
let allPendingRegistrations = [];
let usingDemoPending = false;

const DEMO_PENDING = [
  { id: 99, staff_id: 'STF-90001234', full_name: 'Alice Tran', email: 'alice.tran@example.com', role: 'Nurse', created_at: new Date().toISOString(), approval_status: 'pending' },
  { id: 100, staff_id: 'STF-90005678', full_name: 'Ben Okafor', email: 'ben.o@example.com', role: 'Carer', created_at: new Date().toISOString(), approval_status: 'pending' }
];

/* ═══ LOAD STAFF ═════════ */
async function loadStaff() {
  try {
    const r = await fetch(`${API_BASE}/admin/staff`, { headers: authH() });
    if (!r.ok) throw new Error();

    const d = await r.json();
    allStaff = Array.isArray(d) ? d : [];
    usingDemo = false;
  } catch (e) {
    allStaff = DEMO_STAFF.map(s => ({ ...s }));
    usingDemo = true;
  }

  /* Load pending registrations (do not show demo data on 401/403 — that hid real bugs) */
  try {
    const rp = await fetch(`${API_BASE}/admin/staff/pending`, { headers: authH() });
    const pd = await rp.json().catch(() => []);
    if (!rp.ok) {
      allPendingRegistrations = [];
      usingDemoPending = false;
    } else {
      allPendingRegistrations = Array.isArray(pd) ? pd : [];
      usingDemoPending = false;
    }
  } catch (e) {
    allPendingRegistrations = DEMO_PENDING.map(p => ({ ...p }));
    usingDemoPending = true;
  }

  try {
    const rs = await fetch(`${API_BASE}/staff/stats/summary`, { headers: authH() });
    if (rs.ok) {
      const stats = await rs.json();
      document.getElementById('stat-active').textContent = stats.active_staff ?? '–';
      document.getElementById('stat-tasks').textContent = stats.pending_tasks ?? '–';
      document.getElementById('stat-shifts').textContent = stats.shifts_today ?? '–';
      usingDemoStats = false;
    } else {
      throw new Error();
    }
  } catch (e) {
    usingDemoStats = true;
  }

  try {
    const ra = await fetch(`${API_BASE}/alerts/?limit=5&is_read=false`, { headers: authH() });
    if (ra.ok) {
      const alerts = await ra.json();
      if (alerts.length) {
        renderAlertsFromAPI(alerts);
        usingDemoAlerts = false;
      } else {
        throw new Error('empty');
      }
    } else {
      throw new Error();
    }
  } catch (e) {
    usingDemoAlerts = true;
  }

  /* Load residents */
  try {
    const rr = await fetch(`${API_BASE}/admin/residents`, { headers: authH() });
    if (rr.ok) {
      const d = await rr.json();
      if (d.length) {
        allResidents = d;
        usingDemoResidents = false;
      } else {
        throw new Error('empty');
      }
    } else {
      throw new Error();
    }
  } catch (e) {
    allResidents = DEMO_RESIDENTS.map(r => ({ ...r }));
    usingDemoResidents = true;
  }

  renderStaff();
  renderPendingRegistrations();
  renderResidents();

  if (usingDemoStats) renderStats();
  if (usingDemoAlerts) renderAlerts();

  renderTasks();
}

/* ═══ RENDER PENDING REGISTRATIONS ═══ */
function renderPendingRegistrations() {
  const tbody = document.getElementById('pending-reg-tbody');
  if (!tbody) return;

  const pending = allPendingRegistrations.filter(p => String(p.approval_status || '').toLowerCase() === 'pending');
  const badge = document.getElementById('pending-count-badge');

  if (pending.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text3);padding:24px;">No pending registrations</td></tr>';
    if (badge) badge.style.display = 'none';
    return;
  }

  if (badge) {
    badge.style.display = 'inline-block';
    badge.textContent = `${pending.length} pending`;
  }

  tbody.innerHTML = pending.map(p => {
    const date = p.created_at ? new Date(p.created_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
    const sid = esc(p.staff_code || p.staff_id || '');
    const sname = esc(p.full_name || '');
    return `
      <tr>
        <td>
          <div class="staff-name">${sname}</div>
          <div class="staff-id">ID: ${sid}</div>
        </td>
        <td>${esc(p.email || 'N/A')}</td>
        <td>${esc(p.role || 'staff')}</td>
        <td style="font-size:13px;color:var(--text3);">${date}</td>
        <td>
          <div style="display:flex;gap:8px;">
            <button class="action-btn" title="Approve" onclick="approvePendingStaff('${sid}')" style="background:#d4edda;color:#155724;padding:6px 14px;border:none;border-radius:8px;cursor:pointer;font-size:12px;font-weight:600;">
              ✓ Approve
            </button>
            <button class="action-btn" title="Ignore" onclick="ignorePendingStaff('${sid}')" style="background:#f8d7da;color:#721c24;padding:6px 14px;border:none;border-radius:8px;cursor:pointer;font-size:12px;font-weight:600;">
              ✗ Ignore
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

/* ═══ APPROVE / IGNORE PENDING STAFF ═══ */
async function approvePendingStaff(staffId) {
  if (!confirm('Approve this staff member? They will be able to log in.')) return;

  try {
    if (!usingDemoPending) {
      const res = await fetch(`${API_BASE}/admin/staff/${encodeURIComponent(staffId)}/approve`, { method: 'POST', headers: authH() });
      const result = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(result?.detail?.msg || 'Approval failed');
    }
    allPendingRegistrations = allPendingRegistrations.filter(p => (p.staff_code || p.staff_id) !== staffId);
    renderPendingRegistrations();
    await loadStaff();
  } catch (err) {
    console.error('Error approving staff:', err);
    alert('Error approving staff: ' + (err.message || 'Unknown error'));
  }
}

async function ignorePendingStaff(staffId) {
  if (!confirm('Ignore this registration request?')) return;

  try {
    if (!usingDemoPending) {
      const res = await fetch(`${API_BASE}/admin/staff/${encodeURIComponent(staffId)}/reject?reason=Ignored`, { method: 'POST', headers: authH() });
      const result = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(result?.detail?.msg || 'Rejection failed');
    }
    allPendingRegistrations = allPendingRegistrations.filter(p => (p.staff_code || p.staff_id) !== staffId);
    renderPendingRegistrations();
  } catch (err) {
    console.error('Error ignoring staff:', err);
    alert('Error ignoring registration: ' + (err.message || 'Unknown error'));
  }
}

/* ═══ RENDER STAFF TABLE ═══ */
function statusBadge(s) {
  if (s === 'active' || s === 'Active') {
    return `<span class="status-badge status-active">● Active</span>`;
  }
  if (s === 'on_leave' || s === 'On Leave') {
    return `<span class="status-badge status-leave">● On Leave</span>`;
  }
  return `<span class="status-badge status-pending">Pending</span>`;
}

function renderStaff() {
  const tbody = document.getElementById('staff-tbody');
  if (!tbody) return;

  tbody.innerHTML = allStaff.map(s => `
    <tr>
      <td>
        <div class="staff-name">${esc(s.full_name)}</div>
        <div class="staff-id">ID: ${esc(s.staff_code || s.staff_id || '')}</div>
      </td>
      <td>
        <div class="shift-main">${esc(s.shift_time || '')}</div>
        <div class="shift-hours">${esc(s.hours || '8 hours')}</div>
      </td>
      <td>${esc(s.assigned_unit || '')}</td>
      <td>${statusBadge(s.status)}</td>
      <td>
        <button class="action-btn" title="View" onclick="viewStaff(${s.id})">
          <svg viewBox="0 0 24 24">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
            <circle cx="12" cy="12" r="3"/>
          </svg>
        </button>
        <button class="action-btn" title="Edit" onclick="openEdit(${s.id})">
          <svg viewBox="0 0 24 24">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
        </button>
      </td>
    </tr>
  `).join('');

  const total = allStaff.length;
  const countEl = document.getElementById('staff-count');
  if (countEl) {
    countEl.textContent = `Showing ${total} of ${total} staff members`;
  }
}

/* ═══ RENDER RESIDENTS TABLE ═════*/
function residentBadge(s) {
  if (s === 'stable')     return `<span class="status-badge status-active">● Stable</span>`;
  if (s === 'critical')   return `<span class="status-badge status-leave" style="color:#ef4444;">● Critical</span>`;
  if (s === 'recovering') return `<span class="status-badge status-pending" style="color:var(--blue);">● Recovering</span>`;
  return `<span class="status-badge status-pending">● ${esc(s || 'Unknown')}</span>`;
}

function renderResidents() {
  const tbody = document.getElementById('resident-tbody');
  if (!tbody) return;

  tbody.innerHTML = allResidents.map(r => `
    <tr>
      <td>
        <div class="staff-name">${esc(r.full_name)}</div>
      </td>
      <td>${r.age}</td>
      <td>${esc(r.room)}</td>
      <td>${residentBadge(r.status)}</td>
      <td>
        <button class="action-btn" title="Edit" onclick="openEditResident(${r.id})">
          <svg viewBox="0 0 24 24">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
        </button>
        <button class="action-btn" title="Delete" onclick="confirmDeleteResident(${r.id}, '${esc(r.full_name)}')">
          <svg viewBox="0 0 24 24">
            <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
          </svg>
        </button>
      </td>
    </tr>
  `).join('');

  const ct = document.getElementById('resident-count');
  if (ct) ct.textContent = `Showing ${allResidents.length} residents`;

  const stableCount   = allResidents.filter(r => r.status === 'stable').length;
  const criticalCount = allResidents.filter(r => r.status === 'critical').length;
  const totalEl       = document.getElementById('stat-total-residents');
  const stableEl      = document.getElementById('stat-stable');
  const critEl        = document.getElementById('stat-critical');
  if (totalEl)  totalEl.textContent  = allResidents.length;
  if (stableEl) stableEl.textContent = stableCount;
  if (critEl)   critEl.textContent   = criticalCount;
}

/* ═══ RESIDENT CRUD ══════════════════ */
function openEditResident(id) {
  const r = allResidents.find(x => x.id === id);
  if (!r) return;
  editingResidentId = id;
  document.getElementById('edit-res-name').value   = r.full_name || '';
  document.getElementById('edit-res-age').value    = r.age || '';
  document.getElementById('edit-res-room').value   = r.room || '';
  document.getElementById('edit-res-status').value = r.status || 'stable';
  document.getElementById('modal-edit-resident').classList.add('open');
}

async function saveResident() {
  const r = allResidents.find(x => x.id === editingResidentId);
  if (!r) return;
  r.full_name = document.getElementById('edit-res-name').value.trim();
  r.age       = parseInt(document.getElementById('edit-res-age').value) || r.age;
  r.room      = document.getElementById('edit-res-room').value.trim();
  r.status    = document.getElementById('edit-res-status').value;
  try {
    if (!usingDemoResidents) {
      const params = new URLSearchParams({ full_name: r.full_name, age: r.age, room: r.room, status: r.status });
      await fetch(`${API_BASE}/admin/resident/${editingResidentId}?${params}`, { method: 'PATCH', headers: authH() });
    }
  } catch (e) {}
  renderResidents();
  closeEditResident();
}

function confirmDeleteResident(id, name) {
  if (!confirm(`Delete resident ${name}?`)) return;
  deleteResidentById(id);
}

async function deleteResidentById(id) {
  const resId = id || editingResidentId;
  try {
    if (!usingDemoResidents) {
      await fetch(`${API_BASE}/admin/resident/${resId}`, { method: 'DELETE', headers: authH() });
    }
  } catch (e) {}
  allResidents = allResidents.filter(x => x.id !== resId);
  renderResidents();
  closeEditResident();
}

/* ═══ STATS ═══════════════════════════ */
function renderStats() {
  const active = allStaff.filter(s => s.status === 'active' || s.status === 'Active').length;

  document.getElementById('stat-active').textContent = active;
  document.getElementById('stat-tasks').textContent = DEMO_TASKS.filter(t => t.status !== 'done').length;
  document.getElementById('stat-shifts').textContent = allStaff.length;
}

/* ═══ ALERTS ═════════════ */
function renderAlerts() {
  const iconMap = {
    warning: `<svg viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
    critical: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
    info: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`
  };

  const cls = {
    warning: 'ai-amber',
    critical: 'ai-red',
    info: 'ai-blue'
  };

  document.getElementById('alerts-list').innerHTML = DEMO_ALERTS.map(a => `
    <div class="alert-item">
      <div class="alert-icon ${cls[a.level] || 'ai-blue'}">${iconMap[a.level] || iconMap.info}</div>
      <div class="alert-body">
        <div class="alert-ttl">${esc(a.title)}</div>
        <div class="alert-msg">${esc(a.message)}</div>
      </div>
    </div>
  `).join('');
}

/* ═══ ALERTS FROM API ═════*/
function renderAlertsFromAPI(alerts) {
  const iconMap = {
    warning: `<svg viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
    critical: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
    info: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`
  };

  const cls = {
    warning: 'ai-amber',
    critical: 'ai-red',
    info: 'ai-blue'
  };

  document.getElementById('alerts-list').innerHTML = alerts.map(a => `
    <div class="alert-item">
      <div class="alert-icon ${cls[a.level] || 'ai-blue'}">${iconMap[a.level] || iconMap.info}</div>
      <div class="alert-body">
        <div class="alert-ttl">${esc(a.title)}</div>
        <div class="alert-msg">${esc(a.message)}</div>
      </div>
    </div>
  `).join('');
}

/* ═══ TASKS ═ */
function renderTasks() {
  const badgeMap = { overdue: 'tb-overdue', inprogress: 'tb-inprogress', done: 'tb-done' };
  const labelMap = { overdue: 'Overdue', inprogress: 'In Progress', done: 'Done' };

  document.getElementById('task-grid').innerHTML = DEMO_TASKS.map(t => `
    <div class="task-card">
      <div class="task-hdr">
        <div class="task-title">${esc(t.title)}</div>
        <div class="task-badge ${badgeMap[t.status] || 'tb-inprogress'}">${labelMap[t.status] || t.status}</div>
      </div>
      <div class="task-desc">${esc(t.desc)}</div>
      <div class="task-meta">
        <span>👤 ${esc(t.assignee)}</span>
        <span>📅 Due: ${esc(t.due)}</span>
      </div>
    </div>
  `).join('');
}

/* ═══ TABS ════ */
function switchTab(name, btn) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));

  btn.classList.add('active');
  document.getElementById('tab-' + name).classList.add('active');
}

/* ═══ EDIT MODAL ═══ */
function openEdit(id) {
  const s = allStaff.find(x => x.id === id);
  if (!s) return;

  editingId = id;
  editingStaffId = s.staff_code || s.staff_id || '';

  document.getElementById('edit-name').value = s.full_name || '';
  document.getElementById('edit-id').value = s.staff_code || s.staff_id || '';
  document.getElementById('edit-shift').value = s.shift_time || '';
  document.getElementById('edit-unit').value = s.assigned_unit || 'ICU Ward';
  document.getElementById('edit-status').value = s.status === 'on_leave' ? 'on_leave' : s.status === 'pending' ? 'pending' : 'active';
  document.getElementById('edit-role').value = s.role || 'Carer';
  document.getElementById('modal-edit').classList.add('open');
}

function closeModal() {
  document.getElementById('modal-edit').classList.remove('open');
}

async function saveStaff() {
  const s = allStaff.find(x => x.id === editingId);
  if (!s) return;

  s.full_name = document.getElementById('edit-name').value.trim();
  s.shift_time = document.getElementById('edit-shift').value.trim();
  s.assigned_unit = document.getElementById('edit-unit').value;
  s.status = document.getElementById('edit-status').value;
  s.role = document.getElementById('edit-role').value;

  try {
    if (!usingDemo) {
      const params = new URLSearchParams({
        full_name: s.full_name,
        shift_time: s.shift_time,
        assigned_unit: s.assigned_unit,
        status: s.status,
        role: s.role
      });
      await fetch(`${API_BASE}/admin/staff/${encodeURIComponent(editingStaffId)}?${params}`, {
        method: 'PATCH',
        headers: authH()
      });
    }
  } catch (e) {}

  renderStaff();
  renderStats();
  closeModal();
}

async function deleteStaff() {
  if (!confirm('Delete this staff member?')) return;

  try {
    if (!usingDemo) {
      await fetch(`${API_BASE}/admin/staff/${encodeURIComponent(editingStaffId)}`, {
        method: 'DELETE',
        headers: authH()
      });
    }
  } catch (e) {}

  allStaff = allStaff.filter(x => x.id !== editingId);
  renderStaff();
  renderStats();
  closeModal();
}

function viewStaff(id) {
  const s = allStaff.find(x => x.id === id);
  if (!s) return;

  alert(`${s.full_name} (${s.staff_code || s.staff_id})\nUnit: ${s.assigned_unit}\nShift: ${s.shift_time}\nRole: ${s.role}\nStatus: ${s.status}`);
}

/* ═══ EXPORT PDF ═══════════════ */
function exportPDF() {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
  const timeStr = now.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' });
  const adminName = (currentUser && currentUser.full_name) || 'Admin';

  doc.setFillColor(15, 27, 45);
  doc.rect(0, 0, 297, 22, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('Sphere Care — Staff Activity Report', 14, 14);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text(`Generated: ${dateStr} ${timeStr}   |   By: ${adminName}`, 14, 20);
  doc.text('CONFIDENTIAL', 297 - 14, 14, { align: 'right' });

  const active = allStaff.filter(s => s.status === 'active' || s.status === 'Active').length;
  doc.setTextColor(30, 40, 60);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.text(
    `Total Staff: ${allStaff.length}   |   Active: ${active}   |   On Leave: ${allStaff.filter(s => s.status === 'on_leave' || s.status === 'On Leave').length}   |   Pending: ${allStaff.filter(s => s.status === 'pending' || s.status === 'Pending').length}`,
    14,
    30
  );

  doc.autoTable({
    startY: 34,
    head: [['Staff Name', 'Staff ID', 'Shift Time', 'Assigned Unit', 'Role', 'Status']],
    body: allStaff.map(s => [
      s.full_name || '',
      s.staff_id || '',
      s.shift_time || '',
      s.assigned_unit || '',
      s.role || '',
      s.status === 'on_leave' ? 'On Leave' : s.status === 'active' ? 'Active' : s.status === 'pending' ? 'Pending' : s.status || ''
    ]),
    headStyles: { fillColor: [46, 196, 182], textColor: 255, fontStyle: 'bold', fontSize: 10 },
    bodyStyles: { fontSize: 9, textColor: [30, 40, 60] },
    alternateRowStyles: { fillColor: [240, 244, 248] },
    columnStyles: { 0: { fontStyle: 'bold' }, 5: { halign: 'center' } },
    didDrawCell: (data) => {
      if (data.section === 'body' && data.column.index === 5) {
        const val = data.cell.raw;
        let clr = null;

        if (val === 'Active') clr = [34, 197, 94];
        else if (val === 'On Leave') clr = [245, 158, 11];
        else if (val === 'Pending') clr = [148, 163, 184];

        if (clr) {
          doc.setFillColor(...clr);
          const { x, y, width, height } = data.cell;
          doc.roundedRect(x + 2, y + 2, width - 4, height - 4, 2, 2, 'F');
          doc.setTextColor(255, 255, 255);
          doc.setFontSize(8);
          doc.setFont('helvetica', 'bold');
          doc.text(val, x + width / 2, y + height / 2 + 1, { align: 'center' });
        }
      }
    },
    margin: { left: 14, right: 14 }
  });

  const pageCount = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(150, 160, 175);
    doc.text(`Page ${i} of ${pageCount}  |  Sphere Care — AI-Powered Aged Care Platform  |  CONFIDENTIAL`, 14, doc.internal.pageSize.height - 8);
  }

  doc.save(`SphereCarw_Staff_Report_${now.toISOString().slice(0, 10)}.pdf`);
}

/* ══ HELPERS ═══ */
function esc(s) {
  return (s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/* ═══ ADMIN TAB SWITCHING ═══ */
function switchAdminTab(tabId, btn) {
  // Toggle tab buttons
  document.querySelectorAll('.admin-tab-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');

  // Toggle tab content panels
  document.querySelectorAll('.admin-tab-content').forEach(p => p.classList.remove('active'));
  const panel = document.getElementById(tabId);
  if (panel) panel.classList.add('active');

  // Load data for the selected tab
  if (tabId === 'staff-mgmt') {
    loadStaffList();
  } else if (tabId === 'staff-registration') {
    loadRegistrationRequests();
  } else if (tabId === 'staff-approvals') {
    loadPendingStaffApprovals();
  } else if (tabId === 'resident-mgmt') {
    loadResidentsList();
  }
}

/* ═══ PAGE INIT ══ */
async function initAdminConsolePage() {
  try {
    safeShowSkeleton();

    updateClock();
    setInterval(updateClock, 1000);

    // Must gate all data loading: initUser() hides #admin-panel for non-admins — do not override that later.
    const allowed = initUser();
    if (!allowed) {
      safeHideSkeleton();
      return;
    }

    // Keep legacy dashboard loader isolated; this page may not include all legacy widgets.
    try {
      await loadStaff();
    } catch (e) {
      console.warn('Skipping legacy staff dashboard rendering:', e);
    }

    // Ensure admin console data always loads on page init.
    loadPendingStaffApprovals();
    loadRegistrationRequests();
    loadStaffList();

    const defaultTabBtn = document.querySelector('.admin-tab-btn[data-tab="staff-mgmt"]');
    switchAdminTab('staff-mgmt', defaultTabBtn);

    const adminPanel = document.getElementById('admin-panel');
    if (adminPanel) adminPanel.style.display = 'block';
  } catch (e) {
    console.error('Admin console init failed:', e);
  } finally {
    safeHideSkeleton();
  }
}

/* ═══ INIT ════*/
document.addEventListener('DOMContentLoaded', async () => {
  const path = window.location.pathname || '';
  const onAdminConsolePage = path.includes('admin_console');
  const embeddedAdmin = document.getElementById('sec-admin');

  if (embeddedAdmin && !isStaffPortalAdmin()) {
    embeddedAdmin.style.display = 'none';
    return;
  }

  if (onAdminConsolePage && !isStaffPortalAdmin()) {
    initUser();
    const sk = document.getElementById('page-skeleton');
    if (sk) sk.style.display = 'none';
    return;
  }

  if (!onAdminConsolePage && !embeddedAdmin) {
    return;
  }

  await initAdminConsolePage();
});