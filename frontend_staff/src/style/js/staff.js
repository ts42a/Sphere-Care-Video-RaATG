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
var _sc = { callId:null, calleeName:null, muted:false, timerInt:null, pollInt:null, seconds:0, state:'idle', lkRoom:null };
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
  _sc.state='ringing'; _sc.callId=null; _sc.calleeName=s.full_name;
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
  var inp = document.getElementById('add-account-id');
  if (inp) inp.value = '';
  var errEl = document.getElementById('add-error');
  var sucEl = document.getElementById('add-success');
  if (errEl) errEl.style.display = 'none';
  if (sucEl) sucEl.style.display = 'none';
  document.getElementById('modal-add').classList.add('open');
  setTimeout(function(){ if(inp) inp.focus(); }, 100);
}

function closeAddModal() {
  document.getElementById('modal-add').classList.remove('open');
}

async function submitAddStaff() {
  if (readOnlyMode) return;
  var inp   = document.getElementById('add-account-id');
  var errEl = document.getElementById('add-error');
  var sucEl = document.getElementById('add-success');
  var btn   = document.getElementById('btn-add-submit');
  var code  = inp ? inp.value.trim().toUpperCase() : '';

  if (errEl) errEl.style.display = 'none';
  if (sucEl) sucEl.style.display = 'none';

  if (!code) {
    if (errEl) { errEl.textContent = 'Please enter an Account ID.'; errEl.style.display = 'block'; }
    return;
  }

  if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }

  try {
    var res = await fetch(API_BASE + '/staff/invite', {
      method: 'POST',
      headers: staffAuthHeaders(),
      body: JSON.stringify({ account_id: code })
    });
    var data = await res.json();

    if (!res.ok) {
      var msg = typeof data.detail === 'string' ? data.detail : (data.detail && data.detail.msg) ? data.detail.msg : 'Account ID not found or already added.';
      if (errEl) { errEl.textContent = msg; errEl.style.display = 'block'; }
      return;
    }

    if (sucEl) { sucEl.textContent = 'Invitation sent — staff member will be added once they accept.'; sucEl.style.display = 'block'; }
    await loadStaff();
    setTimeout(function() { closeAddModal(); }, 1800);

  } catch(err) {
    if (errEl) { errEl.textContent = 'Network error. Please try again.'; errEl.style.display = 'block'; }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Send Invitation'; }
  }
}


// ── INIT ──
document.addEventListener('DOMContentLoaded', function() {
  if (checkAccess()) {
    loadStaff();
    _initDoctorTab();
  }
});

// ══════════════════════════════════════════════════════════════════
// ── DOCTOR SUMMARY TAB
// Fetches bookings from GET /bookings/, filters to the signed-in
// doctor by full_name match, then lets the doctor update status /
// notes via PATCH /{booking_id}/status.
// Called from DOMContentLoaded in staff.js: _initDoctorTab()
// ══════════════════════════════════════════════════════════════════

let _doctorBookings     = [];   // all bookings belonging to this doctor
let _doctorBookingsAll  = [];   // unfiltered copy
let _doctorEditingId    = null; // booking id being edited in the modal

// ── Resolve the signed-in user's display name (same pattern as staff.js) ──
function _resolveCurrentUserName() {
  try {
    const user = JSON.parse(sessionStorage.getItem('user') || '{}');
    return (user.full_name || '').trim();
  } catch (_) { return ''; }
}

// ── Fetch all bookings then filter to this doctor ──
async function _loadDoctorBookings() {
  const tbody    = document.getElementById('doctor-bookings-tbody');
  const countEl  = document.getElementById('doctor-booking-count');
  if (tbody) tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#9aa0ac;padding:24px;">Loading…</td></tr>';

  try {
    const res = await fetch(`${API_BASE}/bookings/`, { headers: staffAuthHeaders() });
    if (!res.ok) throw new Error('fetch failed');
    const raw = await res.json();

    const myName = _resolveCurrentUserName().toLowerCase();
    const portalRole = resolvePortalRole();
    const isAdmin = ['admin','super_admin','owner','facility_manager','manager'].includes(portalRole);

    // Admins see all bookings; doctors see only their own.
    const filtered = (isAdmin || !myName)
      ? raw
      : raw.filter(b => (b.doctor_name || '').toLowerCase().includes(myName) || myName.includes((b.doctor_name || '').toLowerCase()));

    _doctorBookingsAll = filtered.map(b => ({
      id:            b.id,
      resident:      b.resident ? b.resident.full_name : `Resident #${b.resident_id}`,
      resident_id:   b.resident_id,
      doctor:        b.doctor_name,
      type:          b.booking_type,
      date:          b.appointment_date,
      time:          b.start_time,
      location:      b.location || '—',
      notes:         b.notes    || '',
      status:        b.status,
      specialty:     b.doctor_specialty || '',
    }));

  } catch (e) {
    console.warn('Doctor tab: could not load bookings', e);
    _doctorBookingsAll = [];
  }

  _doctorBookings = [..._doctorBookingsAll];
  _renderDoctorStats();
  _renderDoctorTable();
}

