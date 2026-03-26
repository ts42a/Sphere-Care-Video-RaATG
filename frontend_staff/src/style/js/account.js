/* ============================================================
   account.js  –  Sphere Care Staff Portal – Account Page
   NOTE: API_BASE is declared in script.js — not redeclared here.
   Wrapped in IIFE to avoid scope conflicts with script.js globals.
   ============================================================ */
(function () {
  'use strict';

  // ── helpers ──────────────────────────────────────────────────

  function getToken() {
    return sessionStorage.getItem('access_token') || sessionStorage.getItem('spherecare_token') || '';
  }

  function apiFetch(path, opts) {
    return fetch(API_BASE + path, Object.assign({
      headers: { 'Authorization': 'Bearer ' + getToken(), 'Content-Type': 'application/json' }
    }, opts));
  }

  function makeInitials(name) {
    if (!name) return '?';
    return name.trim().split(/\s+/).map(w => w[0].toUpperCase()).slice(0, 2).join('');
  }

  function setAvatar(text) {
    const hero = document.getElementById('account-hero-avatar');
    const nav  = document.getElementById('user-avatar');
    if (hero) hero.textContent = text;
    if (nav)  nav.textContent  = text;
  }

  function setMeta(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = (value !== null && value !== undefined && value !== '') ? value : '—';
  }

  function showRowIf(rowId, condition) {
    const row = document.getElementById(rowId);
    if (row) row.style.display = condition ? '' : 'none';
  }

  function showMsg(id, text, isError) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent   = text;
    el.className     = 'form-msg ' + (isError ? 'error' : 'success');
    el.style.display = text ? 'block' : 'none';
  }

  function setVal(id, val) {
    const el = document.getElementById(id);
    if (el) el.value = (val !== null && val !== undefined) ? val : '';
  }

  // ── load profile ──────────────────────────────────────────────

  async function loadProfile() {
    if (!getToken()) { window.location.href = '/pages/register-login.html'; return; }

    let data;
    try {
      const res = await apiFetch('/auth/me');
      if (res.status === 401) { doLogout(); return; }
      if (!res.ok) throw new Error(await res.text());
      data = await res.json();
    } catch (e) {
      console.error('loadProfile error', e);
      setMeta('display-name', 'Error loading profile');
      return;
    }

    // Normalise: backend returns global_role, frontend expects role
    if (!data.role && data.global_role) data.role = data.global_role;

    // ── sidebar card ──
    const avt = makeInitials(data.full_name);
    setAvatar(avt);
    setMeta('display-name',  data.full_name);
    setMeta('display-email', data.email);

    const roleLabel = (data.role || 'user').charAt(0).toUpperCase() + (data.role || 'user').slice(1);
    const badge = document.getElementById('display-role-badge');
    if (badge) {
      badge.textContent = roleLabel;
      badge.className   = 'role-badge role-' + (data.role || 'user');
    }

    // Account ID
    let accountLabel;
    if (data.role === 'admin') {
      accountLabel = data.unique_code ? 'ADM-' + data.unique_code : '#' + data.id;
    } else {
      accountLabel = data.unique_code ? 'STF-' + data.unique_code : '#' + data.id;
    }
    setMeta('display-account-id', accountLabel);

    // Center ID (admin only) — must be organization code (CTR-<org>), not ADM-<admin>
    if (data.role === 'admin') {
      if (data.center_id) {
        setMeta('display-center-id', data.center_id);
        showRowIf('row-center-id', true);
      } else {
        setMeta('display-center-id', '—');
        showRowIf('row-center-id', true);
      }
    } else {
      showRowIf('row-center-id', false);
    }

    // Centre Name
    if (data.organization_name) {
      setMeta('display-center-name', data.organization_name);
      showRowIf('row-center-name', true);
    } else {
      showRowIf('row-center-name', false);
    }

    // Joined date
    if (data.created_at) {
      const d = new Date(data.created_at);
      setMeta('display-joined', d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }));
    }

    // Nav username
    const navName = document.getElementById('user-name');
    if (navName) navName.textContent = data.full_name || 'Account';

    // ── profile form ──
    setVal('full_name', data.full_name);
    setVal('email',     data.email);
    setVal('phone',     data.phone);
    setVal('role',      roleLabel);

    // ── preferences from localStorage ──
    const loadToggle = (id, key) => {
      const el = document.getElementById(id);
      if (el) el.checked = localStorage.getItem(key) !== 'false';
    };
    loadToggle('email_notifications', 'pref_email_notif');
    loadToggle('push_notifications',  'pref_push_notif');
    loadToggle('dark_mode',           'pref_dark_mode');
  }

  // ── profile form ──────────────────────────────────────────────

  function initProfileForm() {
    const form = document.getElementById('profile-form');
    if (!form) return;

    document.getElementById('reload-profile-btn')?.addEventListener('click', () => {
      loadProfile();
      showMsg('profile-msg', '', false);
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const payload  = {};
      const fullName = document.getElementById('full_name')?.value.trim();
      const email    = document.getElementById('email')?.value.trim();
      const phone    = document.getElementById('phone')?.value.trim();

      if (fullName) payload.full_name = fullName;
      if (email)    payload.email     = email;
      payload.phone = phone || '';

      try {
        const res  = await apiFetch('/auth/me', { method: 'PATCH', body: JSON.stringify(payload) });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          showMsg('profile-msg', body?.detail?.msg || body?.detail || 'Update failed.', true);
          return;
        }
        showMsg('profile-msg', 'Profile updated successfully.', false);
        if (body.full_name) {
          setMeta('display-name', body.full_name);
          setAvatar(makeInitials(body.full_name));
          const navName = document.getElementById('user-name');
          if (navName) navName.textContent = body.full_name;
        }
        if (body.email) setMeta('display-email', body.email);
      } catch {
        showMsg('profile-msg', 'Network error. Please try again.', true);
      }
    });
  }

  // ── change password & OTP ──────────────────────────────────────

  function initPasswordForm() {
    const step1      = document.getElementById('pwd-step-1');
    const step2      = document.getElementById('pwd-step-2');
    const requestBtn = document.getElementById('request-otp-btn');
    const cancelBtn  = document.getElementById('cancel-pwd-btn');
    const confirmBtn = document.getElementById('confirm-pwd-btn');

    if (!requestBtn) return;

    requestBtn.addEventListener('click', async () => {
      requestBtn.disabled    = true;
      requestBtn.textContent = 'Sending…';
      showMsg('pwd-msg', '', false);

      try {
        const res  = await apiFetch('/auth/request-otp', { method: 'POST' });
        const body = await res.json().catch(() => ({}));

        if (!res.ok) {
          showMsg('pwd-msg', body?.detail?.msg || body?.detail || 'Could not send OTP.', true);
          requestBtn.disabled    = false;
          requestBtn.textContent = 'Send Verification Code';
          return;
        }

        const hint   = body.email_hint || '';
        const hintEl = document.getElementById('otp-email-hint');
        if (hintEl) hintEl.textContent = hint ? 'OTP sent to ' + hint : 'your email';

        if (step1) step1.style.display = 'none';
        if (step2) step2.style.display = 'block';
        document.getElementById('otp0')?.focus();
      } catch {
        showMsg('pwd-msg', 'Network error. Please try again.', true);
        requestBtn.disabled    = false;
        requestBtn.textContent = 'Send Verification Code';
      }
    });

    cancelBtn?.addEventListener('click', () => {
      if (step2) step2.style.display = 'none';
      if (step1) step1.style.display = 'block';
      requestBtn.disabled    = false;
      requestBtn.textContent = 'Send Verification Code';
      clearPwdFields();
      showMsg('pwd-msg', '', false);
    });

    confirmBtn?.addEventListener('click', async () => {
      const otp = collectOtp();
      if (otp.length !== 6) { showMsg('pwd-msg', 'Please enter the full 6-digit OTP.', true); return; }

      const currentPwd = document.getElementById('current_password')?.value;
      const newPwd     = document.getElementById('new_password')?.value;
      const confirmPwd = document.getElementById('confirm_password')?.value;

      if (!currentPwd)               { showMsg('pwd-msg', 'Please enter your current password.',           true); return; }
      if (!newPwd || newPwd.length < 8) { showMsg('pwd-msg', 'New password must be at least 8 characters.', true); return; }
      if (newPwd !== confirmPwd)     { showMsg('pwd-msg', 'Passwords do not match.',                       true); return; }

      confirmBtn.disabled    = true;
      confirmBtn.textContent = 'Changing…';

      try {
        const res  = await apiFetch('/auth/change-password', {
          method: 'POST',
          body: JSON.stringify({ current_password: currentPwd, new_password: newPwd, otp_code: otp })
        });
        const body = await res.json().catch(() => ({}));

        if (!res.ok) {
          showMsg('pwd-msg', body?.detail?.msg || body?.detail || 'Change failed.', true);
          confirmBtn.disabled    = false;
          confirmBtn.textContent = 'Confirm Change';
          return;
        }

        showMsg('pwd-msg', 'Password changed successfully!', false);
        clearPwdFields();
        if (step2) step2.style.display = 'none';
        if (step1) step1.style.display = 'block';
        requestBtn.disabled    = false;
        requestBtn.textContent = 'Send Verification Code';
      } catch {
        showMsg('pwd-msg', 'Network error. Please try again.', true);
        confirmBtn.disabled    = false;
        confirmBtn.textContent = 'Confirm Change';
      }
    });
  }

  function collectOtp() {
    return [0,1,2,3,4,5].map(i => {
      const el = document.getElementById('otp' + i);
      return el ? el.value.trim() : '';
    }).join('');
  }

  function clearPwdFields() {
    [0,1,2,3,4,5].forEach(i => { const el = document.getElementById('otp' + i); if (el) el.value = ''; });
    ['current_password','new_password','confirm_password'].forEach(id => {
      const el = document.getElementById(id); if (el) el.value = '';
    });
    const bar = document.getElementById('pwd-bar');
    if (bar) { bar.style.width = '0%'; bar.style.background = ''; }
  }

  // ── OTP box auto-advance ──────────────────────────────────────

  function initOtpBoxes() {
    const boxes = [0,1,2,3,4,5].map(i => document.getElementById('otp' + i)).filter(Boolean);

    boxes.forEach((box, idx) => {
      box.addEventListener('input', () => {
        const val = box.value.replace(/\D/g, '');
        box.value = val.slice(-1);
        if (val && idx < boxes.length - 1) boxes[idx + 1].focus();
      });
      box.addEventListener('keydown', e => {
        if (e.key === 'Backspace' && !box.value && idx > 0) boxes[idx - 1].focus();
      });
      box.addEventListener('paste', e => {
        e.preventDefault();
        const pasted = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g,'');
        pasted.split('').forEach((ch, i) => { if (boxes[idx + i]) boxes[idx + i].value = ch; });
        const nextEmpty = boxes.findIndex((b, i) => i >= idx && !b.value);
        if (nextEmpty !== -1) boxes[nextEmpty].focus();
      });
    });
  }

  // ── password strength bar ─────────────────────────────────────

  function initPwdStrength() {
    const input = document.getElementById('new_password');
    const bar   = document.getElementById('pwd-bar');
    if (!input || !bar) return;

    const colors = ['', '#FC8181', '#F6AD55', '#68D391', '#38A169'];
    const widths = ['0%', '25%', '50%', '75%', '100%'];

    input.addEventListener('input', () => {
      const v = input.value;
      let score = 0;
      if (v.length >= 8)           score++;
      if (/[A-Z]/.test(v))         score++;
      if (/[0-9]/.test(v))         score++;
      if (/[^A-Za-z0-9]/.test(v)) score++;
      bar.style.width      = widths[score];
      bar.style.background = colors[score];
    });
  }

  // ── preferences (localStorage) ───────────────────────────────

  function initPreferences() {
    const btn = document.getElementById('save-prefs-btn');
    if (!btn) return;

    btn.addEventListener('click', () => {
      const save = (id, key) => {
        const el = document.getElementById(id);
        if (el) localStorage.setItem(key, el.checked ? 'true' : 'false');
      };
      save('email_notifications', 'pref_email_notif');
      save('push_notifications',  'pref_push_notif');
      save('dark_mode',           'pref_dark_mode');

      const dark = localStorage.getItem('pref_dark_mode') !== 'false';
      document.body.classList.toggle('dark', dark);

      showMsg('prefs-msg', 'Preferences saved.', false);
    });
  }

  // ── logout ────────────────────────────────────────────────────

  function doLogout() {
    ['access_token','spherecare_token','user','role','admin_id',
     'spherecare_role','spherecare_user_name','spherecare_user_email'].forEach(k => sessionStorage.removeItem(k));
    Object.keys(localStorage)
      .filter(k => k.startsWith('spherecare_') || k.startsWith('pref_'))
      .forEach(k => localStorage.removeItem(k));
    window.location.href = '/pages/register-login.html';
  }

  function initLogout() {
    document.getElementById('logout-btn')?.addEventListener('click', doLogout);
  }

  // ── init ──────────────────────────────────────────────────────

  document.addEventListener('DOMContentLoaded', () => {
    loadProfile();
    initProfileForm();
    initPasswordForm();
    initOtpBoxes();
    initPwdStrength();
    initPreferences();
    initLogout();
  });

})(); // end IIFE

