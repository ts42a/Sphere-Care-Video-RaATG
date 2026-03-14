// Set live date
function updateClock(){
  const d=new Date();
  document.getElementById('topbar-date').textContent=
    d.toLocaleDateString('en-AU',{day:'numeric',month:'long',year:'numeric'})
    +' · '+d.toLocaleTimeString('en-AU',{hour:'2-digit',minute:'2-digit'});
}
updateClock(); setInterval(updateClock,1000);

// API CONFIG
// Color palette for avatar fallbacks
const COLORS=['#7c3aed','#db2777','#0369a1','#059669','#d97706','#dc2626','#2563eb','#9333ea'];

// ── Fallback demo data used when API is unreachable ──
let residents = [];
let filtered = [];
let currentView = 'grid';

function ini(n){return n.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2);}

// API CALLS
// Map API response → internal resident object
function mapResident(r, idx) {
  return {
    id:     r.id            ? 'RES' + String(r.id).padStart(3,'0') : ('RES'+String(idx+1).padStart(3,'0')),
    rawId:  r.id,
    name:   r.name          || r.full_name || 'Unknown',
    age:    r.age           || '—',
    room:   String(r.room_number || r.room || '—'),
    status: (r.status       || 'stable').toLowerCase(),
    flags:  r.flags         || 0,
    admit:  r.admission_date|| r.admit || '—',
    carer:  r.assigned_carer|| r.carer || 'Unassigned',
    ai:     r.ai_summary    || r.ai    || 'No AI summary available.',
    ec: {
      name:  r.emergency_contact_name  || r.ec_name  || '—',
      rel:   r.emergency_contact_rel   || r.ec_rel   || '—',
      phone: r.emergency_contact_phone || r.ec_phone || '—',
      email: r.emergency_contact_email || r.ec_email || '',
    },
    notes:  Array.isArray(r.notes) ? r.notes : [],
    color:  COLORS[idx % COLORS.length],
    img:    r.avatar_url    || r.photo_url || null,
  };
}

// GET /residents/
async function loadResidents() {
  showLoading(true);
  try {
    const token = localStorage.getItem('access_token');
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(`${API_BASE}/residents/`, { headers });
    if (!res.ok) throw new Error('API returned ' + res.status);
    const data = await res.json();
    residents = data.map(mapResident);
    showApiStatus(true);
  } catch (err) {
    console.warn('API unavailable:', err.message);
    residents = [];
    showApiStatus(false);
  }
  filtered = [...residents];
  render();
  showLoading(false);
}

