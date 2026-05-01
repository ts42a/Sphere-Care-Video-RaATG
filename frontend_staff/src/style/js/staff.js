let staffData = [];
let editingId = null;
let viewingId = null;
/** When true, roster is view-only (staff users). */
let readOnlyMode = false;
/** Set when API returns an error message to show instead of the table body (e.g. pending approval). */
let staffListNotice = null;

function staffAuthHeaders() {
  const t = sessionStorage.getItem('access_token') || sessionStorage.getItem('spherecare_token');
  const h = { 'Content-Type': 'application/json' };
  if (t) h['Authorization'] = 'Bearer ' + t;
  return h;
}

function normalizeStaffApiRow(s) {
  const code = s.staff_code || s.staff_id;
  let shift_time = s.shift_time;
  if (!shift_time && (s.shift_start != null || s.shift_end != null)) {
    const a = s.shift_start != null ? String(s.shift_start).slice(0, 5) : '';
    const b = s.shift_end != null ? String(s.shift_end).slice(0, 5) : '';
    shift_time = a && b ? `${a} – ${b}` : (a || b || '—');
  }
  if (!shift_time) shift_time = '—';
  return {
    ...s,
    staff_id: code,
    shift_time,
    availability: s.availability || 'ready',
    location: s.location || '—',
    assigned_unit: s.assigned_unit || '—',
  };
}

function applyReadOnlyUi() {
  const banner = document.getElementById('staff-readonly-banner');
  const adminAct = document.getElementById('staff-admin-actions');
  const exp = document.getElementById('staff-export-btn');
  const viewEdit = document.getElementById('staff-view-edit-btn');
  if (banner) banner.style.display = readOnlyMode ? 'block' : 'none';
  if (adminAct) adminAct.style.display = readOnlyMode ? 'none' : '';
  if (exp) exp.style.display = readOnlyMode ? 'none' : '';
  if (viewEdit) viewEdit.style.display = readOnlyMode ? 'none' : '';
}

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

/** Portal role: same sources as login / OAuth / legacy spherecare_* keys. */
function resolvePortalRole() {
  try {
    const user = JSON.parse(sessionStorage.getItem('user') || '{}');
    const raw =
      user.role ||
      user.global_role ||
      sessionStorage.getItem('spherecare_role') ||
      '';
    return String(raw).toLowerCase().trim();
  } catch (_) {
    return '';
  }
}

const ADMIN_PORTAL_ROLES = new Set(['admin', 'super_admin', 'owner']);