// ── Stats ──
function _renderDoctorStats() {
  const todayStr = (function() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  })();

  const all       = _doctorBookingsAll;
  const total     = all.length;
  const today     = all.filter(b => b.date === todayStr).length;
  const confirmed = all.filter(b => b.status === 'confirmed').length;
  const pending   = all.filter(b => b.status === 'requested' || b.status === 'pending').length;

  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('doc-stat-total',     total);
  set('doc-stat-today',     today);
  set('doc-stat-confirmed', confirmed);
  set('doc-stat-pending',   pending);
}

// ── Filter (called by the status <select> in staff.html) ──
function filterBookings() {
  const val = (document.getElementById('doctor-filter-status') || {}).value || '';
  _doctorBookings = val
    ? _doctorBookingsAll.filter(b => b.status === val)
    : [..._doctorBookingsAll];
  _renderDoctorTable();
}

// ── Table ──
function _renderDoctorTable() {
  const tbody   = document.getElementById('doctor-bookings-tbody');
  const countEl = document.getElementById('doctor-booking-count');
  if (!tbody) return;

  if (!_doctorBookings.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#9aa0ac;padding:32px;">No appointments found.</td></tr>';
    if (countEl) countEl.textContent = '';
    return;
  }

  // Status badge colours
  const SC = {
    confirmed:  { bg:'#d1fae5', color:'#065f46' },
    completed:  { bg:'#e0e7ff', color:'#3730a3' },
    requested:  { bg:'#fef3c7', color:'#b45309' },
    pending:    { bg:'#fef3c7', color:'#b45309' },
    cancelled:  { bg:'#fee2e2', color:'#b91c1c' },
    ongoing:    { bg:'#dbeafe', color:'#1d4ed8' },
  };

  tbody.innerHTML = _doctorBookings.map(b => {
    const sc  = SC[b.status] || { bg:'#f1f5f9', color:'#5a6170' };
    const badge = `<span style="background:${sc.bg};color:${sc.color};font-size:11px;font-weight:700;padding:3px 10px;border-radius:20px;white-space:nowrap;">${_cap(b.status)}</span>`;

    // Format date nicely
    let niceDate = b.date;
    try { niceDate = new Date(b.date + 'T00:00:00').toLocaleDateString('en-AU', { day:'numeric', month:'short', year:'numeric' }); } catch(_){}

    // Time: strip seconds if present (HH:MM:SS → HH:MM)
    const niceTime = (b.time || '').slice(0, 5);

    // Notes: truncate for table display
    const notesSnippet = b.notes
      ? `<span title="${_esc(b.notes)}" style="max-width:140px;display:inline-block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;vertical-align:middle;">${_esc(b.notes)}</span>`
      : '<span style="color:#9aa0ac;">—</span>';

    // Resident initials avatar
    const initials = (b.resident || '').split(' ').map(w => w[0] || '').join('').slice(0, 2).toUpperCase();

    return `
      <tr>
        <td>
          <div style="display:flex;align-items:center;gap:10px;">
            <div style="width:32px;height:32px;border-radius:50%;background:#2ec4b6;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;color:#fff;flex-shrink:0;">${initials}</div>
            <div>
              <div style="font-size:13px;font-weight:700;color:#1a2535;">${_esc(b.resident)}</div>
              <div style="font-size:11px;color:#9aa0ac;">ID #${b.resident_id}</div>
            </div>
          </div>
        </td>
        <td style="font-size:13px;font-weight:600;color:#374151;">${_esc(b.type)}</td>
        <td>
          <div style="font-size:13px;font-weight:700;color:#1a2535;">${niceDate}</div>
          <div style="font-size:11px;color:#9aa0ac;">${niceTime}</div>
        </td>
        <td style="font-size:13px;color:#374151;">${_esc(b.location)}</td>
        <td>${badge}</td>
        <td>
          <div style="display:flex;align-items:center;gap:8px;">
            ${notesSnippet}
            <button
              class="action-btn blue"
              title="Edit booking"
              onclick="_openDoctorEditModal(${b.id})"
              style="flex-shrink:0;"
            >
              <svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
          </div>
        </td>
        <td>
          <button class="btn btn-outline" style="padding:7px 10px;font-size:12px;white-space:nowrap;" onclick="_openTaskCreateModal(${b.id})">Assign activity</button>
        </td>
      </tr>`;
  }).join('');

  if (countEl) countEl.textContent = `${_doctorBookings.length} appointment${_doctorBookings.length !== 1 ? 's' : ''}`;
}

