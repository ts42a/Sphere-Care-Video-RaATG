// API BASE URL – change this to your server
// ──────────────────────────────────────────
const API_BASE = '/api/v1';

// Migrate spherecare_* sessionStorage keys to the format all pages expect
(function migrateAuth() {
  const accessToken = sessionStorage.getItem('access_token');
  const legacyToken = sessionStorage.getItem('spherecare_token');

  if (!accessToken && legacyToken) {
    sessionStorage.setItem('access_token', legacyToken);
  }
  if (accessToken && legacyToken !== accessToken) {
    sessionStorage.setItem('spherecare_token', accessToken);
  }

  if (!sessionStorage.getItem('user') && sessionStorage.getItem('spherecare_role')) {
    sessionStorage.setItem('user', JSON.stringify({
      full_name: sessionStorage.getItem('spherecare_user_name') || '',
      email: sessionStorage.getItem('spherecare_user_email') || '',
      role: sessionStorage.getItem('spherecare_role') || 'staff'
    }));
  }

  // Normalise stored user: ensure 'role' is always set from 'global_role'
  try {
    const stored = JSON.parse(sessionStorage.getItem('user') || '{}');
    if (stored.global_role && !stored.role) {
      stored.role = stored.global_role;
      sessionStorage.setItem('user', JSON.stringify(stored));
    }
  } catch (_) {}
})();

