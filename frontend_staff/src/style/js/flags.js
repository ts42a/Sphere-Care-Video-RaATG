const COLORS = ['#7c3aed','#db2777','#0369a1','#059669','#d97706','#dc2626','#2563eb','#9333ea'];

// ── CLOCK ──
function tick(){
  const d=new Date();
  document.getElementById('tb-date').textContent=d.toLocaleDateString('en-AU',{day:'numeric',month:'long',year:'numeric'});
  document.getElementById('tb-time').textContent=d.toLocaleTimeString('en-AU',{hour:'2-digit',minute:'2-digit'});
}
tick(); setInterval(tick,1000);

// ── AUTH ──
function authHeaders(){
  const h={'Content-Type':'application/json'};
  const t=localStorage.getItem('access_token');
  if(t) h['Authorization']=`Bearer ${t}`;
  return h;
}

// ── resident color map (for API data) ──
const COLOR_MAP = {};
let colorIdx = 0;
function resColor(resId){
  if(!COLOR_MAP[resId]) COLOR_MAP[resId] = COLORS[colorIdx++ % COLORS.length];
  return COLOR_MAP[resId];
}

let allFlags = [];
let filteredFlags = [];

// API CALLS

async function loadStats(){
  try {
    const res = await fetch(`${API_BASE}/flags/stats`, {headers: authHeaders()});
    if(!res.ok) throw new Error();
    const s = await res.json();
    document.getElementById('st-ai').textContent      = s.ai_flags_today;
    document.getElementById('st-manual').textContent  = s.manual_flags;
    document.getElementById('st-pending').textContent = s.pending_review;
    document.getElementById('st-resolved').textContent= s.resolved;
  } catch(e){
    // keep demo numbers already in HTML
  }
}

async function loadFlags(){
  const search = document.getElementById('flag-search').value.trim();
  const etype  = document.getElementById('f-etype').value;
  const sev    = document.getElementById('f-sev').value;
  const st     = document.getElementById('f-status').value;

  const params = new URLSearchParams();
  if(search) params.set('search', search);
  if(etype)  params.set('event_type', etype);
  if(sev)    params.set('severity', sev);
  if(st)     params.set('status', st);

  try {
    const res = await fetch(`${API_BASE}/flags/?${params}`, {headers: authHeaders()});
    if(!res.ok) throw new Error();
    const data = await res.json();
    // if API returns data use it, else fallback to demo
    allFlags = data.map(normaliseFlag);
    showApiStatus(true);
  } catch(e) {
    allFlags = [];
    showApiError('flags-tbody', 7);
    showApiStatus(false);
  }
  filteredFlags = [...allFlags];
  renderFlags();
  if(typeof hideSkeleton === 'function') hideSkeleton();
}

// normalise API flag → same shape as demo flags
function normaliseFlag(f){
  return {
    id:             f.id,
    resident_name:  f.resident_name,
    resident_id:    f.resident_id || '',
    event_type:     f.event_type,
    description:    f.description,
    severity:       f.severity,
    flagged_at:     f.flagged_at,
    status:         f.status,
    source:         f.source,
    ai_confidence:  f.ai_confidence,
    sev_desc:       f.sev_desc,
    transcript:     f.transcript,
    video_timestamp:f.video_timestamp,
  };
}

// parse "Oct 23, 2024 02:40 PM" → { date, time }
function splitDatetime(str){
  if(!str) return {date:'—', time:''};
  const parts = str.split(' ');
  // format: "Oct 23, 2024 02:40 PM"  → date = "Oct 23, 2024", time = "02:40 PM"
  if(parts.length >= 4){
    return {date: parts.slice(0,3).join(' '), time: parts.slice(3).join(' ')};
  }
  return {date: str, time:''};
}

// RENDER
function ini(n){ return (n||'??').split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2); }