// ── Tiny helpers ──
function _cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }
function _esc(s) {
  const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML;
}

// ══════════════════════════════════════════════════════════════════
// ── DOCTOR BOOKING EDIT MODAL
// Injected into the DOM once; lets the doctor change status + notes.
// ══════════════════════════════════════════════════════════════════

function _injectDoctorEditModal() {
  if (document.getElementById('modal-doctor-edit')) return; // already injected

  const el = document.createElement('div');
  el.id = 'modal-doctor-edit';
  el.className = 'overlay';
  el.setAttribute('onclick', "if(event.target===this)_closeDoctorEditModal()");

  el.innerHTML = `
    <div class="sc-modal" style="max-width:460px;">
      <div class="mhdr">
        <h3>Edit Appointment</h3>
        <button class="mclose" onclick="_closeDoctorEditModal()">✕</button>
      </div>
      <div class="mbody">

        <!-- Patient info (read-only) -->
        <div style="background:#f8fafc;border-radius:10px;padding:14px;margin-bottom:16px;">
          <div style="font-size:10px;font-weight:700;color:#9aa0ac;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px;">Appointment</div>
          <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;">
            <div>
              <div style="font-size:11px;color:#9aa0ac;">Patient</div>
              <div style="font-size:13.5px;font-weight:700;color:#1a2535;" id="dedit-resident">—</div>
            </div>
            <div>
              <div style="font-size:11px;color:#9aa0ac;">Type</div>
              <div style="font-size:13.5px;font-weight:700;color:#1a2535;" id="dedit-type">—</div>
            </div>
            <div>
              <div style="font-size:11px;color:#9aa0ac;">Date &amp; Time</div>
              <div style="font-size:13.5px;font-weight:700;color:#1a2535;" id="dedit-datetime">—</div>
            </div>
          </div>
        </div>

        <div class="mbody-section">
          <!-- Status -->
          <div style="margin-bottom:14px;">
            <label class="flabel">Status</label>
            <select class="fsel" id="dedit-status">
              <option value="requested">Requested</option>
              <option value="confirmed">Confirmed</option>
              <option value="ongoing">Ongoing</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>

          <!-- Location -->
          <div style="margin-bottom:14px;">
            <label class="flabel">Location</label>
            <input class="finput" id="dedit-location" placeholder="e.g. Room 204, Outpatient Clinic"/>
          </div>

          <!-- Notes -->
          <div>
            <label class="flabel">Clinical Notes</label>
            <textarea
              class="finput"
              id="dedit-notes"
              rows="4"
              placeholder="Add consultation notes, instructions, or follow-up details…"
              style="resize:vertical;min-height:80px;"
            ></textarea>
          </div>
        </div>

        <div id="dedit-error" style="display:none;color:#ef4444;font-size:13px;margin-top:10px;padding:8px 12px;background:#fee2e2;border-radius:8px;"></div>
      </div>

      <div class="mfooter">
        <button class="btn btn-outline" onclick="_closeDoctorEditModal()">Cancel</button>
        <button class="btn btn-primary" id="dedit-save-btn" onclick="_saveDoctorBooking()">Save Changes</button>
      </div>
    </div>`;

  document.body.appendChild(el);
}