// ── Auth guard: redirect to login if no session (runs on every page) ──
(function authGuard() {
  const isLoginPage = window.location.pathname.includes('register-login');
  const token = sessionStorage.getItem('access_token') || sessionStorage.getItem('spherecare_token');
  if (!isLoginPage && !token) {
    window.location.href = '/pages/register-login.html';
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
    sessionStorage.setItem('access_token', data.access_token);
    if (data.user) data.user.role = data.user.role || data.user.global_role || 'staff';
    sessionStorage.setItem('user', JSON.stringify(data.user));
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

    sessionStorage.setItem('access_token', data.access_token);
    if (data.user) data.user.role = data.user.role || data.user.global_role || 'staff';
    sessionStorage.setItem('user', JSON.stringify(data.user));
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
    sessionStorage.setItem('access_token', token);
    // Fetch user info then redirect to dashboard
    fetch('/api/v1/auth/me', {
      headers: { 'Authorization': `Bearer ${token}` }
    })
    .then(r => r.json())
    .then(user => {
      sessionStorage.setItem('user', JSON.stringify(user));
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
  const user = JSON.parse(sessionStorage.getItem('user') || '{}');
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
  sessionStorage.removeItem('access_token');
  sessionStorage.removeItem('user');
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

// ── Global incoming-call + active-call system (active on every page) ─────
(function () {
  if (window.location.pathname.includes('register-login')) return;

  var _proto = location.protocol === 'https:' ? 'wss' : 'ws';
  var _callWs, _pendingCallId, _pendingCallerName;

  // ── Active call state ─────────────────────────────────────────────────
  var _gsc = { callId: null, muted: false, timerInt: null, seconds: 0, lkRoom: null };

  function _callAuthH() {
    var t = sessionStorage.getItem('access_token') || '';
    return { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + t };
  }

  // ── WebSocket ─────────────────────────────────────────────────────────
  function _connectCallWs() {
    var t = sessionStorage.getItem('access_token') || '';
    if (!t) { console.warn('[call-ws] no token, skipping WS'); return; }
    _callWs = new WebSocket(_proto + '://' + location.host + '/ws?token=' + encodeURIComponent(t));
    _callWs.onopen  = function () { console.log('[call-ws] connected'); };
    _callWs.onclose = function () { console.log('[call-ws] closed, reconnecting…'); setTimeout(_connectCallWs, 3000); };
    _callWs.onerror = function (e) { console.error('[call-ws] error', e); };
    _callWs.onmessage = function (e) {
      var msg; try { msg = JSON.parse(e.data); } catch (_) { return; }
      console.log('[call-ws] message', msg.type);
      if (msg.type === 'call.invite')  _gShowCall(msg);
      if (msg.type === 'call.canceled' || msg.type === 'call.timeout') _gDismissCall(msg.call_id);
      if (msg.type === 'call.ended'   || msg.type === 'call.declined') {
        if (_gsc.callId && String(msg.call_id) === String(_gsc.callId)) _gscEndCall(false);
      }
    };
  }

  // ── Incoming call overlay ─────────────────────────────────────────────
  function _gShowCall(msg) {
    _pendingCallId    = msg.call_id;
    _pendingCallerName = msg.caller_name || ('User #' + msg.caller_user_id);
    var old = document.getElementById('_g_call_overlay');
    if (old) old.remove();

    var ov = document.createElement('div');
    ov.id = '_g_call_overlay';
    ov.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.6);';

    var icon = msg.kind === 'video' ? '📹' : '📞';
    ov.innerHTML =
      '<div style="background:#1e2025;border-radius:20px;padding:32px 28px;min-width:300px;text-align:center;color:#fff;">' +
        '<div style="font-size:48px;margin-bottom:16px;">' + icon + '</div>' +
        '<div style="font-size:18px;font-weight:800;margin-bottom:6px;">Incoming ' + (msg.kind || 'Audio') + ' Call</div>' +
        '<div style="font-size:13px;color:rgba(255,255,255,0.6);margin-bottom:28px;">from ' + _pendingCallerName + '</div>' +
        '<div style="display:flex;gap:16px;justify-content:center;">' +
          '<button id="_g_decline_btn" style="width:56px;height:56px;border-radius:50%;background:#ef4444;border:none;cursor:pointer;font-size:24px;" title="Decline">📵</button>' +
          '<button id="_g_accept_btn"  style="width:56px;height:56px;border-radius:50%;background:#22c55e;border:none;cursor:pointer;font-size:24px;" title="Accept">📞</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(ov);
    document.getElementById('_g_accept_btn').onclick  = function () { _gAcceptCall(msg.call_id, msg.kind); };
    document.getElementById('_g_decline_btn').onclick = function () { _gDeclineCall(msg.call_id); };
    setTimeout(function () { _gDismissCall(msg.call_id); }, 62000);
  }

  function _gDismissCall(callId) {
    if (callId && _pendingCallId && String(_pendingCallId) !== String(callId)) return;
    var el = document.getElementById('_g_call_overlay');
    if (el) el.remove();
    _pendingCallId = null;
  }

  // ── Accept / decline ──────────────────────────────────────────────────
  async function _gAcceptCall(callId, kind) {
    _gDismissCall(callId);
    try {
      var r = await fetch(API_BASE + '/calls/' + callId + '/accept', {
        method: 'POST', headers: _callAuthH()
      });
      if (!r.ok) { console.error('[call-ws] accept failed', r.status); return; }
      var data = await r.json();
      _gscShowActive(_pendingCallerName || 'Caller', callId);
      if (data.join_payload && data.join_payload.access_token) {
        _gscLkConnect(data.join_payload.livekit_url, data.join_payload.access_token);
      }
    } catch (e) { console.error('[call-ws] accept error', e); }
  }

  async function _gDeclineCall(callId) {
    _gDismissCall(callId);
    try {
      await fetch(API_BASE + '/calls/' + callId + '/decline', {
        method: 'POST', headers: _callAuthH()
      });
    } catch (_) {}
  }

  // ── Active call overlay ───────────────────────────────────────────────
  function _gscShowActive(name, callId) {
    _gsc.callId  = callId;
    _gsc.seconds = 0;
    _gsc.muted   = false;

    if (!document.getElementById('_g_active_call_style')) {
      var st = document.createElement('style');
      st.id = '_g_active_call_style';
      st.textContent = '@keyframes _gsc_ring{0%{transform:scale(1);opacity:1;}100%{transform:scale(1.5);opacity:0;}}';
      document.head.appendChild(st);
    }

    var old = document.getElementById('_g_active_call_overlay');
    if (old) old.remove();

    var ini = (name || '?').split(' ').map(function (w) { return w[0] || ''; }).join('').toUpperCase().slice(0, 2);
    var ov = document.createElement('div');
    ov.id = '_g_active_call_overlay';
    ov.style.cssText = 'position:fixed;inset:0;z-index:2147483646;display:flex;flex-direction:column;align-items:center;justify-content:center;background:radial-gradient(circle at 50% 40%,#38bdf833 0%,#0f172a 70%);';
    ov.innerHTML =
      '<div style="position:relative;width:120px;height:120px;margin-bottom:20px;">' +
        '<div style="position:absolute;inset:-24px;border-radius:50%;border:2px solid rgba(56,189,248,0.15);animation:_gsc_ring 2s ease-out infinite;"></div>' +
        '<div style="position:absolute;inset:-12px;border-radius:50%;border:2px solid rgba(56,189,248,0.25);animation:_gsc_ring 2s ease-out .4s infinite;"></div>' +
        '<div style="width:120px;height:120px;border-radius:50%;background:linear-gradient(135deg,#38BDF8,#6366F1);display:flex;align-items:center;justify-content:center;font-size:40px;font-weight:800;color:#fff;">' + ini + '</div>' +
      '</div>' +
      '<div style="font-size:20px;font-weight:800;color:#fff;margin-bottom:6px;">' + (name || '') + '</div>' +
      '<div style="font-size:13px;color:rgba(255,255,255,0.5);margin-bottom:4px;">Connected</div>' +
      '<div id="_gsc_timer" style="font-size:28px;font-weight:700;color:#38BDF8;letter-spacing:2px;margin-bottom:32px;font-variant-numeric:tabular-nums;">0:00</div>' +
      '<div style="display:flex;align-items:center;gap:20px;">' +
        '<button id="_gsc_mute_btn" onclick="_gscToggleMute()" style="width:56px;height:56px;border-radius:50%;background:rgba(255,255,255,0.12);border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;">' +
          '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>' +
        '</button>' +
        '<button onclick="_gscEndCall(true)" style="width:68px;height:68px;border-radius:50%;background:#ef4444;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;">' +
          '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="transform:rotate(135deg)"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.6 1.18h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.77a16 16 0 0 0 6 6l.93-.93a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7a2 2 0 0 1 1.72 2.03z"/></svg>' +
        '</button>' +
      '</div>';

    document.body.appendChild(ov);

    clearInterval(_gsc.timerInt);
    _gsc.timerInt = setInterval(function () {
      _gsc.seconds++;
      var m = Math.floor(_gsc.seconds / 60), s = _gsc.seconds % 60;
      var el = document.getElementById('_gsc_timer');
      if (el) el.textContent = m + ':' + (s < 10 ? '0' : '') + s;
    }, 1000);
  }

  window._gscToggleMute = function () {
    _gsc.muted = !_gsc.muted;
    if (_gsc.lkRoom) try { _gsc.lkRoom.localParticipant.setMicrophoneEnabled(!_gsc.muted); } catch (_) {}
    var btn = document.getElementById('_gsc_mute_btn');
    if (btn) btn.style.background = _gsc.muted ? '#f59e0b' : 'rgba(255,255,255,0.12)';
  };

  window._gscEndCall = async function (sendApi) {
    clearInterval(_gsc.timerInt);
    var cid = _gsc.callId;
    _gsc.callId = null; _gsc.muted = false; _gsc.seconds = 0;
    var ov = document.getElementById('_g_active_call_overlay');
    if (ov) ov.remove();
    var ae = document.getElementById('_gsc_lk_audio');
    if (ae) ae.remove();
    if (_gsc.lkRoom) { try { _gsc.lkRoom.disconnect(); } catch (_) {} _gsc.lkRoom = null; }
    if (sendApi && cid) {
      try { await fetch(API_BASE + '/calls/' + cid + '/end', { method: 'POST', headers: _callAuthH() }); } catch (_) {}
    }
  };

  async function _gscLkConnect(lkUrl, lkToken) {
    if (!lkUrl || !lkToken) return;
    if (typeof LivekitClient === 'undefined') return;
    try {
      var room = new LivekitClient.Room({ adaptiveStream: true, dynacast: true });
      _gsc.lkRoom = room;
      room.on(LivekitClient.RoomEvent.TrackSubscribed, function (track) {
        if (track.kind === LivekitClient.Track.Kind.Audio) {
          var el = track.attach();
          el.id = '_gsc_lk_audio';
          document.body.appendChild(el);
        }
      });
      room.on(LivekitClient.RoomEvent.ParticipantDisconnected, function () {
        if (_gsc.callId) { _gscEndCall(false); }
      });
      await room.connect(lkUrl, lkToken);
      await room.localParticipant.setMicrophoneEnabled(true);
    } catch (e) { console.warn('[call-ws] LiveKit connect failed:', e); }
  }

  _connectCallWs();
}());