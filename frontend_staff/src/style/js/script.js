// ──────────────────────────────────────────
// API BASE URL – change this to your server
// ──────────────────────────────────────────
const API_BASE = 'http://localhost:8000';

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
    window.location.href = 'dashboard.html';

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

// ── HANDLE ?error=oauth_failed on page load ──
(function handleOAuthError() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('error') === 'oauth_failed') {
    const el = document.getElementById('login-error');
    if (el) {
      el.textContent = 'Google login failed. Please try again.';
      el.style.display = 'block';
    }
  }
})();