function _openDoctorEditModal(bookingId) {
  const b = _doctorBookingsAll.find(x => x.id === bookingId);
  if (!b) return;
  _doctorEditingId = bookingId;

  let niceDate = b.date;
  try { niceDate = new Date(b.date + 'T00:00:00').toLocaleDateString('en-AU', { day:'numeric', month:'short', year:'numeric' }); } catch(_){}

  document.getElementById('dedit-resident').textContent  = b.resident;
  document.getElementById('dedit-type').textContent      = b.type;
  document.getElementById('dedit-datetime').textContent  = `${niceDate} ${(b.time || '').slice(0,5)}`;
  document.getElementById('dedit-status').value          = b.status;
  document.getElementById('dedit-location').value        = b.location === '—' ? '' : (b.location || '');
  document.getElementById('dedit-notes').value           = b.notes || '';

  const errEl = document.getElementById('dedit-error');
  if (errEl) errEl.style.display = 'none';

  document.getElementById('modal-doctor-edit').classList.add('open');
}

function _closeDoctorEditModal() {
  const m = document.getElementById('modal-doctor-edit');
  if (m) m.classList.remove('open');
  _doctorEditingId = null;
}

async function _saveDoctorBooking() {
  if (!_doctorEditingId) return;

  const newStatus   = document.getElementById('dedit-status').value;
  const newLocation = document.getElementById('dedit-location').value.trim();
  const newNotes    = document.getElementById('dedit-notes').value.trim();
  const errEl       = document.getElementById('dedit-error');
  const saveBtn     = document.getElementById('dedit-save-btn');

  if (errEl) errEl.style.display = 'none';
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving…'; }

  try {
    // 1. PATCH status (existing endpoint)
    const statusRes = await fetch(
      `${API_BASE}/bookings/${_doctorEditingId}/status?status=${encodeURIComponent(newStatus)}`,
      { method: 'PATCH', headers: staffAuthHeaders() }
    );
    if (!statusRes.ok) {
      const err = await statusRes.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to update status');
    }

    // 2. PATCH location + notes via general update endpoint (if your backend supports it)
    //    Falls back gracefully if the endpoint isn't wired yet — only status is critical.
    try {
      await fetch(
        `${API_BASE}/bookings/${_doctorEditingId}`,
        {
          method: 'PATCH',
          headers: staffAuthHeaders(),
          body: JSON.stringify({ location: newLocation || null, notes: newNotes || null })
        }
      );
    } catch (_) { /* non-fatal — status was already saved */ }

    // Update local cache
    const updateLocal = arr => {
      const idx = arr.findIndex(x => x.id === _doctorEditingId);
      if (idx >= 0) {
        arr[idx] = {
          ...arr[idx],
          status:   newStatus,
          location: newLocation || '—',
          notes:    newNotes,
        };
      }
    };
    updateLocal(_doctorBookingsAll);
    updateLocal(_doctorBookings);

    _renderDoctorStats();
    _renderDoctorTable();
    _closeDoctorEditModal();

  } catch (err) {
    if (errEl) { errEl.textContent = err.message || 'Could not save. Please try again.'; errEl.style.display = 'block'; }
  } finally {
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save Changes'; }
  }
}