function renderFlags(){
  const tbody = document.getElementById('flags-tbody');
  if(!filteredFlags.length){
    tbody.innerHTML=`<tr><td colspan="7" style="text-align:center;padding:40px;color:var(--text3);">No flags match the current filters.</td></tr>`;
    return;
  }
  tbody.innerHTML = filteredFlags.map(f => {
    const sev     = f.severity || 'Low';
    const etype   = f.event_type || '';
    const resId   = f.resident_id || '';
    const resName = f.resident_name || '—';
    const color   = resColor(resId || resName);
    const sevClass= sev==='High'?'sv-high':sev==='Medium'?'sv-medium':'sv-low';
    const etKey   = etype.toLowerCase().replace(/\s+/g,'-');
    const stClass = f.status==='Resolved'?'st-resolved':f.status==='Open'?'st-open':f.status==='Escalated'?'st-escalated':'st-pending';
    const aiTag   = f.source==='AI' && f.ai_confidence
      ? `<div style="font-size:10.5px;color:var(--text3);margin-top:3px;">AI ${f.ai_confidence}%</div>`
      : f.source==='AI' ? `<div style="font-size:10.5px;color:var(--text3);margin-top:3px;">AI Detected</div>` : '';
    const dt = splitDatetime(f.flagged_at);
    return `<tr onclick="openFlagModal(${f.id})">
      <td>
        <div class="res-cell">
          <div class="res-av" style="background:${color}" onclick="event.stopPropagation();openResidentModal('${resId}','${resName}')">${ini(resName)}</div>
          <div>
            <div class="res-name" onclick="event.stopPropagation();openResidentModal('${resId}','${resName}')">${resName}</div>
            <div class="res-id">${resId}</div>
          </div>
        </div>
      </td>
      <td><span class="etype-pill et-${etKey}">${etype}</span></td>
      <td style="font-size:13px;color:var(--text2);max-width:200px;">${f.description}</td>
      <td><span class="sev-pill ${sevClass}"><span class="sev-dot"></span>${sev}</span></td>
      <td><div style="font-size:13px;font-weight:600;">${dt.date}</div><div style="font-size:12px;color:var(--text3);">${dt.time}</div></td>
      <td><span class="status-pill ${stClass}">${f.status}</span>${aiTag}</td>
      <td><button class="view-btn" onclick="event.stopPropagation();openFlagModal(${f.id})"><svg viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>View</button></td>
    </tr>`;
  }).join('');
}

// ── client-side filter (for instant search without extra API call) ──
function filterFlags(){
  const search = document.getElementById('flag-search').value.toLowerCase();
  const etype  = document.getElementById('f-etype').value;
  const sev    = document.getElementById('f-sev').value;
  const st     = document.getElementById('f-status').value;
  filteredFlags = allFlags.filter(f => {
    if(search && !f.resident_name?.toLowerCase().includes(search) &&
                 !f.description?.toLowerCase().includes(search) &&
                 !f.event_type?.toLowerCase().includes(search)) return false;
    if(etype && f.event_type !== etype)  return false;
    if(sev   && f.severity   !== sev)    return false;
    if(st    && f.status     !== st)     return false;
    return true;
  });
  renderFlags();
}

// TABS
function switchMainTab(tab, btn){
  document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c=>c.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('tab-'+tab).classList.add('active');
}

// FLAG DETAIL MODAL
function openFlagModal(id){
  const f = allFlags.find(x=>x.id===id);
  if(!f) return;

  document.getElementById('fm-name').textContent   = f.resident_name || '—';
  document.getElementById('fm-source').textContent = f.source==='AI' ? '🤖 AI Detected' : '👤 Staff Flagged';
  document.getElementById('fm-etype').textContent  = f.event_type || '—';
  document.getElementById('fm-timestamp').textContent = f.video_timestamp || '—';

  // transcript — convert plain text \n to HTML
  const rawTrans = f.transcript || 'No transcript available.';
  document.getElementById('fm-transcript').innerHTML = rawTrans
    .replace(/\[([^\]]+)\]/g, "<span class='transcript-highlight'>$1</span>")
    .replace(/\n/g, '<br>');

  // severity box
  const sev = f.severity || 'Low';
  const box = document.getElementById('fm-sev-box');
  box.className = 'flag-sev-box flag-sev-'+(sev==='High'?'high':sev==='Medium'?'medium':'low');
  document.getElementById('fm-sev-icon').textContent = sev==='High'?'🔴':sev==='Medium'?'⚠️':'🟢';
  document.getElementById('fm-sev-text').textContent = sev+' Severity';
  document.getElementById('fm-sev-desc').textContent = f.sev_desc || '—';

  openModal('modal-flag');
}

