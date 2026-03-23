// API BASE URL – change this to your server
// ──────────────────────────────────────────
const API_BASE = '/api/v1';

// Migrate spherecare_* localStorage keys to the format all pages expect
(function migrateAuth() {
  if (!localStorage.getItem('access_token') && localStorage.getItem('spherecare_token')) {
    localStorage.setItem('access_token', localStorage.getItem('spherecare_token'));
  }
  if (!localStorage.getItem('user') && localStorage.getItem('spherecare_role')) {
    localStorage.setItem('user', JSON.stringify({
      full_name: localStorage.getItem('spherecare_user_name') || '',
      email: localStorage.getItem('spherecare_user_email') || '',
      role: localStorage.getItem('spherecare_role') || 'staff'
    }));
  }
})();

// ──────────────────────────────────────────
// REGISTER
// ──────────────────────────────────────────
async function handleRegister() {
  const fullName   = document.getElementById('reg-fullname').value.trim();
  const email      = document.getElementById('reg-email').value.trim();
  const emailConf  = document.getElementById('reg-email-conf').value.trim();
  const password   = document.getElementById('reg-pass').value;
  const password2  = document.getElementById('reg-pass2').value;
  const role       = document.getElementById('btn-admin').classList.contains('active') ? 'admin' : 'staff';

  // client-side checks
  if (!fullName || !email || !emailConf || !password || !password2) {
    showError('register', 'Please fill in all fields.');
    return;
  }
  if (email !== emailConf) {
    showError('register', 'Emails do not match.');
    return;
  }
  if (password !== password2) {
    showError('register', 'Passwords do not match.');
    return;
  }

  setLoading('btn-register', true);
  clearError('register');

  try {
    const res = await fetch(`${API_BASE}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        full_name:          fullName,
        email:              email,
        email_confirmation: emailConf,
        password:           password,
        retype_password:    password2,
        role:               role
      })
    });

    const data = await res.json();

    if (!res.ok) {
      showError('register', data.detail || 'Registration failed.');
      return;
    }

    // store token and redirect
    localStorage.setItem('access_token', data.access_token);
    localStorage.setItem('user', JSON.stringify(data.user));
    showPage('login');

  } catch (err) {
    showError('register', 'Network error. Please try again.');
  } finally {
    setLoading('btn-register', false);
  }
}

// ──────────────────────────────────────────
// LOGIN
// ──────────────────────────────────────────
async function handleLogin() {
  const email    = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-pass').value;

  if (!email || !password) {
    showError('login', 'Please enter your email and password.');
    return;
  }

  setLoading('btn-login', true);
  clearError('login');

  try {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });

    const data = await res.json();

    if (!res.ok) {
      showError('login', data.detail || 'Login failed.');
      return;
    }

    localStorage.setItem('access_token', data.access_token);
    localStorage.setItem('user', JSON.stringify(data.user));
    window.location.href = '/pages/dashboard.html';

  } catch (err) {
    showError('login', 'Network error. Please try again.');
  } finally {
    setLoading('btn-login', false);
  }
}

// ──────────────────────────────────────────
// HELPERS
// ──────────────────────────────────────────
function showError(form, msg) {
  const el = document.getElementById(`${form}-error`);
  if (el) { el.textContent = msg; el.style.display = 'block'; }
}

function clearError(form) {
  const el = document.getElementById(`${form}-error`);
  if (el) { el.textContent = ''; el.style.display = 'none'; }
}

function setLoading(btnId, loading) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  btn.disabled = loading;
  btn.style.opacity = loading ? '0.65' : '1';
  btn.textContent = loading ? 'Please wait…' : btn.dataset.label;
}

function showPage(name) {
  document.querySelectorAll('.page').forEach(page => {
    page.classList.remove('active');
  });

  const targetPage = document.getElementById('page-' + name);
  if (targetPage) {
    targetPage.classList.add('active');
  }
}

window.showPage = showPage;

function setRole(role) {
  const btnStaff = document.getElementById('btn-staff');
  const btnAdmin = document.getElementById('btn-admin');

  if (!btnStaff || !btnAdmin) return;

  if (role === 'staff') {
    btnStaff.classList.add('active');
    btnAdmin.classList.remove('active');
  } else {
    btnAdmin.classList.add('active');
    btnStaff.classList.remove('active');
  }
}

function togglePwd(inputId, eyeElement) {
  const input = document.getElementById(inputId);
  if (!input) return;

  input.type = input.type === 'password' ? 'text' : 'password';

  if (eyeElement) {
    eyeElement.style.opacity = input.type === 'text' ? '0.6' : '1';
  }
}

const labels = {
  dashboard: 'Dashboard',
  recording: 'Recording Console',
  monitoring: 'Live Monitoring',
  records: 'Records Library',
  flags: 'Flags & Reviews',
  residents: 'Residents',
  bookings: 'Bookings',
  staff: 'Staff & Roles',
  admin: 'Admin Console',
  reports: 'Reports / Analytics',
  notifications: 'Notifications',
  messages: 'Messages',
  help: 'Help & Support',
  account: 'Account'
};

function navigate(page, el) {
  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.remove('active');
  });

  if (el) {
    el.classList.add('active');
  }

  const topbarTitle = document.getElementById('topbar-title');
  if (topbarTitle) {
    topbarTitle.textContent = labels[page] || page;
  }

  document.querySelectorAll('.page-section').forEach(section => {
    section.classList.remove('active');
  });

  const targetSection = document.getElementById('sec-' + page);
  if (targetSection) {
    targetSection.classList.add('active');
  }
}

document.addEventListener('DOMContentLoaded', function () {
  const topbarDate = document.getElementById('topbar-date');
  if (topbarDate) {
    const d = new Date();
    topbarDate.textContent = d.toLocaleDateString('en-AU', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });
  }
});
// ── GOOGLE OAUTH ──
function loginWithGoogle() {
  window.location.href = 'http://localhost:8000/auth/google/login';
}

// ── HANDLE OAuth callback: ?token= and ?error= ──
(function handleOAuthCallback() {
  const params = new URLSearchParams(window.location.search);

  // Google login success — token passed back in URL
  const token = params.get('token');
  if (token) {
    localStorage.setItem('access_token', token);
    // Fetch user info then redirect to dashboard
    fetch('/api/v1/auth/me', {
      headers: { 'Authorization': `Bearer ${token}` }
    })
    .then(r => r.json())
    .then(user => {
      localStorage.setItem('user', JSON.stringify(user));
      // Clean URL then redirect
      window.location.replace('/pages/dashboard.html');
    })
    .catch(() => {
      window.location.replace('/pages/dashboard.html');
    });
    return;
  }

  // Google login failed
  if (params.get('error') === 'oauth_failed') {
    showPage('login');
    const el = document.getElementById('login-error');
    if (el) {
      el.textContent = 'Google login failed. Please try again.';
      el.style.display = 'block';
    }
  }
})();
// ──────────────────────────────────────────
// USER AVATAR + LOGOUT DROPDOWN
// ──────────────────────────────────────────

// Inject avatar dropdown into every page that has a topbar avatar
function initUserAvatar() {
  const user = JSON.parse(localStorage.getItem('user') || '{}');
  const name = user.full_name || 'User';
  const role = user.role || 'staff';
  const initials = name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);

  // Find avatar element (works across all pages)
  const avatarEls = document.querySelectorAll('.topbar-avatar, .user-avatar, #user-avatar');
  avatarEls.forEach(el => {
    el.textContent = initials;
    el.style.cursor = 'pointer';
    el.title = name;
    el.onclick = (e) => { e.stopPropagation(); toggleAvatarDropdown(el, name, role); };
  });
}

function toggleAvatarDropdown(avatarEl, name, role) {
  // Remove existing dropdown if open
  const existing = document.getElementById('avatar-dropdown');
  if (existing) { existing.remove(); return; }

  const dropdown = document.createElement('div');
  dropdown.id = 'avatar-dropdown';
  dropdown.style.cssText = `
    position: fixed;
    top: ${avatarEl.getBoundingClientRect().bottom + 8}px;
    right: 16px;
    background: #fff;
    border: 1.5px solid #e2e8f0;
    border-radius: 14px;
    box-shadow: 0 8px 28px rgba(0,0,0,0.12);
    z-index: 9999;
    min-width: 200px;
    padding: 6px;
    font-family: 'Manrope', sans-serif;
  `;

  dropdown.innerHTML = `
    <div style="padding:12px 14px 10px;border-bottom:1px solid #e2e8f0;margin-bottom:4px;">
      <div style="font-size:13.5px;font-weight:800;color:#1a2535;">${name}</div>
      <div style="font-size:12px;color:#9aa0ac;margin-top:2px;text-transform:capitalize;">${role}</div>
    </div>
    <div onclick="window.location.href='account.html'" style="display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:600;color:#1a2535;" onmouseover="this.style.background='#f0f4f8'" onmouseout="this.style.background='transparent'">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
      My Account
    </div>
    <div onclick="handleLogout()" style="display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:600;color:#ef4444;" onmouseover="this.style.background='#fee2e2'" onmouseout="this.style.background='transparent'">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
      Logout
    </div>
  `;

  document.body.appendChild(dropdown);

  // Close when clicking outside
  setTimeout(() => {
    document.addEventListener('click', function closeDropdown() {
      const dd = document.getElementById('avatar-dropdown');
      if (dd) dd.remove();
      document.removeEventListener('click', closeDropdown);
    });
  }, 0);
}

function handleLogout() {
  localStorage.removeItem('access_token');
  localStorage.removeItem('user');
  window.location.href = '/pages/register-login.html';
}

// Auto-init on page load
document.addEventListener('DOMContentLoaded', initUserAvatar);

// ──────────────────────────────────────────
// BOOTSTRAP SKELETON — AUTO HIDE
// ──────────────────────────────────────────
window.hideSkeleton = function () {
  const sk = document.getElementById('page-skeleton');
  if (sk) sk.style.display = 'none';
};

document.addEventListener('DOMContentLoaded', function () {
  // Fallback: hide skeleton after 1.5s if page JS didn't call hideSkeleton()
  setTimeout(window.hideSkeleton, 1500);
});

// KEYBOARD SHORTCUTS
document.addEventListener('keydown', e => {
  if (e.altKey) {
    const map = {
      d: 'dashboard.html',
      b: 'booking.html',
      f: 'flags.html',
      m: 'message.html',
      n: 'notifications.html',
      r: 'residents.html',
    };
    if (map[e.key.toLowerCase()]) {
      e.preventDefault();
      window.location.href = map[e.key.toLowerCase()];
    }
  }
  // Ctrl+K — focus search if available
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
      e.preventDefault();
      searchInput.focus();
    }
  }
});