// ── WebSocket: keep doctor table in sync with real-time booking events ──
// Piggy-backs on the existing WS layer in booking.js if both are loaded,
// but also handles messages independently if only staff.js is loaded.
(function _doctorWsLayer() {
  // booking.js may already have a WS open; listen via a custom event bridge
  // so we don't open a duplicate connection.  If booking.js isn't present
  // on this page we open our own connection.
  function _handleWsMsg(msg) {
    if (!msg || !msg.type) return;

    if (msg.type === 'booking_created') {
      const b = msg.booking;
      const myName = _resolveCurrentUserName().toLowerCase();
      if (!myName || (b.doctor_name || '').toLowerCase().includes(myName) || myName.includes((b.doctor_name || '').toLowerCase())) {
        const norm = {
          id: b.id, resident: b.resident ? b.resident.full_name : `Resident #${b.resident_id}`,
          resident_id: b.resident_id, doctor: b.doctor_name, type: b.booking_type,
          date: b.appointment_date, time: b.start_time, location: b.location || '—',
          notes: b.notes || '', status: b.status, specialty: b.doctor_specialty || '',
        };
        if (!_doctorBookingsAll.find(x => x.id === norm.id)) {
          _doctorBookingsAll.push(norm);
          filterBookings();
          _renderDoctorStats();
        }
      }
    }

    if (msg.type === 'booking_updated') {
      const u = msg.booking;
      const updateArr = arr => {
        const idx = arr.findIndex(x => x.id === u.id);
        if (idx >= 0 && u.status) arr[idx].status = u.status;
      };
      updateArr(_doctorBookingsAll);
      updateArr(_doctorBookings);
      _renderDoctorStats();
      _renderDoctorTable();
    }

    if (msg.type === 'booking_deleted') {
      _doctorBookingsAll = _doctorBookingsAll.filter(x => x.id !== msg.booking_id);
      _doctorBookings    = _doctorBookings.filter(x => x.id !== msg.booking_id);
      _renderDoctorStats();
      _renderDoctorTable();
    }

    // ── Incoming call (callee side) ──
    if (msg.type === 'call.invite' || msg.type === 'call.incoming' || msg.type === 'incoming_call') {
      // Don't show incoming call UI if we are the caller of this very call.
      var isSelfCall = _sc.state === 'ringing' && _sc.callId && String(msg.call_id) === String(_sc.callId);
      if (!isSelfCall) _showIncomingCallUI(msg);
    }
    if (msg.type === 'call.canceled' || msg.type === 'call.cancelled' || msg.type === 'call_cancelled') {
      _removeIncomingCallUI();
    }

    // ── Caller side: react to call state changes via WS ──
    if (_sc.callId && String(msg.call_id) === String(_sc.callId)) {
      if (msg.type === 'call.accepted' && _sc.state === 'ringing') {
        _sc.state = 'active';
        _showActiveCallOverlay(_sc.calleeName || 'Staff');
      }
      if (msg.type === 'call.declined' && _sc.state === 'ringing') {
        clearInterval(_sc.pollInt);
        _sc.state = 'idle';
        _removeCallingOverlay();
        _scShowToast('Call declined');
      }
      if ((msg.type === 'call.timeout' || msg.type === 'call.canceled') && _sc.state === 'ringing') {
        clearInterval(_sc.pollInt);
        _sc.state = 'idle';
        _removeCallingOverlay();
        _scShowToast(msg.type === 'call.timeout' ? 'No answer' : 'Call cancelled');
      }
      if (msg.type === 'call.ended') {
        clearInterval(_sc.pollInt);
        _sc.state = 'idle';
        _removeCallingOverlay();
        _removeActiveCallOverlay();
        if (_sc.lkRoom) { try { _sc.lkRoom.disconnect(); } catch(_) {} _sc.lkRoom = null; }
      }
      if (msg.type === 'call.summary_ready') {
        _scShowToast('AI summary sent to chat');
      }
    }
  }

  // If booking.js is on the same page, it fires a custom event we can listen to.
  window.addEventListener('spherecare:ws_booking', function(e) {
    _handleWsMsg(e.detail);
  });

  // If booking.js is NOT on this page, open our own WS.
  // Check 20 ms after init to let booking.js register first.
  setTimeout(function() {
    if (window._spherecareWsReady) return; // booking.js already owns a connection
    var proto = location.protocol === 'https:' ? 'wss' : 'ws';
    var ws;
    function connect() {
      var token = sessionStorage.getItem('access_token') || '';
      if (!token) return; // don't attempt WS without a valid token
      ws = new WebSocket(proto + '://' + location.host + '/ws?token=' + encodeURIComponent(token));
      ws.onclose = function() {
        // Only reconnect when still logged in
        if (sessionStorage.getItem('access_token')) {
          setTimeout(connect, 3000);
        }
      };
      ws.onerror = function() {};
      ws.onmessage = function(e) {
        var msg; try { msg = JSON.parse(e.data); } catch(_) { return; }
        _handleWsMsg(msg);
      };
    }
    connect();
  }, 20);
})();

// ── INCOMING CALL UI ──────────────────────────────────────────────
var _incomingCallId = null;
var _incomingRingInterval = null;

