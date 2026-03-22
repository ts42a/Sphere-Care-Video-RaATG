// Clock
function updateClock(){
  const d=new Date();
  document.getElementById('topbar-date').textContent=
    d.toLocaleDateString('en-AU',{day:'numeric',month:'long',year:'numeric'})
    +' · '+d.toLocaleTimeString('en-AU',{hour:'2-digit',minute:'2-digit'});
}
updateClock(); setInterval(updateClock,1000);

// Navigation labels


// ════ API CONFIG ════
function authHeaders(){ const t=localStorage.getItem('access_token'); return t ? {'Content-Type':'application/json','Authorization':`Bearer ${t}`} : {'Content-Type':'application/json'}; }

async function apiFetch(path, opts={}){
  const res = await fetch(API_BASE + path, { headers: authHeaders(), ...opts });
  if(!res.ok){ const e=await res.json().catch(()=>({})); throw new Error(e.detail||`API error ${res.status}`); }
  return res.json();
}

// ════ HELPERS ════
const COLORS=['#7c3aed','#db2777','#0369a1','#059669','#d97706','#dc2626','#2563eb','#9333ea','#0e7490','#be185d'];
function ini(n){return(n||'?').split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2);}
function fmtDate(d){ if(!d)return'—'; try{return new Date(d).toLocaleDateString('en-AU',{day:'numeric',month:'short',year:'numeric'});}catch{return d;} }

let residents=[],filtered=[],currentView='grid';

// Map API resident → internal shape (fields from seed.py / models.Resident)
function mapResident(r,i){
  return {
    rawId:  r.id,
    id:     r.id ? 'RES'+String(r.id).padStart(3,'0') : 'RES???',
    name:   r.full_name  || 'Unknown',
    age:    r.age        ?? '—',
    room:   String(r.room ?? '—'),
    status: (r.status    || 'stable').toLowerCase(),
    admit:  fmtDate(r.admission_date),
    carer:  r.assigned_carer || 'Unassigned',
    ai:     r.ai_summary || 'No AI summary available.',
    flags:  r.flag_count ?? 0,
    color:  COLORS[i % COLORS.length],
    img:    null,
  };
}

// ════ LOAD ════
function showLoading(on){
  let el=document.getElementById('loading-bar');
  if(!el){el=document.createElement('div');el.id='loading-bar';el.style.cssText='position:fixed;top:0;left:0;width:100%;height:3px;background:var(--teal);z-index:9999;transition:opacity .4s;';document.body.prepend(el);}
  el.style.opacity=on?'1':'0';
}

function showBanner(msg, ok){
  let el=document.getElementById('api-banner');
  if(!el){el=document.createElement('div');el.id='api-banner';el.style.cssText='position:fixed;bottom:18px;right:18px;padding:9px 16px;border-radius:10px;font-size:12px;font-weight:700;z-index:999;transition:opacity 3s;';document.body.append(el);}
  el.textContent=msg; el.style.background=ok?'#dcfce7':'#fef2f2'; el.style.color=ok?'#15803d':'#b91c1c'; el.style.opacity='1';
  setTimeout(()=>el.style.opacity='0',3500);
}

async function loadResidents(){
  showLoading(true);
  try{
    const data = await apiFetch('/residents/');
    residents = data.map(mapResident);
    showBanner('✓ Loaded from API','ok');
  } catch(err){
    console.error('Failed to load residents:', err.message);
    showBanner('✗ Could not reach API — check server is running','err');
    residents=[];
  }
  filtered=[...residents];
  render();
  updateStats();
  showLoading(false);
}

// ════ RENDER ════
function render(){renderGrid();renderList();}