// ── AUTH GUARD ──
// Admin: full management. Staff: same page, read-only roster for their center.
function checkAccess() {
  try {
    const token = sessionStorage.getItem('access_token') || sessionStorage.getItem('spherecare_token');
    const user = JSON.parse(sessionStorage.getItem('user') || '{}');
    if (!user.role && user.global_role) user.role = user.global_role;
    if (!user.role && sessionStorage.getItem('spherecare_role')) {
      user.role = sessionStorage.getItem('spherecare_role');
    }

    if (!token) {
      window.location.href = 'register-login.html';
      return false;
    }

    const role = resolvePortalRole();
    if (!role) {
      window.location.href = 'register-login.html';
      return false;
    }

    const denied = document.getElementById('access-denied');
    const panel = document.getElementById('staff-panel');
    const topbar = document.getElementById('topbar-right');
    const nameEl = document.getElementById('admin-name');
    const roleEl = document.getElementById('admin-role');

    if (denied) denied.style.display = 'none';
    if (panel) panel.style.display = 'block';
    if (topbar) topbar.style.display = '';

    if (ADMIN_PORTAL_ROLES.has(role)) {
      readOnlyMode = false;
      if (nameEl) nameEl.textContent = `Admin: ${user.full_name || 'Admin'}`;
      if (roleEl) roleEl.textContent = 'Facility Manager';
      applyReadOnlyUi();
      return true;
    }

    if (role === 'staff') {
      readOnlyMode = true;
      if (nameEl) nameEl.textContent = user.full_name || 'Staff';
      if (roleEl) roleEl.textContent = 'Staff (view only)';
      applyReadOnlyUi();
      return true;
    }

    if (denied) denied.style.display = 'flex';
    if (panel) panel.style.display = 'none';
    if (topbar) topbar.style.display = 'none';
    return false;
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
  staffListNotice = null;
  try {
    const res = await fetch(`${API_BASE}/staff/`, { headers: staffAuthHeaders() });
    if (res.status === 403) {
      let msg = 'You cannot view the staff directory yet.';
      try {
        const j = await res.json();
        const d = j.detail;
        if (d && typeof d === 'object' && d.msg) msg = d.msg;
        else if (typeof d === 'string') msg = d;
      } catch (_) {}
      staffListNotice = msg;
      staffData = [];
    } else if (!res.ok) {
      throw new Error('staff list unavailable');
    } else {
      const raw = await res.json();
      staffData = Array.isArray(raw) ? raw.map(normalizeStaffApiRow) : [];
    }
  } catch {
    if (readOnlyMode) {
      staffData = [];
      staffListNotice =
        'Unable to load the team roster. Check your connection or ask your facility administrator.';
    } else {
      // Demo fallback for admins when API is down (local dev)
      staffData = [
        { staff_id: 'ST-4829', full_name: 'Sarah Johnson',  shift_time: '7:00 AM - 3:00 PM',  assigned_unit: 'ICU Ward',     status: 'active',   role: 'Senior Carer', availability: 'ready',    location: 'Nurses Station A' },
        { staff_id: 'ST-3746', full_name: 'Michael Chen',   shift_time: '3:00 PM - 11:00 PM', assigned_unit: 'Emergency',    status: 'on_leave', role: 'Nurse',        availability: 'busy',     location: 'Room 104' },
        { staff_id: 'ST-5920', full_name: 'Emma Rodriguez', shift_time: '11:00 PM - 7:00 AM', assigned_unit: 'General Ward', status: 'pending',  role: 'Carer',        availability: 'on_break', location: 'Break Room' },
        { staff_id: 'ST-1038', full_name: 'David Kim',      shift_time: '7:00 AM - 3:00 PM',  assigned_unit: 'Pediatrics',   status: 'active',   role: 'Doctor',       availability: 'busy',     location: 'Room 312' },
        { staff_id: 'ST-2241', full_name: 'Linda Pham',     shift_time: '7:00 AM - 3:00 PM',  assigned_unit: 'Geriatrics',   status: 'active',   role: 'Carer',        availability: 'ready',    location: 'Room 205' },
        { staff_id: 'ST-6610', full_name: 'James Carter',   shift_time: '3:00 PM - 11:00 PM', assigned_unit: 'Neurology',    status: 'active',   role: 'Nurse',        availability: 'on_break', location: 'Cafeteria' },
      ];
    }
  }
  renderTable();
  loadStats();
  hideSkeleton(); // Delete will trigger top of loading
}

async function loadStats() {
  const setStat = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };
  try {
    const res = await fetch(`${API_BASE}/staff/stats/summary`, { headers: staffAuthHeaders() });
    if (!res.ok) throw new Error();
    const s = await res.json();
    setStat('stat-active', s.active_staff);
    setStat('stat-pending', s.pending);
    setStat('stat-shifts', s.shifts_today);
    const onBreak =
      staffData.filter(x => x.availability === 'on_break').length;
    setStat('stat-break', onBreak);
  } catch {
    // Compute from local staffData
    const active = staffData.filter(s => s.status === 'active').length;
    const pending = staffData.filter(s => s.status === 'pending').length;
    const onBreak = staffData.filter(s => s.availability === 'on_break').length;
    setStat('stat-active', active);
    setStat('stat-pending', pending);
    setStat('stat-shifts', staffData.length);
    setStat('stat-break', onBreak);
  }
}