function _showIncomingCallUI(msg) {
  _removeIncomingCallUI();
  _incomingCallId = msg.call_id;
  var callerName = msg.caller_name || 'Someone';
  var kind = msg.kind || 'audio';

  // Inject style once
  if (!document.getElementById('sc-incoming-style')) {
    var st = document.createElement('style');
    st.id = 'sc-incoming-style';
    st.textContent = '@keyframes sc-ring-pulse{0%,100%{transform:scale(1);}50%{transform:scale(1.12);}}';
    document.head.appendChild(st);
  }

  var ov = document.createElement('div');
  ov.id = 'sc-incoming-overlay';
  ov.style.cssText = 'position:fixed;inset:0;z-index:999999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.6);';

  var initials = callerName.split(' ').map(function(w){return w[0]||'';}).join('').toUpperCase().slice(0,2);

  ov.innerHTML =
    '<div style="background:#1e2025;border-radius:24px;padding:40px 36px;min-width:320px;text-align:center;color:#fff;box-shadow:0 24px 80px rgba(0,0,0,0.5);">' +
      '<div style="width:80px;height:80px;border-radius:50%;background:linear-gradient(135deg,#2ec4b6,#38bdf8);display:flex;align-items:center;justify-content:center;font-size:28px;font-weight:800;color:#fff;margin:0 auto 16px;animation:sc-ring-pulse 1s infinite;">' + initials + '</div>' +
      '<div style="font-size:11px;color:rgba(255,255,255,0.45);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">Incoming ' + (kind === 'video' ? 'Video' : 'Audio') + ' Call</div>' +
      '<div style="font-size:20px;font-weight:800;margin-bottom:28px;">' + callerName + '</div>' +
      '<div style="display:flex;justify-content:center;gap:24px;">' +
        '<div style="text-align:center;">' +
          '<button onclick="_declineIncomingCall()" style="width:60px;height:60px;border-radius:50%;background:#ef4444;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;margin:0 auto 8px;">' +
            '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="transform:rotate(135deg)"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.6 1.18h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.77a16 16 0 0 0 6 6l.93-.93a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7a2 2 0 0 1 1.72 2.03z"/></svg>' +
          '</button>' +
          '<div style="font-size:12px;color:rgba(255,255,255,0.5);">Decline</div>' +
        '</div>' +
        '<div style="text-align:center;">' +
          '<button onclick="_acceptIncomingCall()" style="width:60px;height:60px;border-radius:50%;background:#22c55e;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;margin:0 auto 8px;">' +
            '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.6 1.18h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.77a16 16 0 0 0 6 6l.93-.93a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7a2 2 0 0 1 1.72 2.03z"/></svg>' +
          '</button>' +
          '<div style="font-size:12px;color:rgba(255,255,255,0.5);">Accept</div>' +
        '</div>' +
      '</div>' +
    '</div>';

  document.body.appendChild(ov);
}

function _removeIncomingCallUI() {
  var el = document.getElementById('sc-incoming-overlay');
  if (el) el.remove();
  if (_incomingRingInterval) { clearInterval(_incomingRingInterval); _incomingRingInterval = null; }
}

async function _acceptIncomingCall() {
  if (!_incomingCallId) return;
  var callId = _incomingCallId;
  _removeIncomingCallUI();
  try {
    var r = await fetch(API_BASE + '/calls/' + callId + '/accept', {
      method: 'POST', headers: staffAuthHeaders()
    });
    var data = await r.json();
    _sc.callId = callId;
    _sc.state = 'active';
    _showActiveCallOverlay('Caller');
    // Connect to LiveKit with the callee token from the accept response
    if (data.join_payload && data.join_payload.livekit_url && data.join_payload.access_token) {
      _scLkConnect(data.join_payload.livekit_url, data.join_payload.access_token);
    }
    // Start polling to detect when call ends
    _sc.pollInt = setInterval(async function() {
      try {
        var r2 = await fetch(API_BASE + '/calls/' + callId, { headers: staffAuthHeaders() });
        if (!r2.ok) return;
        var d = await r2.json();
        if (d.state === 'ended' || d.state === 'canceled' || d.state === 'timeout') {
          clearInterval(_sc.pollInt);
          _sc.state = 'idle';
          _removeActiveCallOverlay();
        }
      } catch(_) {}
    }, 1500);
  } catch(e) {
    console.error('Accept call failed', e);
  }
}

async function _declineIncomingCall() {
  if (!_incomingCallId) return;
  var callId = _incomingCallId;
  _removeIncomingCallUI();
  _incomingCallId = null;
  try {
    await fetch(API_BASE + '/calls/' + callId + '/decline', {
      method: 'POST', headers: staffAuthHeaders()
    });
  } catch(e) {}
}