// RESIDENT PROFILE MODAL
async function openResidentModal(resId, resName){
  // try API first
  let r = null;
  if(resId){
    try {
      // extract numeric ID from "RES005" → 5
      const numId = parseInt(resId.replace(/\D/g,''));
      if(numId){
        const res = await fetch(`${API_BASE}/residents/${numId}`, {headers: authHeaders()});
        if(res.ok) r = await res.json();
      }
    } catch(e){}
  }

  // if not found, build minimal object from name
  if(!r){
    r = {
      name: resName || resId || '—',
      age: '—', room: '—', status: 'stable',
      admit: '—', carer: '—',
      color: resColor(resId || resName),
      ai: 'No AI summary available.',
      ec: {name:'—', rel:'—', phone:'—', email:''},
      notes: [],
    };
  }

  const name   = r.name || r.full_name || resName || '—';
  const age    = r.age || '—';
  const room   = r.room || r.room_number || '—';
  const status = (r.status || 'stable').toLowerCase();
  const color  = r.color || resColor(resId || name);

  document.getElementById('p-av').textContent       = ini(name);
  document.getElementById('p-av').style.background  = color;
  document.getElementById('p-name').textContent     = name;
  document.getElementById('p-sub').textContent      = `${age} years • Room ${room}`;
  document.getElementById('p-status').innerHTML     = `<span class="p-status-pill ps-${status}">${status.charAt(0).toUpperCase()+status.slice(1)}</span>`;
  document.getElementById('p-admit').textContent    = r.admit || r.admission_date || '—';
  document.getElementById('p-carer').textContent    = r.carer || r.assigned_carer || '—';
  document.getElementById('p-room').textContent     = room;
  document.getElementById('p-age').textContent      = age !== '—' ? age+' yrs' : '—';
  document.getElementById('p-ai').textContent       = r.ai || r.ai_summary || 'No AI summary available.';

  // notes
  const notes = Array.isArray(r.notes) ? r.notes : [];
  document.getElementById('p-notes').innerHTML = notes.length
    ? notes.map(n=>`<div class="note-item">${n}</div>`).join('')
    : '<div style="color:var(--text3);font-size:13px;">No notes yet.</div>';

  // family / emergency contact
  const ec = r.ec || {};
  document.getElementById('p-family').innerHTML = `
    <div class="ec-card">
      <div class="ec-name">${ec.name||r.emergency_contact_name||'—'}</div>
      <div class="ec-rel">${ec.rel||r.emergency_contact_rel||'—'}</div>
      <div class="ec-row"><svg viewBox="0 0 24 24"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.6 1.18h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.77a16 16 0 0 0 6 6l.93-.93a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7a2 2 0 0 1 1.72 2.03z"/></svg>${ec.phone||r.emergency_contact_phone||'—'}</div>
      <div class="ec-row"><svg viewBox="0 0 24 24"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>${ec.email||r.emergency_contact_email||'—'}</div>
    </div>`;

  // flags tab — show this resident's flags
  const resFlags = allFlags.filter(f => f.resident_id===resId || f.resident_name===name);
  document.getElementById('p-flags-list').innerHTML = resFlags.length
    ? resFlags.map(f=>`
        <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-radius:10px;border:1px solid var(--border);margin-bottom:8px;cursor:pointer;"
             onclick="closeModal('modal-profile');openFlagModal(${f.id})">
          <div style="display:flex;align-items:center;gap:10px;">
            <span class="etype-pill et-${(f.event_type||'').toLowerCase().replace(/\s+/g,'-')}">${f.event_type}</span>
            <span style="font-size:13px;color:var(--text2);">${f.description}</span>
          </div>
          <div style="font-size:12px;color:var(--text3);">${splitDatetime(f.flagged_at).date}</div>
        </div>`).join('')
    : `<div style="text-align:center;padding:30px;color:var(--text3);">No flags for this resident.</div>`;

  switchProfileTab('overview', document.querySelector('.ptab'));
  openModal('modal-profile');
}

function switchProfileTab(tab, btn){
  document.querySelectorAll('.ptab').forEach(t=>t.classList.remove('active'));
  document.querySelectorAll('.ptab-content').forEach(c=>c.classList.remove('active'));
  if(btn) btn.classList.add('active');
  document.getElementById('ptab-'+tab).classList.add('active');
}

//MODAL HELPERS
function openModal(id){document.getElementById(id).classList.add('open');document.body.style.overflow='hidden';}
function closeModal(id){document.getElementById(id).classList.remove('open');document.body.style.overflow='';}
document.querySelectorAll('.overlay').forEach(o=>o.addEventListener('click',e=>{if(e.target===o)closeModal(o.id);}));

function showApiStatus(connected){
  let el=document.getElementById('api-status');
  if(!el){el=document.createElement('div');el.id='api-status';el.style.cssText='position:fixed;bottom:18px;right:18px;padding:8px 14px;border-radius:10px;font-size:12px;font-weight:700;z-index:999;transition:opacity 3s;';document.body.append(el);}
  el.textContent=connected?'✓ Connected to API':'⚠ Using demo data (API offline)';
  el.style.background=connected?'#dcfce7':'#fff7ed';
  el.style.color=connected?'#15803d':'#c2410c';
  el.style.opacity='1';
  setTimeout(()=>el.style.opacity='0',3000);
}

function showApiError(tbodyId, cols){
  const el=document.getElementById(tbodyId);
  if(el) el.innerHTML=`<tr><td colspan="${cols}" style="text-align:center;padding:40px;color:var(--red);font-size:13px;font-weight:600;">⚠ Unable to load data. Please check your connection.</td></tr>`;
}

// ── INIT ──
loadStats();
loadFlags();