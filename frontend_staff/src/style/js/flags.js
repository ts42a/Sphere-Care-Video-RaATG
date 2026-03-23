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

// ── DEMO DATA (fallback) ──
const DEMO_FLAGS = [
  {id:1, resident_name:'Hannah Li',    resident_id:'RES005', event_type:'Distress',   description:'Low mood noted; follow-up set',              severity:'Medium', flagged_at:'Oct 23, 2024 02:40 PM', status:'Pending Review', source:'AI',  ai_confidence:82,
   sev_desc:"Speech cue: 'I don't feel well' — Emotional distress indicator.",
   transcript:"Staff: How are you feeling today, Hannah?\nHannah: Not great. I just feel sad.\n[Distress detected by AI system.]",
   video_timestamp:'00:01:45'},
  {id:2, resident_name:'George Patel', resident_id:'RES004', event_type:'Pain',       description:'Frequent pain reports; under review',          severity:'High',   flagged_at:'Oct 23, 2024 02:32 PM', status:'Pending Review', source:'AI',  ai_confidence:91,
   sev_desc:"Verbal cue: 'My back hurts a lot' — Pain escalation detected.",
   transcript:"Staff: How is your pain level today?\nGeorge: It's really bad, maybe 8 out of 10.\n[High pain level detected by AI system.]",
   video_timestamp:'00:03:12'},
  {id:3, resident_name:'Sarah Johnson', resident_id:'RES001', event_type:'Pain',      description:'Mild back pain after exercise',               severity:'Low',    flagged_at:'Oct 23, 2024 02:30 PM', status:'Pending Review', source:'AI',  ai_confidence:74,
   sev_desc:"Movement pattern indicates mild discomfort post-exercise.",
   transcript:"Staff: How did the exercise go?\nSarah: Good but my back is a little sore.\n[Mild pain indicator detected.]",
   video_timestamp:'00:00:55'},
  {id:4, resident_name:'Patrick Ellis', resident_id:'RES007', event_type:'Agitation', description:'Raised voice during meal; calm now',           severity:'Low',    flagged_at:'Oct 23, 2024 02:25 PM', status:'Resolved',       source:'Staff',ai_confidence:null,
   sev_desc:"Voice tone elevated during meal time. Resident calmed after staff intervention.",
   transcript:"Patrick: I don't want this food!\nStaff: Let's try something else.\n[Agitation resolved by staff.]",
   video_timestamp:'00:02:05'},
  {id:5, resident_name:'Hannah Li',    resident_id:'RES005', event_type:'Crying',     description:'Soft crying detected for 2 minutes.',          severity:'Medium', flagged_at:'Oct 23, 2024 02:20 PM', status:'Open',           source:'AI',  ai_confidence:88,
   sev_desc:"Audio pattern detected: soft crying for approximately 2 minutes.",
   transcript:"AI System: Crying audio pattern detected.\nDuration: 2 minutes 14 seconds.\n[Staff notified automatically.]",
   video_timestamp:'00:01:30'},
  {id:6, resident_name:'George Patel', resident_id:'RES004', event_type:'Pain',       description:'Frequent pain reports; under review',          severity:'High',   flagged_at:'Oct 23, 2024 02:18 PM', status:'Open',           source:'AI',  ai_confidence:93,
   sev_desc:"Repeated pain reports within 30-minute window. Escalation recommended.",
   transcript:"George: The pain hasn't gone away since this morning.\nStaff: I'll get the nurse to check on you.\n[Repeated pain flag — AI escalation alert.]",
   video_timestamp:'00:00:42'},
  {id:7, resident_name:'John Lee',     resident_id:'RES009', event_type:'Medication', description:'Medication refusal detected',                  severity:'Medium', flagged_at:'Oct 23, 2024 02:02 PM', status:'Pending Review', source:'AI',  ai_confidence:76,
   sev_desc:"Speech cue: 'No, not taking it' — Medication compliance issue.",
   transcript:"Staff: John, here's your evening medication.\nJohn: No, not taking it.\n[Refusal detected by AI system.]",
   video_timestamp:'00:02:18'},
  {id:8, resident_name:'Evelyn Brooks', resident_id:'RES003', event_type:'Wandering', description:'Resident found outside designated area',       severity:'Low',    flagged_at:'Oct 22, 2024 11:15 AM', status:'Resolved',       source:'AI',  ai_confidence:85,
   sev_desc:"Movement detected outside designated resident zone during rest period.",
   transcript:"AI System: Resident detected in corridor zone B.\nStaff notified: 11:17 AM.\n[Resident returned to room safely.]",
   video_timestamp:'00:00:20'},
];

