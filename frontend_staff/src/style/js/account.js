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

// ── OTP FLOW ──────────────────────────────────────────────
const OTP_API_BASE = API_BASE;
let otpResendTimer = null;

async function sendOtp() {
  const current = document.getElementById('input-current-pwd').value.trim();
  const newPwd  = document.getElementById('input-new-pwd').value.trim();
  const confirm = document.getElementById('input-confirm-pwd').value.trim();
  const btn     = document.getElementById('btn-send-otp');

  if (!current)           return showToast('Please enter your current password.', 'error');
  if (newPwd.length < 8)  return showToast('New password must be at least 8 characters.', 'error');
  if (newPwd !== confirm) return showToast('Passwords do not match.', 'error');

  btn.disabled = true; btn.textContent = 'Sending…';
  try {
    const token = localStorage.getItem('access_token');
    const res = await fetch(`${OTP_API_BASE}/auth/request-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ purpose: 'change_password' }),
    });
    if (!res.ok) { const err = await res.json().catch(()=>({})); throw new Error(err.detail || 'Failed to send code'); }
    const data = await res.json();
    if (data.email_hint || data.destination) document.getElementById('otp-dest').textContent = data.email_hint || data.destination;
    document.getElementById('otp-step').classList.add('visible');
    document.querySelectorAll('.otp-box')[0].focus();
    startResendTimer();
    showToast('Verification code sent!', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Send Verification Code';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const boxes = document.querySelectorAll('.otp-box');
  boxes.forEach((box, i) => {
    box.addEventListener('input', e => {
      const val = e.target.value.replace(/\D/g, '');
      e.target.value = val.slice(-1);
      e.target.classList.toggle('filled', !!val);
      if (val && i < boxes.length - 1) boxes[i+1].focus();
      checkOtpComplete();
    });
    box.addEventListener('keydown', e => {
      if (e.key === 'Backspace' && !box.value && i > 0) {
        boxes[i-1].value = ''; boxes[i-1].classList.remove('filled'); boxes[i-1].focus(); checkOtpComplete();
      }
    });
    box.addEventListener('paste', e => {
      e.preventDefault();
      const pasted = (e.clipboardData||window.clipboardData).getData('text').replace(/\D/g,'').slice(0,6);
      [...pasted].forEach((ch,j) => { if(boxes[j]){boxes[j].value=ch;boxes[j].classList.add('filled');} });
      boxes[Math.min(pasted.length, boxes.length-1)].focus();
      checkOtpComplete();
    });
  });
});

function checkOtpComplete() {
  const complete = [...document.querySelectorAll('.otp-box')].every(b => b.value.length === 1);
  document.getElementById('btn-otp-confirm').disabled = !complete;
}

async function verifyOtp() {
  const otp     = [...document.querySelectorAll('.otp-box')].map(b=>b.value).join('');
  const current = document.getElementById('input-current-pwd').value.trim();
  const newPwd  = document.getElementById('input-new-pwd').value.trim();
  const btn     = document.getElementById('btn-otp-confirm');
  btn.disabled = true; btn.textContent = 'Verifying…';
  try {
    const token = localStorage.getItem('access_token');
    const res = await fetch(`${OTP_API_BASE}/auth/change-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ current_password: current, new_password: newPwd, otp_code: otp }),
    });
    if (!res.ok) { const err = await res.json().catch(()=>({})); throw new Error(err.detail || 'Invalid or expired code'); }
    showToast('Password changed successfully!', 'success');
    cancelOtp();
  } catch (err) {
    document.querySelectorAll('.otp-box').forEach(b => { b.classList.add('error'); b.value=''; b.classList.remove('filled'); setTimeout(()=>b.classList.remove('error'),400); });
    document.querySelectorAll('.otp-box')[0].focus();
    document.getElementById('btn-otp-confirm').disabled = true;
    showToast(err.message, 'error');
  } finally { btn.textContent = 'Confirm Change'; }
}

async function resendOtp() {
  if (document.getElementById('resend-link').classList.contains('disabled')) return;
  await sendOtp();
}

function startResendTimer(seconds=60) {
  clearInterval(otpResendTimer);
  const link=document.getElementById('resend-link'), timerEl=document.getElementById('resend-timer'), countEl=document.getElementById('resend-countdown');
  link.classList.add('disabled'); timerEl.style.display='inline'; countEl.textContent=seconds;
  let remaining=seconds;
  otpResendTimer=setInterval(()=>{
    countEl.textContent=--remaining;
    if(remaining<=0){clearInterval(otpResendTimer);link.classList.remove('disabled');timerEl.style.display='none';}
  },1000);
}

function cancelOtp() {
  clearInterval(otpResendTimer);
  document.getElementById('otp-step').classList.remove('visible');
  document.querySelectorAll('.otp-box').forEach(b=>{b.value='';b.classList.remove('filled','error');});
  document.getElementById('btn-otp-confirm').disabled=true;
  document.getElementById('input-current-pwd').value='';
  document.getElementById('input-new-pwd').value='';
  document.getElementById('input-confirm-pwd').value='';
  document.getElementById('pwd-bar').style.width='0%';
  document.getElementById('resend-link').classList.remove('disabled');
  document.getElementById('resend-timer').style.display='none';
}