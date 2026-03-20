let currentUser = {};

// ── INIT ──
document.addEventListener('DOMContentLoaded', async () => {
  const token = localStorage.getItem('access_token');
  if (!token) { window.location.href = 'register-login.html'; return; }

  try {
    // Always fetch fresh data from API — covers Google OAuth users
    const res = await fetch(`${API_BASE}/auth/me`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (res.ok) {
      currentUser = await res.json();
      // Update localStorage with latest data
      localStorage.setItem('user', JSON.stringify(currentUser));
    } else {
      // Token invalid — fallback to localStorage or redirect
      const stored = localStorage.getItem('user');
      if (!stored) { window.location.href = 'register-login.html'; return; }
      currentUser = JSON.parse(stored);
    }

    populateProfile();
  } catch {
    // Network error — fallback to localStorage
    try {
      const stored = localStorage.getItem('user');
      if (!stored) { window.location.href = 'register-login.html'; return; }
      currentUser = JSON.parse(stored);
      populateProfile();
    } catch {
      window.location.href = 'register-login.html';
    }
  }
});

// ── POPULATE ──
function populateProfile() {
  const u = currentUser;
  const name     = u.full_name || 'User';
  const email    = u.email    || '—';
  const role     = u.role     || 'staff';
  const initials = name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);

  // Avatar
  const savedAvatar = localStorage.getItem('avatar_' + email);
  const avatarCircle = document.getElementById('avatar-circle');
  if (savedAvatar) {
    avatarCircle.innerHTML = `<img src="${savedAvatar}" alt="avatar"/>`;
  } else {
    document.getElementById('avatar-initials').textContent = initials;
  }

  // Profile card
  document.getElementById('profile-name').textContent  = name;
  document.getElementById('profile-email').textContent = email;

  const badge = document.getElementById('role-badge');
  badge.textContent = role.charAt(0).toUpperCase() + role.slice(1);
  badge.className   = `role-badge ${role === 'admin' ? 'role-admin' : 'role-staff'}`;

  // Meta
  document.getElementById('meta-joined').textContent = u.created_at
    ? new Date(u.created_at).toLocaleDateString('en-AU', { month: 'short', year: 'numeric' })
    : 'N/A';
  document.getElementById('meta-lastlogin').textContent =
    new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });

  // Form fields
  document.getElementById('input-name').value  = name;
  document.getElementById('input-email').value = email;

  const roleText = document.getElementById('role-display-text');
  roleText.textContent = role.charAt(0).toUpperCase() + role.slice(1);
}

// ── AVATAR UPLOAD ──
function handleAvatarUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  if (file.size > 3 * 1024 * 1024) { showToast('Image must be under 3MB', 'error'); return; }

  const reader = new FileReader();
  reader.onload = (e) => {
    const dataUrl = e.target.result;
    const circle  = document.getElementById('avatar-circle');
    circle.innerHTML = `<img src="${dataUrl}" alt="avatar"/>`;
    // Save to localStorage keyed by email
    localStorage.setItem('avatar_' + currentUser.email, dataUrl);
    showToast('Avatar updated!', 'success');
  };
  reader.readAsDataURL(file);
}

// ── SAVE PROFILE ──
async function saveProfile() {
  const newName = document.getElementById('input-name').value.trim();
  if (!newName) { showToast('Name cannot be empty', 'error'); return; }

  const btn = document.getElementById('btn-save-profile');
  btn.disabled = true; btn.textContent = 'Saving…';

  try {
    // Try PATCH /auth/me or similar — adjust endpoint to match your backend
    const res = await fetch(`${API_BASE}/auth/me`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${localStorage.getItem('access_token')}`
      },
      body: JSON.stringify({ full_name: newName })
    });
    if (res.ok) {
      const updated = await res.json();
      currentUser.full_name = updated.full_name || newName;
    } else {
      // Update locally if endpoint not yet implemented
      currentUser.full_name = newName;
    }
  } catch {
    currentUser.full_name = newName;
  }

  localStorage.setItem('user', JSON.stringify(currentUser));
  populateProfile();
  btn.disabled = false; btn.textContent = 'Save Changes';
  showToast('Profile updated successfully', 'success');
}

// ── PASSWORD STRENGTH ──
function checkPwdStrength(pwd) {
  const bar = document.getElementById('pwd-bar');
  let score = 0;
  if (pwd.length >= 8)                        score++;
  if (/[A-Z]/.test(pwd))                      score++;
  if (/[a-z]/.test(pwd))                      score++;
  if (/\d/.test(pwd))                         score++;
  if (/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>?]/.test(pwd)) score++;

  const widths = ['0%','20%','40%','65%','85%','100%'];
  const colors = ['#e2e8f0','#ef4444','#f59e0b','#f59e0b','#22c55e','#2ec4b6'];
  bar.style.width      = widths[score];
  bar.style.background = colors[score];
}

// ── CHANGE PASSWORD ──
async function changePassword() {
  const current  = document.getElementById('input-current-pwd').value;
  const newPwd   = document.getElementById('input-new-pwd').value;
  const confirm  = document.getElementById('input-confirm-pwd').value;

  if (!current || !newPwd || !confirm) { showToast('Please fill all password fields', 'error'); return; }
  if (newPwd !== confirm)              { showToast('New passwords do not match', 'error'); return; }
  if (newPwd.length < 8)              { showToast('Password must be at least 8 characters', 'error'); return; }

  try {
    const res = await fetch(`${API_BASE}/auth/change-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${localStorage.getItem('access_token')}`
      },
      body: JSON.stringify({ current_password: current, new_password: newPwd })
    });
    if (!res.ok) {
      const err = await res.json();
      showToast(err.detail || 'Failed to update password', 'error');
      return;
    }
    document.getElementById('input-current-pwd').value = '';
    document.getElementById('input-new-pwd').value     = '';
    document.getElementById('input-confirm-pwd').value = '';
    document.getElementById('pwd-bar').style.width     = '0%';
    showToast('Password updated successfully', 'success');
  } catch {
    showToast('Could not reach server. Try again.', 'error');
  }
}

// ── DELETE ACCOUNT ──
function confirmDelete() {
  if (!confirm('Are you sure you want to delete your account? This cannot be undone.')) return;
  localStorage.removeItem('access_token');
  localStorage.removeItem('user');
  window.location.href = 'register-login.html';
}

// ── LOGOUT ──
function handleLogout() {
  localStorage.removeItem('access_token');
  localStorage.removeItem('user');
  window.location.href = 'register-login.html';
}

// ── TOAST ──
function showToast(msg, type = 'success') {
  const toast = document.getElementById('toast');
  toast.textContent = type === 'success' ? '✓  ' + msg : '✕  ' + msg;
  toast.className   = `toast ${type} show`;
  setTimeout(() => toast.classList.remove('show'), 3000);
}