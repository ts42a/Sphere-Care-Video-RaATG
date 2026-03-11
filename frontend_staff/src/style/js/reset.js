const API_BASE_RESET = 'http://localhost:8000';

function openForgotModal(){
  document.getElementById('forgot-email').value = '';
  document.getElementById('forgot-msg').style.display = 'none';
  document.getElementById('btn-forgot-submit').disabled = false;
  document.getElementById('btn-forgot-submit').textContent = 'Send Reset Link';
  document.getElementById('modal-forgot').style.display = 'flex';
}
function closeForgotModal(){
  document.getElementById('modal-forgot').style.display = 'none';
}

async function submitForgotPassword(){
  const email = document.getElementById('forgot-email').value.trim();
  const btn   = document.getElementById('btn-forgot-submit');
  if(!email){ showResetMsg('forgot','Please enter your email.','error'); return; }
  btn.disabled = true; btn.textContent = 'Sending…';
  try {
    await fetch(`${API_BASE_RESET}/auth/forgot-password`,{
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({email})
    });
    showResetMsg('forgot','✓ Reset link sent! Check your inbox.','success');
    btn.textContent = 'Sent!';
    setTimeout(closeForgotModal, 3000);
  } catch(e){
    showResetMsg('forgot','Network error. Please try again.','error');
    btn.disabled = false; btn.textContent = 'Send Reset Link';
  }
}

function openResetModal(){
  document.getElementById('reset-pass1').value = '';
  document.getElementById('reset-pass2').value = '';
  document.getElementById('reset-msg').style.display = 'none';
  document.getElementById('modal-reset').style.display = 'flex';
}

async function submitResetPassword(){
  const pass1  = document.getElementById('reset-pass1').value;
  const pass2  = document.getElementById('reset-pass2').value;
  const btn    = document.getElementById('btn-reset-submit');
  const token  = new URLSearchParams(window.location.search).get('reset_token');
  if(!pass1||!pass2){ showResetMsg('reset','Please fill in both fields.','error'); return; }
  if(pass1!==pass2) { showResetMsg('reset','Passwords do not match.','error'); return; }
  if(pass1.length<6){ showResetMsg('reset','Password must be at least 6 characters.','error'); return; }
  btn.disabled = true; btn.textContent = 'Resetting…';
  try {
    const res  = await fetch(`${API_BASE_RESET}/auth/reset-password`,{
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({token, new_password: pass1})
    });
    const data = await res.json();
    if(!res.ok){ showResetMsg('reset', data.detail||'Failed.','error'); btn.disabled=false; btn.textContent='Reset Password'; return; }
    showResetMsg('reset','✓ Password reset! Redirecting to login…','success');
    setTimeout(()=>{
      document.getElementById('modal-reset').style.display = 'none';
      window.history.replaceState({},'',window.location.pathname);
      showPage('login');
    }, 2000);
  } catch(e){
    showResetMsg('reset','Network error. Please try again.','error');
    btn.disabled=false; btn.textContent='Reset Password';
  }
}

function showResetMsg(form, msg, type){
  const el = document.getElementById(`${form}-msg`);
  el.textContent = msg; el.style.display = 'block';
  el.style.background = type==='success'?'#f0fdf4':'#fef2f2';
  el.style.color      = type==='success'?'#15803d':'#ef4444';
}

// Auto-open reset modal if ?reset_token= in URL
(function(){
  if(new URLSearchParams(window.location.search).get('reset_token')){
    showPage('login');
    openResetModal();
  }
})();