function renderGrid(){
  if(!filtered.length){
    document.getElementById('view-grid').innerHTML=`<div style="grid-column:1/-1;text-align:center;padding:60px 0;color:var(--text3);"><div style="font-size:40px;margin-bottom:12px;">🔍</div><div style="font-weight:700;font-size:14px;">No residents found</div></div>`;
    return;
  }
  document.getElementById('view-grid').innerHTML=filtered.map(r=>`
    <div class="gc-card" onclick="openProfile('${r.id}')">
      <div class="gc-av" style="background:${r.color}">${r.img?`<img src="${r.img}"/>`:''}${!r.img?ini(r.name):''}</div>
      <div style="font-size:14px;font-weight:800;margin-bottom:2px;">${r.name}</div>
      <div style="font-size:11px;color:var(--text3);margin-bottom:8px;">${r.id}</div>
      <div style="display:flex;align-items:center;justify-content:center;gap:8px;margin-bottom:10px;flex-wrap:wrap;">
        <span class="room-pill">Room ${r.room}</span>
        <span style="font-size:12px;color:var(--text2)">Age ${r.age}</span>
        <span class="flag-num ${r.flags>=2?'fn-high':r.flags>0?'fn-med':'fn-none'}" title="${r.flags} flag(s)">${r.flags}</span>
      </div>
      <span class="badge ${r.status==='stable'?'b-stable':'b-monitoring'}">${r.status.charAt(0).toUpperCase()+r.status.slice(1)}</span>
    </div>`).join('');
}