// ── Entry point called from DOMContentLoaded in staff.js ──
function _initDoctorTab() {
  _injectDoctorEditModal();
  _injectTaskCreateModal();
  _loadDoctorBookings();
}

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
// ══════════════════════════════════════════════════════════════════
// ── DOCTOR ASSIGNED ACTIVITIES / CARE TASKS
// Doctors can assign activities from Doctor Summary. The mobile client
// reads these from GET /api/v1/tasks and receives task.created events.
// ══════════════════════════════════════════════════════════════════
let _taskCreateBookingId = null;

function _todayIsoDate() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function _injectTaskCreateModal() {
  if (document.getElementById('modal-task-create')) return;

  const el = document.createElement('div');
  el.id = 'modal-task-create';
  el.className = 'overlay';
  el.setAttribute('onclick', "if(event.target===this)_closeTaskCreateModal()");
  el.innerHTML = `
    <div class="sc-modal" style="max-width:560px;">
      <div class="mhdr">
        <h3>Assign Patient Activity</h3>
        <button class="mclose" onclick="_closeTaskCreateModal()">✕</button>
      </div>
      <div class="mbody">
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:14px;margin-bottom:16px;">
          <div style="font-size:10px;font-weight:800;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px;">Patient</div>
          <select class="fsel" id="task-resident-select"></select>
          <div id="task-booking-context" style="font-size:12px;color:#64748b;margin-top:8px;"></div>
        </div>

        <div class="mbody-section">
          <div style="display:grid;grid-template-columns:1fr 150px;gap:12px;margin-bottom:14px;">
            <div>
              <label class="flabel">Activity title</label>
              <input class="finput" id="task-title" placeholder="e.g. Morning walk for 20 minutes" />
            </div>
            <div>
              <label class="flabel">Type</label>
              <select class="fsel" id="task-type">
                <option value="activity">Activity</option>
                <option value="exercise">Exercise</option>
                <option value="medication">Medication</option>
                <option value="meal">Meal</option>
                <option value="wellness_check">Wellness check</option>
                <option value="doctor_followup">Doctor follow up</option>
                <option value="hydration">Hydration</option>
              </select>
            </div>
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr 150px;gap:12px;margin-bottom:14px;">
            <div>
              <label class="flabel">Due date</label>
              <input class="finput" id="task-date" type="date" />
            </div>
            <div>
              <label class="flabel">Due time</label>
              <input class="finput" id="task-time" type="time" />
            </div>
            <div>
              <label class="flabel">Priority</label>
              <select class="fsel" id="task-priority">
                <option value="low">Low</option>
                <option value="medium" selected>Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
          </div>

          <div>
            <label class="flabel">Instructions</label>
            <textarea class="finput" id="task-description" rows="4" placeholder="Add simple instructions for the patient or resident…" style="resize:vertical;min-height:90px;"></textarea>
          </div>
        </div>

        <div id="task-create-error" style="display:none;color:#ef4444;font-size:13px;margin-top:10px;padding:8px 12px;background:#fee2e2;border-radius:8px;"></div>
      </div>
      <div class="mfooter">
        <button class="btn btn-outline" onclick="_closeTaskCreateModal()">Cancel</button>
        <button class="btn btn-primary" id="task-create-save" onclick="_saveCareTask()">Assign Activity</button>
      </div>
    </div>`;
  document.body.appendChild(el);
}