const DEMO_RESIDENTS = {
  'RES001':{name:'Sarah Johnson',  age:78,room:'105',status:'monitoring',admit:'Oct 23, 2024',carer:'Sarah Mitchell',  color:'#7c3aed',ai:'Mild back pain after exercise. BP slightly elevated, monitoring closely. Mood stable.',         ec:{name:'James Johnson',rel:'Son',     phone:'+61 400 111 222',email:'james@email.com'},   notes:['Oct 23 — Mild discomfort during physio.','Oct 22 — Medication adjusted.']},
  'RES003':{name:'Evelyn Brooks',  age:68,room:'301',status:'stable',    admit:'Jan 10, 2024',carer:'Jen Rodriguez',  color:'#059669',ai:'All vitals normal. Active in morning exercises. Positive mood throughout the day.',               ec:{name:'Mark Brooks',  rel:'Spouse',  phone:'+61 400 333 444',email:'mark@email.com'},    notes:['Oct 23 — All clear, vitals excellent.']},
  'RES004':{name:'George Patel',   age:74,room:'202',status:'monitoring',admit:'Jun 20, 2023',carer:'David Thompson', color:'#d97706',ai:'Frequent pain reports; under review. Sleep patterns irregular. Family notified.',                 ec:{name:'Priya Patel',  rel:'Daughter',phone:'+61 400 444 555',email:'priya@email.com'},  notes:['Oct 23 — Pain medication reviewed.','Oct 22 — Difficulty sleeping.']},
  'RES005':{name:'Hannah Li',      age:72,room:'103',status:'monitoring',admit:'Nov 3, 2023', carer:'Linda Pham',     color:'#dc2626',ai:'Low mood noted; counselling set for tomorrow. Eating well, less social interaction.',             ec:{name:'David Li',     rel:'Son',     phone:'+61 400 555 666',email:'david.li@email.com'},notes:['Oct 23 — Low mood, counselling arranged.','Oct 20 — Good family visit.']},
  'RES007':{name:'Patrick Ellis',  age:85,room:'104',status:'monitoring',admit:'Apr 2, 2023', carer:'Michael Chen',  color:'#7c3aed',ai:'Raised voice during meal; calm now. Staff monitoring behaviour. No fall risk detected.',          ec:{name:'Carol Ellis',  rel:'Spouse',  phone:'+61 400 777 888',email:'carol@email.com'},   notes:['Oct 23 — Agitation during meal, resolved.']},
  'RES009':{name:'John Lee',       age:80,room:'108',status:'stable',    admit:'Sep 18, 2023',carer:'Sarah Johnson',  color:'#0369a1',ai:'Brief agitation resolved after family visit on Tuesday. Sleeping patterns have improved with medication adjustment. Participated well in group activities. Overall stable emotional state with positive social engagement.',ec:{name:'Mary Lee',rel:'Daughter',phone:'+61 400 999 000',email:'mary.lee@email.com'},notes:['Oct 23 — Medication refusal noted, resolved.','Oct 22 — Good family visit.']},
};

// ── resident color map (for API data) ──
const COLOR_MAP = {};
let colorIdx = 0;
function resColor(resId){
  if(!COLOR_MAP[resId]) COLOR_MAP[resId] = COLORS[colorIdx++ % COLORS.length];
  return COLOR_MAP[resId];
}

let allFlags = [];
let filteredFlags = [];

// ════════════════════════
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
    allFlags = data.length ? data.map(normaliseFlag) : [...DEMO_FLAGS];
    showApiStatus(true);
  } catch(e) {
    allFlags = [...DEMO_FLAGS];
    showApiStatus(false);
  }
  filteredFlags = [...allFlags];
  renderFlags();
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
// ══════════

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

// client-side filter (for instant search without extra API call) 
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

  // fallback to demo
  if(!r) r = DEMO_RESIDENTS[resId];

  // if still nothing, build minimal object from name
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

// ── MODAL HELPERS ─
function openModal(id){document.getElementById(id).classList.add('open');document.body.style.overflow='hidden';}
function closeModal(id){document.getElementById(id).classList.remove('open');document.body.style.overflow='';}
document.addEventListener('DOMContentLoaded', function() {
  document.querySelectorAll('.overlay').forEach(o=>o.addEventListener('click',e=>{if(e.target===o)closeModal(o.id);}));
  loadStats();
  loadFlags();
});

function showApiStatus(connected){
  let el=document.getElementById('api-status');
  if(!el){el=document.createElement('div');el.id='api-status';el.style.cssText='position:fixed;bottom:18px;right:18px;padding:8px 14px;border-radius:10px;font-size:12px;font-weight:700;z-index:999;transition:opacity 3s;';document.body.append(el);}
  el.textContent=connected?'✓ Connected to API':'⚠ Using demo data (API offline)';
  el.style.background=connected?'#dcfce7':'#fff7ed';
  el.style.color=connected?'#15803d':'#c2410c';
  el.style.opacity='1';
  setTimeout(()=>el.style.opacity='0',3000);
}