function renderList(){
  document.getElementById('res-tbody').innerHTML=filtered.map(r=>`
    <tr style="border-bottom:1px solid #f6f8fb;cursor:pointer;transition:background .12s;" onmouseover="this.style.background='#f8fbff'" onmouseout="this.style.background=''" onclick="openProfile('${r.id}')">
      <td style="padding:13px 16px;vertical-align:middle;">
        <div style="display:flex;align-items:center;gap:12px;">
          <div class="r-av" style="background:${r.color}">${r.img?`<img src="${r.img}"/>`:ini(r.name)}</div>
          <div><div style="font-weight:700;font-size:13.5px;">${r.name}</div><div style="font-size:11px;color:var(--text3);">${r.id}</div></div>
        </div>
      </td>
      <td style="padding:13px 16px;vertical-align:middle;"><span class="room-pill">Room ${r.room}</span></td>
      <td style="padding:13px 16px;vertical-align:middle;font-size:13px;">${r.age}</td>
      <td style="padding:13px 16px;vertical-align:middle;"><span class="flag-num ${r.flags>=2?'fn-high':r.flags>0?'fn-med':'fn-none'}">${r.flags}</span></td>
      <td style="padding:13px 16px;vertical-align:middle;font-size:12.5px;">${r.admit}</td>
      <td style="padding:13px 16px;vertical-align:middle;max-width:170px;font-size:12.5px;color:var(--text2);">${(r.ai||'').split('.')[0]}.</td>
      <td style="padding:13px 16px;vertical-align:middle;"><span class="badge ${r.status==='stable'?'b-stable':'b-monitoring'}">${r.status.charAt(0).toUpperCase()+r.status.slice(1)}</span></td>
      <td style="padding:13px 16px;vertical-align:middle;">
        <button class="rec-btn" onclick="event.stopPropagation();openProfile('${r.id}')">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>Profile
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
  filtered=residents.filter(r=>(!s||r.name.toLowerCase().includes(s)||r.room.includes(s)||r.id.toLowerCase().includes(s))&&(!st||r.status===st));
  render();
}

// ════ PROFILE MODAL — uses data from list response only ════
const sevMap={high:{cls:'fd-high',icon:'🔴'},medium:{cls:'fd-med',icon:'🟡'},low:{cls:'fd-low',icon:'🟢'}};

function openProfile(id){
  const r=residents.find(x=>x.id===id);if(!r)return;

  // Header
  const pav=document.getElementById('p-av');
  pav.style.background=r.color;
  pav.innerHTML=ini(r.name);
  document.getElementById('p-name').textContent=r.name;
  document.getElementById('p-sub').textContent=`${r.age} years • Room ${r.room} • Carer: ${r.carer}`;
  document.getElementById('p-status').innerHTML=`<span class="badge ${r.status==='stable'?'b-stable':'b-monitoring'}">${r.status.charAt(0).toUpperCase()+r.status.slice(1)}</span>`;

  // Overview
  document.getElementById('p-admit').textContent=r.admit;
  document.getElementById('p-carer').textContent=r.carer;
  document.getElementById('p-room').textContent='Room '+r.room;
  document.getElementById('p-age').textContent=r.age+' years';
  document.getElementById('p-ai').textContent=r.ai;
  document.getElementById('p-bp').textContent='—';
  document.getElementById('p-hr').textContent='—';
  document.getElementById('p-wt').textContent='—';

  // Notes from full resident object if available
  const notes = Array.isArray(r.notes) ? r.notes : [];
  document.getElementById('p-notes').innerHTML=notes.length
    ? notes.map(n=>`<div class="note-item"><div class="note-dot"></div><div><div class="note-date">${fmtDate(n.date||n.created_at)||''}</div><div class="note-txt">${n.content||n.text||n}</div></div></div>`).join('')
    : '<div style="color:var(--text3);font-size:13px;padding:12px 0;">No clinical notes on file.</div>';

  // Emergency contact
  const ec=r.emergency_contact||{};
  const ecName=ec.name||ec.full_name||r.emergency_contact_name||'—';
  const ecRel=ec.relationship||ec.rel||r.emergency_contact_rel||'—';
  const ecPhone=ec.phone||r.emergency_contact_phone||'—';
  const ecEmail=ec.email||r.emergency_contact_email||'';
  document.getElementById('p-family').innerHTML=`
    <div style="font-size:13px;color:var(--text2);margin-bottom:14px;">Emergency contact on file for ${r.name}.</div>
    <div class="fam-card">
      <div class="fam-av">${ini(ecName)}</div>
      <div>
        <div class="fam-name">${ecName}</div>
        <div class="fam-rel">${ecRel}</div>
        <div class="fam-contact">📞 ${ecPhone}</div>
        ${ecEmail?`<div class="fam-contact">✉️ ${ecEmail}</div>`:''}
      </div>
    </div>`;

  // Flags
  const flags=Array.isArray(r.flags_list)?r.flags_list:[];
  document.getElementById('p-flags').innerHTML=flags.length===0
    ? `<div style="text-align:center;padding:40px 0;color:var(--text2)"><div style="font-size:36px;margin-bottom:10px">✅</div><div style="font-weight:700">No active flags</div><div style="font-size:13px;margin-top:4px;">This resident has no flagged incidents.</div></div>`
    : flags.map(f=>{
        const sev=(f.severity||'low').toLowerCase();
        const s=sevMap[sev]||sevMap.low;
        return`<div class="flag-item">
          <div class="fdot ${s.cls}">${s.icon}</div>
          <div style="flex:1;">
            <div class="flag-title">${f.event_type||'Flag'} — <span style="font-weight:500;color:var(--text2);">${f.description||''}</span></div>
            <div class="flag-meta">Severity: ${f.severity||'—'} · Source: ${f.source||'—'} · Status: <b>${f.status||'—'}</b>${f.ai_confidence?` · AI Confidence: ${f.ai_confidence}%`:''}</div>
            ${f.transcript?`<details style="margin-top:8px;"><summary style="font-size:11.5px;color:var(--teal);cursor:pointer;font-weight:700;">View transcript</summary><pre style="font-size:11.5px;color:var(--text2);background:#f8fbff;border:1px solid #dbeafe;border-radius:8px;padding:10px;margin-top:6px;white-space:pre-wrap;font-family:Manrope,sans-serif;">${f.transcript}</pre></details>`:''}
          </div>
        </div>`;}).join('');

  // Records
  const recs=Array.isArray(r.records)?r.records:[];
  document.getElementById('p-records').innerHTML=recs.length
    ? recs.map(rc=>`
      <div style="display:flex;gap:12px;padding:12px 0;border-bottom:1px solid #f0f4f8;align-items:flex-start;">
        <div style="width:34px;height:34px;border-radius:9px;background:#eff6ff;display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0;">${rc.record_type==='video'?'🎥':rc.record_type==='audio'?'🎙️':'📄'}</div>
        <div>
          <div style="font-size:13px;font-weight:700;margin-bottom:2px;">${rc.category||'Record'}</div>
          <div style="font-size:11.5px;color:var(--text3);margin-bottom:4px;">${fmtDate(rc.recorded_at)} · ${rc.recorded_time||''}${rc.duration?' · '+rc.duration:''}</div>
          <div style="font-size:12.5px;color:var(--text2);">${rc.notes||''}</div>
        </div>
      </div>`).join('')
    : `<div style="text-align:center;padding:40px 0;color:var(--text2);"><div style="font-size:40px;margin-bottom:12px;">📁</div><div style="font-weight:700;">No records yet</div><div style="font-size:13px;margin-top:4px;">Care records will appear here once added.</div></div>`;

  // Reset tabs
  document.querySelectorAll('.ptab').forEach(t=>t.classList.remove('active'));
  document.querySelectorAll('.ptab-content').forEach(t=>t.classList.remove('active'));
  document.querySelectorAll('.ptab')[0].classList.add('active');
  document.getElementById('ptab-overview').classList.add('active');
  openModal('modal-profile');
}

function switchTab(tab,el){
  document.querySelectorAll('.ptab').forEach(t=>t.classList.remove('active'));
  document.querySelectorAll('.ptab-content').forEach(t=>t.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('ptab-'+tab).classList.add('active');
}

// ════ ADD RESIDENT — POST to API ════
function openAddModal(){
  ['add-name','add-age','add-room','add-admit','add-carer','ec-name','ec-phone','ec-email'].forEach(id=>{document.getElementById(id).value='';});
  document.getElementById('ec-rel').value='';
  document.getElementById('add-av-preview').innerHTML='🧑';
  document.getElementById('add-av-data').value='';
  const errEl=document.getElementById('add-err');
  errEl.style.display='none';
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
  const btn     = document.querySelector('#modal-add .btn-primary');

  if(!name||!age||!room){errEl.textContent='Please fill in Name, Age and Room Number.';errEl.style.display='block';return;}
  if(!ecName||!ecRel||!ecPhone){errEl.textContent='Please fill in Emergency Contact name, relationship and phone.';errEl.style.display='block';return;}
  errEl.style.display='none';

  const payload={
    full_name:               name,
    age:                     parseInt(age),
    room_number:             room,
    admission_date:          admit||new Date().toISOString().slice(0,10),
    assigned_carer:          carer||'Unassigned',
    status:                  'stable',
    emergency_contact_name:  ecName,
    emergency_contact_rel:   ecRel,
    emergency_contact_phone: ecPhone,
    emergency_contact_email: ecEmail,
  };

  btn.textContent='Saving…';btn.disabled=true;
  try{
    await apiFetch('/residents/',{method:'POST',body:JSON.stringify(payload)});
    await loadResidents();
    closeModal('modal-add');
    showBanner('✓ Resident added','ok');
  } catch(err){
    errEl.textContent='⚠ '+err.message;
    errEl.style.background='#fef2f2';errEl.style.color='var(--red)';
    errEl.style.display='block';
  } finally{
    btn.textContent='Add Resident';btn.disabled=false;
  }
}

function previewAv(input,prevId,dataId){
  const file=input.files[0];if(!file)return;
  const reader=new FileReader();
  reader.onload=e=>{document.getElementById(prevId).innerHTML=`<img src="${e.target.result}"/>`;if(dataId)document.getElementById(dataId).value=e.target.result;};
  reader.readAsDataURL(file);
}

function openModal(id){document.getElementById(id).classList.add('open');document.body.style.overflow='hidden';}
function closeModal(id){document.getElementById(id).classList.remove('open');document.body.style.overflow='';}
function exportPDF(){
  const was=currentView==='grid';
  if(was)setView('list');
  setTimeout(()=>{window.print();if(was)setView('grid');},100);
}

document.addEventListener('DOMContentLoaded', function() {
  // Overlay click to close
  document.querySelectorAll('.overlay').forEach(o=>{o.addEventListener('click',e=>{if(e.target===o)closeModal(o.id);});});

  // Set active nav
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  const resNav = Array.from(document.querySelectorAll('.nav-item')).find(el=>(el.getAttribute('onclick')||'').includes("'residents'"));
  if(resNav) resNav.classList.add('active');
  const tb = document.getElementById('topbar-title');
  if(tb) tb.textContent='Residents';

  loadResidents();
});