function _openTaskCreateModal(bookingId) {
  _injectTaskCreateModal();
  _taskCreateBookingId = bookingId || null;

  const select = document.getElementById('task-resident-select');
  const context = document.getElementById('task-booking-context');
  const title = document.getElementById('task-title');
  const type = document.getElementById('task-type');
  const date = document.getElementById('task-date');
  const time = document.getElementById('task-time');
  const priority = document.getElementById('task-priority');
  const desc = document.getElementById('task-description');
  const err = document.getElementById('task-create-error');

  const patients = [];
  const seen = new Set();
  (_doctorBookingsAll || []).forEach(b => {
    if (!b.resident_id || seen.has(String(b.resident_id))) return;
    seen.add(String(b.resident_id));
    patients.push({ id: b.resident_id, name: b.resident || `Resident #${b.resident_id}` });
  });

  if (select) {
    select.innerHTML = patients.length
      ? patients.map(p => `<option value="${p.id}">${_esc(p.name)} · ID #${p.id}</option>`).join('')
      : '<option value="">No patients found</option>';
  }

  const booking = bookingId ? _doctorBookingsAll.find(b => b.id === bookingId) : null;
  if (booking && select) select.value = String(booking.resident_id);

  if (context) {
    context.textContent = booking
      ? `Linked to ${booking.type || 'appointment'} on ${booking.date || ''} ${(booking.time || '').slice(0,5)}`
      : 'Select a patient from your appointment list.';
  }

  if (title) title.value = booking ? _suggestTaskTitleFromBooking(booking) : '';
  if (type) type.value = booking ? _suggestTaskTypeFromBooking(booking) : 'activity';
  if (date) date.value = booking && booking.date ? booking.date : _todayIsoDate();
  if (time) time.value = booking && booking.time ? String(booking.time).slice(0,5) : '';
  if (priority) priority.value = 'medium';
  if (desc) desc.value = booking && booking.notes ? `Doctor notes: ${booking.notes}` : '';
  if (err) err.style.display = 'none';

  document.getElementById('modal-task-create').classList.add('open');
}

function _suggestTaskTitleFromBooking(booking) {
  const type = String(booking.type || '').toLowerCase();
  if (type.includes('physio') || type.includes('rehab')) return 'Complete recommended mobility exercise';
  if (type.includes('diet') || type.includes('nutrition')) return 'Follow recommended meal plan';
  if (type.includes('medication')) return 'Follow medication instructions after consultation';
  if (type.includes('check') || type.includes('review')) return 'Complete follow up wellness check';
  return 'Complete doctor assigned activity';
}

function _suggestTaskTypeFromBooking(booking) {
  const type = String(booking.type || '').toLowerCase();
  if (type.includes('physio') || type.includes('rehab') || type.includes('exercise')) return 'exercise';
  if (type.includes('diet') || type.includes('nutrition') || type.includes('meal')) return 'meal';
  if (type.includes('medication')) return 'medication';
  if (type.includes('follow') || type.includes('review') || type.includes('doctor')) return 'doctor_followup';
  return 'activity';
}

function _closeTaskCreateModal() {
  const m = document.getElementById('modal-task-create');
  if (m) m.classList.remove('open');
  _taskCreateBookingId = null;
}

async function _saveCareTask() {
  const residentId = Number((document.getElementById('task-resident-select') || {}).value || 0);
  const title = (document.getElementById('task-title') || {}).value || '';
  const taskType = (document.getElementById('task-type') || {}).value || 'activity';
  const dueDate = (document.getElementById('task-date') || {}).value || null;
  const dueTime = (document.getElementById('task-time') || {}).value || null;
  const priority = (document.getElementById('task-priority') || {}).value || 'medium';
  const description = (document.getElementById('task-description') || {}).value || '';
  const err = document.getElementById('task-create-error');
  const save = document.getElementById('task-create-save');

  if (err) err.style.display = 'none';

  if (!residentId) {
    if (err) { err.textContent = 'Please select a patient.'; err.style.display = 'block'; }
    return;
  }
  if (!String(title).trim()) {
    if (err) { err.textContent = 'Please enter an activity title.'; err.style.display = 'block'; }
    return;
  }

  if (save) { save.disabled = true; save.textContent = 'Assigning…'; }

  try {
    const res = await fetch(`${API_BASE}/tasks/`, {
      method: 'POST',
      headers: staffAuthHeaders(),
      body: JSON.stringify({
        resident_id: residentId,
        title: String(title).trim(),
        description: String(description).trim() || null,
        task_type: taskType,
        priority,
        due_date: dueDate || null,
        due_time: dueTime || null,
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.detail || data.message || 'Could not assign activity');
    }
    _closeTaskCreateModal();
    if (typeof _scShowToast === 'function') _scShowToast('Activity assigned to patient');
    else alert('Activity assigned to patient');
  } catch (e) {
    if (err) { err.textContent = e.message || 'Could not assign activity'; err.style.display = 'block'; }
  } finally {
    if (save) { save.disabled = false; save.textContent = 'Assign Activity'; }
  }
}