// POST /residents/
async function apiCreateResident(payload) {
  const token = localStorage.getItem('access_token');
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}/residents/`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to create resident');
  }
  return res.json();
}

function showLoading(on) {
  let el = document.getElementById('loading-bar');
  if (!el) {
    el = document.createElement('div');
    el.id = 'loading-bar';
    el.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:3px;background:var(--teal);z-index:9999;transition:opacity .3s;';
    document.body.prepend(el);
  }
  el.style.opacity = on ? '1' : '0';
}

function showApiStatus(connected) {
  let el = document.getElementById('api-status');
  if (!el) {
    el = document.createElement('div');
    el.id = 'api-status';
    el.style.cssText = 'position:fixed;bottom:18px;right:18px;padding:8px 14px;border-radius:10px;font-size:12px;font-weight:700;z-index:999;transition:opacity 3s;';
    document.body.append(el);
  }
  el.textContent = connected ? '✓ Connected to API' : '⚠ Using demo data (API offline)';
  el.style.background = connected ? '#dcfce7' : '#fff7ed';
  el.style.color = connected ? '#15803d' : '#c2410c';
  el.style.opacity = '1';
  setTimeout(() => el.style.opacity = '0', 3000);
}
// RENDE
function render(){renderGrid();renderList();updateStats();}

function renderGrid(){
  document.getElementById('view-grid').innerHTML=filtered.map(r=>`
    <div class="gc-card" onclick="openProfile('${r.id}')">
      <div class="gc-av" style="background:${r.color}">${r.img?`<img src="${r.img}"/>`:ini(r.name)}</div>
      <div style="font-size:14px;font-weight:800;margin-bottom:2px;">${r.name}</div>
      <div style="font-size:11px;color:var(--text3);margin-bottom:8px;">${r.id}</div>
      <div style="display:flex;align-items:center;justify-content:center;gap:8px;margin-bottom:10px;flex-wrap:wrap;">
        <span class="room-pill">Room ${r.room}</span>
        <span style="font-size:12px;color:var(--text2)">Age ${r.age}</span>
        <span class="flag-num ${r.flags>=3?'fn-high':r.flags>0?'fn-med':'fn-none'}">${r.flags}</span>
      </div>
      <span class="badge ${r.status==='stable'?'b-stable':'b-monitoring'}">${r.status.charAt(0).toUpperCase()+r.status.slice(1)}</span>
    </div>`).join('');
}

function renderList(){
  document.getElementById('res-tbody').innerHTML=filtered.map(r=>`
    <tr style="border-bottom:1px solid #f6f8fb;cursor:pointer;transition:background .12s;" onmouseover="this.style.background='#f8fbff'" onmouseout="this.style.background=''" onclick="openProfile('${r.id}')">
      <td style="padding:13px 16px;vertical-align:middle;">
        <div style="display:flex;align-items:center;gap:12px;">
          <div class="r-av" style="background:${r.color}" onclick="event.stopPropagation();openProfile('${r.id}')">${r.img?`<img src="${r.img}"/>`:ini(r.name)}</div>
          <div><div style="font-weight:700;font-size:13.5px;">${r.name}</div><div style="font-size:11px;color:var(--text3);">${r.id}</div></div>
        </div>
      </td>
      <td style="padding:13px 16px;vertical-align:middle;"><span class="room-pill">Room ${r.room}</span></td>
      <td style="padding:13px 16px;vertical-align:middle;font-size:13px;">${r.age}</td>
      <td style="padding:13px 16px;vertical-align:middle;"><span class="flag-num ${r.flags>=3?'fn-high':r.flags>0?'fn-med':'fn-none'}">${r.flags}</span></td>
      <td style="padding:13px 16px;vertical-align:middle;"><div style="font-size:12.5px;">${r.admit}</div><div style="font-size:11px;color:var(--text3);">2:30 PM</div></td>
      <td style="padding:13px 16px;vertical-align:middle;max-width:170px;font-size:12.5px;color:var(--text2);">${r.ai.split('.')[0]}.</td>
      <td style="padding:13px 16px;vertical-align:middle;"><span class="badge ${r.status==='stable'?'b-stable':'b-monitoring'}">${r.status.charAt(0).toUpperCase()+r.status.slice(1)}</span></td>
      <td style="padding:13px 16px;vertical-align:middle;">
        <button class="rec-btn" onclick="event.stopPropagation();openProfile('${r.id}')">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>Recording
        </button>
      </td>
    </tr>`).join('');
}

function updateStats(){
  document.getElementById('st-total').textContent=residents.length;
  document.getElementById('st-flags').textContent=residents.filter(r=>r.flags>0).length;
  document.getElementById('st-stable').textContent=residents.filter(r=>r.status==='stable').length;
}

function setView(v){
  currentView=v;
  document.getElementById('view-grid').style.display=v==='grid'?'grid':'none';
  document.getElementById('view-list').style.display=v==='list'?'block':'none';
  document.getElementById('vbtn-grid').classList.toggle('active',v==='grid');
  document.getElementById('vbtn-list').classList.toggle('active',v==='list');
}

function filterResidents(){
  const s=document.getElementById('res-search').value.toLowerCase();
  const st=document.getElementById('f-status').value;
  filtered=residents.filter(r=>{
    return (!s||r.name.toLowerCase().includes(s)||r.room.includes(s)||r.id.toLowerCase().includes(s))&&(!st||r.status===st);
  });
  render();
}

function previewAv(input,prevId,dataId){
  const file=input.files[0];if(!file)return;
  const reader=new FileReader();
  reader.onload=e=>{document.getElementById(prevId).innerHTML=`<img src="${e.target.result}"/>`;if(dataId)document.getElementById(dataId).value=e.target.result;};
  reader.readAsDataURL(file);
}

function openAddModal(){
  ['add-name','add-age','add-room','add-admit','add-carer','ec-name','ec-phone','ec-email'].forEach(id=>{document.getElementById(id).value='';});
  document.getElementById('ec-rel').value='';
  document.getElementById('add-av-preview').innerHTML='🧑';
  document.getElementById('add-av-data').value='';
  document.getElementById('add-err').style.display='none';
  openModal('modal-add');
}

async function submitAdd(){
  const name    = document.getElementById('add-name').value.trim();
  const age     = document.getElementById('add-age').value.trim();
  const room    = document.getElementById('add-room').value.trim();
  const admit   = document.getElementById('add-admit').value;
  const carer   = document.getElementById('add-carer').value.trim();
  const ecName  = document.getElementById('ec-name').value.trim();
  const ecRel   = document.getElementById('ec-rel').value;
  const ecPhone = document.getElementById('ec-phone').value.trim();
  const ecEmail = document.getElementById('ec-email').value.trim();
  const errEl   = document.getElementById('add-err');
  const submitBtn = document.querySelector('#modal-add .btn-primary');

  if(!name||!age||!room){errEl.textContent='Please fill in Name, Age and Room Number.';errEl.style.display='block';return;}
  if(!ecName||!ecRel||!ecPhone){errEl.textContent='Please fill in Emergency Contact name, relationship and phone.';errEl.style.display='block';return;}
  errEl.style.display='none';

  // Build API payload — field names match common FastAPI/SQLAlchemy patterns
  const payload = {
    name,
    age:                      parseInt(age),
    room_number:              room,
    admission_date:           admit || new Date().toISOString().slice(0,10),
    assigned_carer:           carer || 'Unassigned',
    status:                   'stable',
    emergency_contact_name:   ecName,
    emergency_contact_rel:    ecRel,
    emergency_contact_phone:  ecPhone,
    emergency_contact_email:  ecEmail,
  };

  submitBtn.textContent = 'Saving...';
  submitBtn.disabled = true;

  try {
    const created = await apiCreateResident(payload);
    // Reload from API to get server-generated ID
    await loadResidents();
    closeModal('modal-add');
  } catch(err) {
    // Fallback: add locally if API fails
    console.warn('API create failed, adding locally:', err.message);
    const img = document.getElementById('add-av-data').value || null;
    const newR = mapResident({
      ...payload,
      id: residents.length + 1,
      ai_summary: 'New resident admitted. Full assessment pending.',
      notes: [],
    }, residents.length);
    newR.img = img;
    residents.push(newR);
    filtered = [...residents];
    render();
    closeModal('modal-add');
    errEl.textContent = '⚠ Saved locally (API unavailable)';
    errEl.style.background = '#fff7ed';
    errEl.style.color = '#c2410c';
    errEl.style.display = 'block';
  } finally {
    submitBtn.textContent = 'Add Resident';
    submitBtn.disabled = false;
  }
}

function openProfile(id){
  const r=residents.find(x=>x.id===id);if(!r)return;
  const pav=document.getElementById('p-av');
  pav.style.background=r.color;
  pav.innerHTML=r.img?`<img src="${r.img}"/>`:ini(r.name);
  document.getElementById('p-name').textContent=r.name;
  document.getElementById('p-sub').textContent=`${r.age} years • Room ${r.room}`;
  document.getElementById('p-status').innerHTML=`<span class="badge ${r.status==='stable'?'b-stable':'b-monitoring'}">${r.status.charAt(0).toUpperCase()+r.status.slice(1)}</span>`;
  document.getElementById('p-admit').textContent=r.admit;
  document.getElementById('p-carer').textContent=r.carer;
  document.getElementById('p-room').textContent='Room '+r.room;
  document.getElementById('p-age').textContent=r.age+' years';
  document.getElementById('p-ai').textContent=r.ai;
  document.getElementById('p-notes').innerHTML=r.notes.map(n=>{const p=n.split('—');return`<div class="note-item"><div class="note-dot"></div><div><div class="note-date">${p[0].trim()}</div><div class="note-txt">${(p[1]||n).trim()}</div></div></div>`;}).join('');
  document.getElementById('p-family').innerHTML=`<div style="font-size:13px;color:var(--text2);margin-bottom:14px;">Emergency contact on file for ${r.name}.</div><div class="fam-card"><div class="fam-av">${ini(r.ec.name)}</div><div><div class="fam-name">${r.ec.name}</div><div class="fam-rel">${r.ec.rel}</div><div class="fam-contact">📞 ${r.ec.phone}</div>${r.ec.email?`<div class="fam-contact">✉️ ${r.ec.email}</div>`:''}</div></div>`;
  document.getElementById('p-flags').innerHTML=r.flags===0?`<div style="text-align:center;padding:40px 0;color:var(--text2)"><div style="font-size:36px;margin-bottom:10px">✅</div><div style="font-weight:700">No active flags</div></div>`:Array.from({length:r.flags},(_,i)=>`<div class="flag-item"><div class="fdot ${i===0?'fd-high':i===1?'fd-med':'fd-low'}">${i===0?'🔴':i===1?'🟡':'🟢'}</div><div><div class="flag-title">Flag #${i+1} — ${i===0?'High Priority':i===1?'Medium':'Low'}</div><div class="flag-meta">Detected ${r.admit} · Pending review</div></div></div>`).join('');
  document.querySelectorAll('.ptab').forEach(t=>t.classList.remove('active'));
  document.querySelectorAll('.ptab-content').forEach(t=>t.classList.remove('active'));
  document.querySelectorAll('.ptab')[0].classList.add('active');
  document.getElementById('ptab-overview').classList.add('active');
  openModal('modal-profile');
}

function switchTab(tab,el){
  document.querySelectorAll('.ptab').forEach(t=>t.classList.remove('active'));
  document.querySelectorAll('.ptab-content').forEach(t=>t.classList.remove('active'));
  el.classList.add('active');document.getElementById('ptab-'+tab).classList.add('active');
}

function openModal(id){document.getElementById(id).classList.add('open');document.body.style.overflow='hidden';}
function closeModal(id){document.getElementById(id).classList.remove('open');document.body.style.overflow='';}
document.querySelectorAll('.overlay').forEach(o=>{o.addEventListener('click',e=>{if(e.target===o)closeModal(o.id);});});

function exportPDF(){
  const was=currentView==='grid';
  if(was)setView('list');
  setTimeout(()=>{window.print();if(was)setView('grid');},100);
}

// ── Default to residents page ──
document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
document.querySelector('[onclick*="navigate(\'residents\'"]').classList.add('active');
document.getElementById('topbar-title').textContent='Residents';

// ── API init ──
loadResidents();