// ── RENDER TABLE ──
function _calcShiftHours(s) {
  try {
    var from = s.shift_start || _parseTimeTo24((s.shift_time||'').split(/[–-]/)[0].trim());
    var to   = s.shift_end   || _parseTimeTo24((s.shift_time||'').split(/[–-]/)[1] ? (s.shift_time||'').split(/[–-]/)[1].trim() : '');
    if (!from || !to) return '';
    var fParts = from.split(':'), tParts = to.split(':');
    var fMins  = parseInt(fParts[0],10)*60 + parseInt(fParts[1]||0,10);
    var tMins  = parseInt(tParts[0],10)*60 + parseInt(tParts[1]||0,10);
    if (tMins <= fMins) tMins += 24*60; // overnight shift
    var diff = (tMins - fMins) / 60;
    var h = Math.floor(diff), m = Math.round((diff - h)*60);
    return m > 0 ? h+'h '+m+'m' : h+' hour'+(h!==1?'s':'');
  } catch(_) { return ''; }
}

function renderTable() {
  const tbody = document.getElementById('staff-tbody');
  const countEl = document.getElementById('staff-count');
  if (staffListNotice) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:#64748b;padding:32px;line-height:1.5;">${escapeHtml(staffListNotice)}</td></tr>`;
    if (countEl) countEl.textContent = '';
    return;
  }
  if (!staffData.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#9aa0ac;padding:24px;">No staff found.</td></tr>';
    if (countEl) countEl.textContent = '0 staff members';
    return;
  }

  tbody.innerHTML = staffData.map(s => {
    const avail = s.availability || 'ready';
    const availClass = avail === 'ready' ? 'avail-ready' : avail === 'busy' ? 'avail-busy' : 'avail-break';
    const availLabel = avail === 'ready' ? 'Ready' : avail === 'busy' ? 'Busy' : 'On Break';
    const loc = s.location || '—';
    const sid = (s.staff_id || '').replace(/'/g, "\\'");
    const editBtn = readOnlyMode ? '' : `
          <button class="action-btn blue" title="Edit" onclick="editStaff('${sid}')">
            <svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>`;
    return `
      <tr>
        <td>
          <div class="staff-name">${s.full_name}</div>
          <div class="staff-id">ID: ${s.staff_id} · ${s.role || 'Staff'}</div>
        </td>
        <td>
          <div class="shift-main">${s.shift_time}</div><div class="shift-hours">${_calcShiftHours(s)}</div>
        </td>
        <td>${s.assigned_unit}</td>
        <td><span class="avail-badge ${availClass}">${availLabel}</span></td>
        <td><span class="loc-text">${loc}</span></td>
        <td class="actions-cell">
          <button class="action-btn green" title="Call" onclick="callStaff('${sid}')">
            <svg viewBox="0 0 24 24"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.362 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.338 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
          </button>
          <button class="action-btn" title="View details" onclick="viewStaff('${sid}')">
            <svg viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
          </button>${editBtn}
        </td>
      </tr>`;
  }).join('');

  if (countEl) countEl.textContent = `${staffData.length} staff member${staffData.length !== 1 ? 's' : ''}`;
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

// ── TIME HELPERS ──
function _fmtTime24(t) {
  if (!t) return '';
  var parts=t.split(':'), h=parseInt(parts[0],10), m=parts[1]||'00';
  var ampm=h>=12?'PM':'AM', h12=h%12||12;
  return h12+':'+m+' '+ampm;
}
function _parseTimeTo24(display) {
  if (!display) return '';
  var match=display.match(/(\d+):(\d+)\s*(AM|PM)?/i);
  if (!match) return '';
  var h=parseInt(match[1],10), min=match[2], ampm=(match[3]||'').toUpperCase();
  if (ampm==='PM'&&h!==12) h+=12;
  if (ampm==='AM'&&h===12) h=0;
  return String(h).padStart(2,'0')+':'+min;
}

// ══════════════════════════════════════════════
// ── CALL — dynamic overlay (like message.js) ──
// ══════════════════════════════════════════════
var _sc = { callId:null, muted:false, timerInt:null, pollInt:null, seconds:0, state:'idle', lkRoom:null };
function _scEsc(s){return(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function _scIni(n){return(n||'?').split(' ').map(function(w){return w[0]||'';}).join('').toUpperCase().slice(0,2);}
function _scInjectStyle(){if(!document.getElementById('sc-call-style')){var st=document.createElement('style');st.id='sc-call-style';st.textContent='@keyframes sc-pulse{0%,100%{transform:scale(1);}50%{transform:scale(1.15);}} @keyframes sc-ring{0%{transform:scale(1);opacity:1;}100%{transform:scale(1.5);opacity:0;}}';document.head.appendChild(st);}}
function _removeCallingOverlay(){var el=document.getElementById('sc-calling-overlay');if(el)el.remove();}
function _removeActiveCallOverlay(){var el=document.getElementById('sc-active-call-overlay');if(el)el.remove();clearInterval(_sc.timerInt);}
function _scShowToast(msg){var t=document.createElement('div');t.style.cssText='position:fixed;bottom:90px;left:50%;transform:translateX(-50%);background:#0f172a;color:#fff;padding:8px 18px;border-radius:20px;font-size:13px;z-index:999999;pointer-events:none;';t.textContent=msg;document.body.appendChild(t);setTimeout(function(){t.remove();},2500);}

function _showCallingOverlay(name) {
  _removeCallingOverlay(); _scInjectStyle();
  var ov=document.createElement('div'); ov.id='sc-calling-overlay';
  ov.style.cssText='position:fixed;inset:0;z-index:999998;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.65);';
  ov.innerHTML='<div style="background:#1e2025;border-radius:20px;padding:36px 32px;min-width:300px;text-align:center;color:#fff;">'+
    '<div style="font-size:52px;margin-bottom:14px;animation:sc-pulse 1s infinite;">📞</div>'+
    '<div style="font-size:18px;font-weight:800;margin-bottom:4px;">Calling…</div>'+
    '<div style="font-size:13px;color:rgba(255,255,255,0.55);margin-bottom:28px;">'+_scEsc(name)+'</div>'+
    '<button onclick="_scCancelCall()" style="width:56px;height:56px;border-radius:50%;background:#ef4444;border:none;cursor:pointer;font-size:24px;" title="Cancel">📵</button>'+
    '</div>';
  document.body.appendChild(ov);
}

function _showActiveCallOverlay(name) {
  _removeCallingOverlay(); _scInjectStyle();
  var existing=document.getElementById('sc-active-call-overlay'); if(existing)existing.remove();
  var av=_scIni(name);
  var ov=document.createElement('div'); ov.id='sc-active-call-overlay';
  ov.style.cssText='position:fixed;inset:0;z-index:999998;display:flex;flex-direction:column;align-items:center;justify-content:center;background:radial-gradient(circle at 50% 40%,#38bdf833 0%,#0f172a 70%);';
  ov.innerHTML=
    '<div style="position:relative;width:120px;height:120px;margin-bottom:20px;">'+
      '<div style="position:absolute;inset:-24px;border-radius:50%;border:2px solid rgba(56,189,248,0.15);animation:sc-ring 2s ease-out infinite;"></div>'+
      '<div style="position:absolute;inset:-12px;border-radius:50%;border:2px solid rgba(56,189,248,0.25);animation:sc-ring 2s ease-out .4s infinite;"></div>'+
      '<div style="width:120px;height:120px;border-radius:50%;background:linear-gradient(135deg,#38BDF8,#6366F1);display:flex;align-items:center;justify-content:center;font-size:40px;font-weight:800;color:#fff;">'+av+'</div>'+
    '</div>'+
    '<div style="font-size:20px;font-weight:800;color:#fff;margin-bottom:6px;">'+_scEsc(name)+'</div>'+
    '<div style="font-size:13px;color:rgba(255,255,255,0.5);margin-bottom:4px;">Connected</div>'+
    '<div id="sc-active-timer" style="font-size:28px;font-weight:700;color:#38BDF8;letter-spacing:2px;margin-bottom:32px;font-variant-numeric:tabular-nums;">0:00</div>'+
    '<div style="display:flex;align-items:center;gap:20px;">'+
      '<button id="sc-mute-btn" onclick="_scToggleMute()" style="width:56px;height:56px;border-radius:50%;background:rgba(255,255,255,0.12);border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;">'+
        '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>'+
      '</button>'+
      '<button onclick="_scEndCall()" style="width:68px;height:68px;border-radius:50%;background:#ef4444;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;">'+
        '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="transform:rotate(135deg)"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.6 1.18h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.77a16 16 0 0 0 6 6l.93-.93a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7a2 2 0 0 1 1.72 2.03z"/></svg>'+
      '</button>'+
    '</div>';
  document.body.appendChild(ov);
  _sc.seconds=0;
  _sc.timerInt=setInterval(function(){_sc.seconds++;var m=Math.floor(_sc.seconds/60),s=_sc.seconds%60;var el=document.getElementById('sc-active-timer');if(el)el.textContent=m+':'+(s<10?'0':'')+s;},1000);
}

async function callStaff(id) {
  const s = staffData.find(x => x.staff_id === id);
  if (!s) return;
  if (!s.user_id) { alert('Cannot call this staff member — no user account linked.'); return; }
  _sc.state='ringing'; _sc.callId=null;
  _showCallingOverlay(s.full_name);
  try {
    var res=await fetch(API_BASE+'/calls',{method:'POST',headers:staffAuthHeaders(),body:JSON.stringify({callee_user_id:s.user_id,kind:'audio'})});
    var data=await res.json();
    if (!res.ok) { _removeCallingOverlay(); _scShowToast(data.detail||'Failed to start call'); _sc.state='idle'; return; }
    _sc.callId=data.call_id;
    if (data.join_payload&&data.join_payload.livekit_url&&data.join_payload.access_token) _scLkConnect(data.join_payload.livekit_url,data.join_payload.access_token);
    var calleeName=s.full_name;
    _sc.pollInt=setInterval(async function(){
      if (_sc.state==='ended'||_sc.state==='idle'){clearInterval(_sc.pollInt);return;}
      try{
        var r=await fetch(API_BASE+'/calls/'+_sc.callId,{headers:staffAuthHeaders()});if(!r.ok)return;
        var d=await r.json();
        if (d.state==='active'&&_sc.state==='ringing'){_sc.state='active';_showActiveCallOverlay(calleeName);}
        else if(d.state==='declined'){clearInterval(_sc.pollInt);_sc.state='idle';_removeCallingOverlay();_removeActiveCallOverlay();_scShowToast('Call declined');}
        else if(d.state==='timeout'){clearInterval(_sc.pollInt);_sc.state='idle';_removeCallingOverlay();_removeActiveCallOverlay();_scShowToast('No answer');}
        else if(d.state==='canceled'||d.state==='ended'){clearInterval(_sc.pollInt);_sc.state='idle';_removeCallingOverlay();_removeActiveCallOverlay();}
      }catch(_){}
    },1500);
  } catch(err){_removeCallingOverlay();_scShowToast('Network error.');_sc.state='idle';}
}
async function _scCancelCall(){clearInterval(_sc.pollInt);var cid=_sc.callId;_sc.callId=null;_sc.state='idle';_removeCallingOverlay();if(cid)try{await fetch(API_BASE+'/calls/'+cid+'/cancel',{method:'POST',headers:staffAuthHeaders()});}catch(_){}}
async function _scEndCall(){clearInterval(_sc.pollInt);var cid=_sc.callId;_sc.callId=null;_sc.state='ended';_removeActiveCallOverlay();if(_sc.lkRoom){try{_sc.lkRoom.disconnect();}catch(_){}_sc.lkRoom=null;}var ae=document.getElementById('sc-lk-audio');if(ae)ae.remove();if(cid)try{await fetch(API_BASE+'/calls/'+cid+'/end',{method:'POST',headers:staffAuthHeaders()});}catch(_){}_sc.state='idle';}
function _scToggleMute(){_sc.muted=!_sc.muted;if(_sc.lkRoom)try{_sc.lkRoom.localParticipant.setMicrophoneEnabled(!_sc.muted);}catch(_){}var btn=document.getElementById('sc-mute-btn');if(btn)btn.style.background=_sc.muted?'#f59e0b':'rgba(255,255,255,0.12)';}
async function _scLkConnect(lkUrl,lkToken){if(typeof LivekitClient==='undefined')return;try{var room=new LivekitClient.Room({adaptiveStream:true,dynacast:true});_sc.lkRoom=room;room.on(LivekitClient.RoomEvent.TrackSubscribed,function(track){if(track.kind===LivekitClient.Track.Kind.Audio){var el=track.attach();el.id='sc-lk-audio';document.body.appendChild(el);}});room.on(LivekitClient.RoomEvent.ParticipantDisconnected,function(){if(_sc.state==='active'){_scEndCall();_scShowToast('Call ended');}});await room.connect(lkUrl,lkToken);await room.localParticipant.setMicrophoneEnabled(true);}catch(e){console.warn('LiveKit:',e);}}

// ── EDIT / DELETE ──
function editStaff(id) {
  if (readOnlyMode) { viewStaff(id); return; }
  const s = staffData.find(x => x.staff_id === id);
  if (!s) return;
  editingId = id;
  document.getElementById('edit-name').value = s.full_name;
  document.getElementById('edit-id').value   = s.staff_id;
  var shiftFrom = s.shift_start ? s.shift_start.slice(0,5) : '';
  var shiftTo   = s.shift_end   ? s.shift_end.slice(0,5)   : '';
  if (!shiftFrom && s.shift_time && (s.shift_time.includes('–')||s.shift_time.includes('-'))) {
    var sep=s.shift_time.includes('–')?'–':'-', pts=s.shift_time.split(sep);
    shiftFrom=_parseTimeTo24(pts[0].trim());
    shiftTo=_parseTimeTo24(pts[1]?pts[1].trim():'');
  }
  document.getElementById('edit-shift-from').value   = shiftFrom;
  document.getElementById('edit-shift-to').value     = shiftTo;
  document.getElementById('edit-unit').value         = s.assigned_unit;
  document.getElementById('edit-status').value       = s.status;
  document.getElementById('edit-role').value         = s.role;
  document.getElementById('edit-availability').value = s.availability || 'ready';
  document.getElementById('edit-location').value     = s.location || '';
  document.getElementById('modal-edit').classList.add('open');
}

function closeModal() { document.getElementById('modal-edit').classList.remove('open'); editingId = null; }

async function saveStaff() {
  if (readOnlyMode || !editingId) return;
  var shiftFrom=document.getElementById('edit-shift-from').value;
  var shiftTo=document.getElementById('edit-shift-to').value;
  var shift_time=(shiftFrom&&shiftTo)?_fmtTime24(shiftFrom)+' – '+_fmtTime24(shiftTo):(shiftFrom?_fmtTime24(shiftFrom):'—');
  const updates = {
    shift_start:   shiftFrom||null,
    shift_end:     shiftTo||null,
    shift_time,
    assigned_unit: document.getElementById('edit-unit').value,
    status:        document.getElementById('edit-status').value,
    role:          document.getElementById('edit-role').value,
    availability:  document.getElementById('edit-availability').value,
    location:      document.getElementById('edit-location').value,
  };
  try {
    const res=await fetch(`${API_BASE}/staff/${encodeURIComponent(editingId)}`,{method:'PATCH',headers:staffAuthHeaders(),body:JSON.stringify(updates)});
    if (!res.ok) throw new Error();
    const updated=await res.json();
    const idx=staffData.findIndex(s=>s.staff_id===editingId);
    if (idx>=0) staffData[idx]=normalizeStaffApiRow({...staffData[idx],...updates,...updated});
  } catch {
    const idx=staffData.findIndex(s=>s.staff_id===editingId);
    if (idx>=0) Object.assign(staffData[idx],updates);
  }
  closeModal(); renderTable(); loadStats();
}

async function deleteStaff() {
  if (readOnlyMode) return;
  if (!editingId || !confirm(`Delete staff member ${editingId}?`)) return;
  try {
    await fetch(`${API_BASE}/staff/${encodeURIComponent(editingId)}`, {
      method: 'DELETE',
      headers: staffAuthHeaders()
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
  if (readOnlyMode) return;
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
  if (readOnlyMode) return;
  const full_name = document.getElementById('add-name').value.trim();
  if (!full_name) { alert('Please enter a full name.'); return; }

  const payload = {
    full_name,
    shift_time:    document.getElementById('add-shift').value,
    assigned_unit: document.getElementById('add-unit').value,
    role:          document.getElementById('add-role').value,
  };

  try {
    const q = new URLSearchParams({
      full_name: payload.full_name,
      assigned_unit: payload.assigned_unit,
      role: payload.role,
    });
    const res = await fetch(`${API_BASE}/admin/staff/create?${q}`, {
      method: 'POST',
      headers: staffAuthHeaders()
    });
    if (!res.ok) throw new Error();
    const created = await res.json();
    const code = created.staff_code || created.staff_id;
    staffData.push(normalizeStaffApiRow({
      staff_code: code,
      full_name: created.full_name || payload.full_name,
      shift_time: payload.shift_time,
      assigned_unit: created.assigned_unit || payload.assigned_unit,
      status: 'active',
      role: created.role || payload.role
    }));
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


// ══════════════════════════════════════════════════
// ── DOCTOR SUMMARY ────────────────────────────────
// ══════════════════════════════════════════════════
var _allBookings = [];
var _myDoctorName = '';

function _isDoctorRole() {
  try {
    var user = JSON.parse(sessionStorage.getItem('user') || '{}');
    var role = (user.role || user.global_role || '').toLowerCase();
    return role === 'doctor';
  } catch(_) { return false; }
}

function _initDoctorTab() {
  // All logged-in users can see Doctor Summary
  try {
    var user = JSON.parse(sessionStorage.getItem('user') || '{}');
    var role = (user.role || user.global_role || '').toLowerCase();
    // If doctor, pre-filter by their name; otherwise show all bookings
    if (role === 'doctor') {
      _myDoctorName = (user.full_name || '').toLowerCase();
    }
  } catch(_) {}
}

async function loadDoctorBookings() {
  var tbody = document.getElementById('doctor-bookings-tbody');
  if (!tbody) return;
  try {
    var res = await fetch(API_BASE + '/bookings/', { headers: staffAuthHeaders() });
    if (!res.ok) throw new Error();
    var data = await res.json();
    _allBookings = _myDoctorName
      ? data.filter(function(b) {
          var bn = (b.doctor_name || '').toLowerCase();
          return bn.includes(_myDoctorName) || _myDoctorName.includes(bn.replace('dr. ','').replace('dr ',''));
        })
      : data;
  } catch(_) { _allBookings = []; }
  _renderDoctorBookings(_allBookings);
  _updateDocStats(_allBookings);
}

function filterBookings() {
  var status = document.getElementById('doctor-filter-status').value;
  var filtered = status ? _allBookings.filter(function(b){ return b.status === status; }) : _allBookings;
  _renderDoctorBookings(filtered);
  _updateDocStats(filtered);
}

function _updateDocStats(bookings) {
  var today = new Date().toISOString().slice(0,10);
  var el;
  el = document.getElementById('doc-stat-total');     if(el) el.textContent = bookings.length;
  el = document.getElementById('doc-stat-today');     if(el) el.textContent = bookings.filter(function(b){ return b.appointment_date === today; }).length;
  el = document.getElementById('doc-stat-confirmed'); if(el) el.textContent = bookings.filter(function(b){ return b.status === 'confirmed'; }).length;
  el = document.getElementById('doc-stat-pending');   if(el) el.textContent = bookings.filter(function(b){ return b.status === 'requested'; }).length;
}

function _statusBadge(status) {
  var map = { requested:{cls:'status-pending',label:'Requested'}, confirmed:{cls:'status-active',label:'Confirmed'}, completed:{cls:'status-active',label:'Completed'}, cancelled:{cls:'status-leave',label:'Cancelled'} };
  var s = map[status] || {cls:'status-pending',label:status};
  return '<span class="status-badge ' + s.cls + '">' + s.label + '</span>';
}

function _fmtBookingDate(d) {
  if (!d) return '—';
  try { return new Date(d + 'T00:00:00').toLocaleDateString('en-AU', {day:'numeric',month:'short',year:'numeric'}); } catch(_){ return d; }
}
function _fmtTimePretty(t) {
  if (!t) return '';
  var parts = t.split(':'), h = parseInt(parts[0],10), m = parts[1]||'00';
  return (h%12||12)+':'+m+(h>=12?' PM':' AM');
}

function _renderDoctorBookings(bookings) {
  var tbody   = document.getElementById('doctor-bookings-tbody');
  var countEl = document.getElementById('doctor-booking-count');
  if (!bookings || !bookings.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#9aa0ac;padding:32px;">No appointments found.</td></tr>';
    if (countEl) countEl.textContent = '';
    return;
  }
  var sorted = bookings.slice().sort(function(a,b){
    return ((b.appointment_date||'')+(b.start_time||'')) > ((a.appointment_date||'')+(a.start_time||'')) ? 1 : -1;
  });
  tbody.innerHTML = sorted.map(function(b) {
    var patientName = b.resident ? b.resident.full_name : ('Resident #' + b.resident_id);
    var timeStr = _fmtTimePretty(b.start_time) + (b.end_time ? ' – ' + _fmtTimePretty(b.end_time) : '');
    return '<tr>' +
      '<td><div class="staff-name">' + escapeHtml(patientName) + '</div>' + (b.resident && b.resident.room ? '<div class="staff-id">Room ' + escapeHtml(String(b.resident.room)) + '</div>' : '') + '</td>' +
      '<td>' + escapeHtml(b.booking_type) + (b.doctor_specialty ? '<div style="font-size:11.5px;color:var(--text3);">' + escapeHtml(b.doctor_specialty) + '</div>' : '') + '</td>' +
      '<td><div style="font-weight:600;font-size:13px;">' + _fmtBookingDate(b.appointment_date) + '</div><div style="font-size:12px;color:var(--text2);">' + timeStr + '</div></td>' +
      '<td style="font-size:13px;color:var(--text2);">' + escapeHtml(b.location || '—') + '</td>' +
      '<td>' + _statusBadge(b.status) + '</td>' +
      '<td style="font-size:12.5px;color:var(--text2);max-width:180px;">' + escapeHtml(b.notes || '—') + '</td>' +
    '</tr>';
  }).join('');
  if (countEl) countEl.textContent = bookings.length + ' appointment' + (bookings.length !== 1 ? 's' : '');
}

// Wrap switchTab to lazy-load doctor bookings
var _doctorTabLoaded = false;
var _origSwitchTab = typeof switchTab !== 'undefined' ? switchTab : null;
function switchTab(name, el) {
  document.querySelectorAll('.tab').forEach(function(t){ t.classList.remove('active'); });
  document.querySelectorAll('.tab-panel').forEach(function(p){ p.classList.remove('active'); });
  el.classList.add('active');
  var target = document.getElementById('tab-' + name);
  if (target) target.classList.add('active');
  if (name === 'doctor' && !_doctorTabLoaded) {
    _doctorTabLoaded = true;
    loadDoctorBookings();
  }
}

// ── INIT ──
document.addEventListener('DOMContentLoaded', function() {
  if (checkAccess()) {
    loadStaff();
    _initDoctorTab();
  }
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