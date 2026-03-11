let records = [];
let currentView = 'grid';
let searchTimeout = null;
let _tsTimers = [];

// CLOCK
function tick(){
  const d = new Date();
  document.getElementById('tb-date').textContent = d.toLocaleDateString('en-AU',{day:'numeric',month:'long',year:'numeric'});
  document.getElementById('tb-time').textContent = d.toLocaleTimeString('en-AU',{hour:'2-digit',minute:'2-digit'});
}
tick(); setInterval(tick,1000);

function authHeaders(){
  const h={'Content-Type':'application/json'};
  const t=localStorage.getItem('access_token');
  if(t) h['Authorization']=`Bearer ${t}`;
  return h;
}

// LOAD RECORDS
async function loadRecords(){
  const search=document.getElementById('rec-search').value.trim();
  const cat=document.getElementById('f-category').value;
  const type=document.getElementById('f-type').value;
  const p=new URLSearchParams();
  if(search) p.set('search',search);
  if(cat)    p.set('category',cat);
  if(type)   p.set('record_type',type);
  try{
    const res=await fetch(`${API_BASE}/records/?${p}`,{headers:authHeaders()});
    if(!res.ok) throw new Error();
    const data=await res.json();
    records=data.length?data:DEMO_RECORDS;
    showApiStatus(true);
  }catch(e){
    records=DEMO_RECORDS;
    showApiStatus(false);
  }
  renderAll();
}

async function loadCategories(){
  try{
    const res=await fetch(`${API_BASE}/records/categories`,{headers:authHeaders()});
    if(!res.ok) throw new Error();
    const cats=await res.json();
    const sel=document.getElementById('f-category');
    cats.forEach(c=>{const o=document.createElement('option');o.value=c;o.textContent=c;sel.appendChild(o);});
  }catch(e){
    ['Medication Administration','Physiotherapy','Family Meeting','Care Assessment','Wellness Check','Physical Therapy','Cognitive Therapy','Nutrition Review']
      .forEach(c=>{const o=document.createElement('option');o.value=c;o.textContent=c;document.getElementById('f-category').appendChild(o);});
  }
}

function debounceSearch(){clearTimeout(searchTimeout);searchTimeout=setTimeout(loadRecords,450);}

// VIEW / DOWNLOAD
function viewRecord(id){
  const r=records.find(x=>x.id===id);
  if(r?.file_url&&r.file_url!=='#') window.open(r.file_url,'_blank');
  else alert('No file URL available for this record.');
}
function downloadRecord(id){
  const r=records.find(x=>x.id===id);
  if(r?.file_url&&r.file_url!=='#'){
    const a=document.createElement('a');
    a.href=r.file_url;
    a.download=`${r.category||'record'}_${r.resident_name||'resident'}`;
    a.click();
  } else alert('No file available to download.');
}

// RENDER
function renderAll(){
  renderGrid(); renderList();
  const empty=records.length===0;
  document.getElementById('empty-state').style.display=empty?'block':'none';
  document.getElementById('view-grid').style.display=(!empty&&currentView!=='list')?'grid':'none';
  document.getElementById('view-list').style.display=(!empty&&currentView==='list')?'block':'none';
}

function setView(v){
  currentView=v;
  ['grid','list','single'].forEach(n=>document.getElementById('vbtn-'+n)?.classList.toggle('active',n===v));
  if(v==='single') document.getElementById('view-grid').style.gridTemplateColumns='1fr';
  else document.getElementById('view-grid').style.gridTemplateColumns='';
  renderAll();
}

function startTsTimers(){
  _tsTimers.forEach(t=>clearInterval(t));_tsTimers=[];
  document.querySelectorAll('.cctv-ts').forEach(el=>{
    function updateTs(){
      const d=new Date();
      el.textContent=d.toLocaleDateString('en-AU',{day:'2-digit',month:'2-digit',year:'numeric'}).replace(/\//g,'/')+' '+
                     d.toLocaleTimeString('en-AU',{hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});
    }
    updateTs();
    _tsTimers.push(setInterval(updateTs,1000));
  });
}

function thumbHTML(r,i){
  const figs=['🚶','🧑','👴','👵','🧓','🧑‍🦯'];
  const f1=figs[i%figs.length], f2=figs[(i+3)%figs.length];
  const s1=7+i*1.5, s2=11+i*1.2;
  if(r.record_type==='document') return `
    <div class="rec-thumb-doc" onclick="viewRecord(${r.id})">
      <svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
      <div class="type-badge-abs rtb-document">document</div>
    </div>`;
  if(r.record_type==='audio') return `
    <div class="rec-thumb-audio" onclick="viewRecord(${r.id})">
      <svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>
      <div class="type-badge-abs rtb-audio">audio</div>
    </div>`;
  return `
    <div class="rec-thumb" onclick="viewRecord(${r.id})">
      <div class="cctv-bg"></div>
      <div class="cctv-grid-lines"></div>
      <div class="cctv-fig" style="animation-duration:${s1}s">${f1}</div>
      <div class="cctv-fig2" style="animation-duration:${s2}s">${f2}</div>
      <div class="cctv-scan"></div>
      <span class="cctv-ts"></span>
      <div class="cctv-rec-badge"><div class="rec-dot"></div>REC</div>
      <div class="type-badge-abs rtb-video">video</div>
    </div>`;
}

function renderGrid(){
  document.getElementById('view-grid').innerHTML=records.map((r,i)=>`
    <div class="rec-card">
      ${thumbHTML(r,i)}
      <div class="rec-info">
        <div class="rec-name">${r.resident_name||'—'}</div>
        <div class="rec-category">${r.category||'—'}</div>
        <div class="rec-datetime">${r.recorded_at||r.created_at?.slice(0,10)||'—'}&nbsp;&nbsp;${r.recorded_time||r.created_at?.slice(11,16)||''}</div>
        <div class="rec-notes">${r.notes||'—'}</div>
        <div class="rec-actions-row">
          <button class="ra-btn view" onclick="viewRecord(${r.id})">
            <svg viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>View
          </button>
          <button class="ra-btn dl" onclick="downloadRecord(${r.id})">
            <svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>Download
          </button>
        </div>
      </div>
    </div>`).join('');
  startTsTimers();
}

function renderList(){
  document.getElementById('rec-tbody').innerHTML=records.map(r=>`
    <tr>
      <td style="font-weight:700">${r.resident_name||'—'}</td>
      <td>${r.category||'—'}</td>
      <td><span class="type-pill tp-${r.record_type||'document'}">${r.record_type||'—'}</span></td>
      <td>${r.duration||'—'}</td>
      <td><div style="font-size:12.5px">${r.recorded_at||'—'}</div><div style="font-size:11px;color:var(--text3)">${r.recorded_time||''}</div></td>
      <td style="max-width:170px;font-size:12.5px;color:var(--text2)">${r.notes||'—'}</td>
      <td><div style="display:flex;gap:5px">
        <button class="tbl-btn" title="View" onclick="viewRecord(${r.id})"><svg viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></button>
        <button class="tbl-btn dl" title="Download" onclick="downloadRecord(${r.id})"><svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg></button>
      </div></td>
    </tr>`).join('');
}

// AI INSIGHTS
async function loadInsights(){
  try{
    const res=await fetch(`${API_BASE}/records/ai-insights`,{headers:authHeaders()});
    if(!res.ok) throw new Error();
    const data=await res.json();
    document.getElementById('ic-high').textContent=data.high??0;
    document.getElementById('ic-mid').textContent=data.mid??0;
    document.getElementById('ic-low').textContent=data.low??0;
    renderInsights(data.insights?.length?data.insights:DEMO_INSIGHTS);
  }catch(e){ renderInsights(DEMO_INSIGHTS); }
}
async function markInsightSeen(id){
  try{await fetch(`${API_BASE}/records/ai-insights/${id}/seen`,{method:'PATCH',headers:authHeaders()});}catch(e){}
}
function renderInsights(list){
  const icons={high:'⚠️',mid:'💊',low:'ℹ️'};
  document.getElementById('insights-list').innerHTML=list.map(i=>`
    <div class="insight-item" onclick="markInsightSeen(${i.id});this.style.opacity='.55'">
      <div class="ins-dot ins-${i.priority}">${icons[i.priority]||'💡'}</div>
      <div style="flex:1;min-width:0">
        <div class="ins-title">${i.title}</div>
        <div class="ins-resident">${i.resident_name||''}</div>
        <div class="ins-body">${i.body}</div>
        <div class="ins-meta">
          <span class="ins-priority-pill ip-${i.priority}">${(i.priority||'').toUpperCase()}</span>
          <span class="ins-time">${(i.created_at||'').slice(0,16)}</span>
        </div>
      </div>
    </div>`).join('');
}

// UPLOAD
async function submitUpload(){
  const resident=document.getElementById('up-resident').value.trim();
  const category=document.getElementById('up-category').value.trim();
  const type=document.getElementById('up-type').value;
  const url=document.getElementById('up-url').value.trim();
  const errEl=document.getElementById('up-err');
  const btn=document.getElementById('up-submit');
  if(!resident||!category||!type||!url){errEl.textContent='Please fill in all required fields.';errEl.style.display='block';return;}
  errEl.style.display='none';btn.textContent='Uploading...';btn.disabled=true;
  const payload={resident_name:resident,category,record_type:type,file_url:url,
    duration:document.getElementById('up-duration').value||null,
    recorded_at:document.getElementById('up-date').value||null,
    recorded_time:document.getElementById('up-time').value||null,
    notes:document.getElementById('up-notes').value.trim()||null,thumbnail_url:null};
  try{
    const res=await fetch(`${API_BASE}/records/`,{method:'POST',headers:authHeaders(),body:JSON.stringify(payload)});
    if(!res.ok) throw new Error();
    await loadRecords();
  }catch(e){
    records.unshift({...payload,id:Date.now(),created_at:new Date().toISOString().slice(0,16)});
    renderAll();
  }finally{btn.textContent='Upload Record';btn.disabled=false;}
  closeModal('modal-upload');
}

function openUploadModal(){
  ['up-resident','up-category','up-url','up-duration','up-date','up-time','up-notes'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('up-type').value='';
  document.getElementById('up-err').style.display='none';
  openModal('modal-upload');
}
function openModal(id){document.getElementById(id).classList.add('open');document.body.style.overflow='hidden';}
function closeModal(id){document.getElementById(id).classList.remove('open');document.body.style.overflow='';}
document.querySelectorAll('.overlay').forEach(o=>o.addEventListener('click',e=>{if(e.target===o)closeModal(o.id);}));

function showApiStatus(connected){
  let el=document.getElementById('api-status');
  if(!el){el=document.createElement('div');el.id='api-status';el.style.cssText='position:fixed;bottom:18px;right:18px;padding:8px 14px;border-radius:10px;font-size:12px;font-weight:700;z-index:999;transition:opacity 3s;';document.body.append(el);}
  el.textContent=connected?'✓ Connected to API':'⚠ Using demo data (API offline)';
  el.style.background=connected?'#dcfce7':'#fff7ed';
  el.style.color=connected?'#15803d':'#c2410c';
  el.style.opacity='1';setTimeout(()=>el.style.opacity='0',3000);
}

// DEMO DATA
const DEMO_RECORDS=[
  {id:1,resident_name:'Margaret Chen',  category:'Medication Administration',record_type:'video',   file_url:'#',duration:'09:15',notes:'Medication review and blood pressure recorded successfully.',        recorded_at:'10/22/2025',recorded_time:'09:15',created_at:'2025-10-22 09:15'},
  {id:2,resident_name:'Alice Tan',      category:'Family Video Call',        record_type:'video',   file_url:'#',duration:'14:00',notes:'Positive interaction recorded. No distress or agitation.',           recorded_at:'10/22/2025',recorded_time:'14:00',created_at:'2025-10-22 14:00'},
  {id:3,resident_name:'Sharon Lim',     category:'Vital Check',              record_type:'video',   file_url:'#',duration:'09:45',notes:'BP slightly elevated. Nurse notified for observation.',              recorded_at:'10/22/2025',recorded_time:'09:45',created_at:'2025-10-22 09:45'},
  {id:4,resident_name:'Jason Ong',      category:'Physical Therapy',         record_type:'video',   file_url:'#',duration:'11:10',notes:'Complete stretching exercises with assistance.',                     recorded_at:'10/20/2025',recorded_time:'11:10',created_at:'2025-10-20 11:10'},
  {id:5,resident_name:'Robert Thompson',category:'Mobility Exercise',        record_type:'video',   file_url:'#',duration:'10:30',notes:'Resident completed hallway walking routine. Detected mild fatigue.', recorded_at:'10/20/2025',recorded_time:'10:30',created_at:'2025-10-20 10:30'},
  {id:6,resident_name:'Mrs Lee',        category:'Cognitive Therapy Session',record_type:'video',   file_url:'#',duration:'08:50',notes:'Engaged in word association task. Mild memory hesitation noted.',    recorded_at:'10/20/2025',recorded_time:'08:50',created_at:'2025-10-20 08:50'},
  {id:7,resident_name:'George Patel',   category:'Care Assessment',          record_type:'document',file_url:'#',duration:null,  notes:'Quarterly assessment. Pain medication reviewed.',                   recorded_at:'10/19/2025',recorded_time:'09:30',created_at:'2025-10-19 09:30'},
  {id:8,resident_name:'Hannah Li',      category:'Wellness Check',           record_type:'audio',   file_url:'#',duration:'05:20',notes:'Low mood noted. Counselling arranged for tomorrow.',                recorded_at:'10/19/2025',recorded_time:'13:00',created_at:'2025-10-19 13:00'},
];
const DEMO_INSIGHTS=[
  {id:1,resident_name:'Robert Thompson',title:'Agitation Pattern Detected',  body:'Robert Thompson has shown increased agitation during morning routines for 3 consecutive days. Consider adjusting care approach or timing.',priority:'high',created_at:'2025-10-22 09:00'},
  {id:2,resident_name:'',              title:'Medication Reminder Missed',   body:'Routine medication was not marked as completed by 09:00 AM. Notify assigned nurse.',                                                     priority:'high',created_at:'2025-10-22 09:00'},
  {id:3,resident_name:'Margaret Chen', title:'Heart Rate Spike',             body:'Heart rate reached 108 BPM during morning exercise. Monitor if persistent.',                                                             priority:'mid', created_at:'2025-10-22 08:30'},
  {id:4,resident_name:'Mrs Lee',       title:'Sleep Disturbance Noted',      body:'Frequent movements detected between 2:00 AM and 4:00 AM. Possible discomfort or pain.',                                                 priority:'mid', created_at:'2025-10-22 02:45'},
  {id:5,resident_name:'Robert Thompson',title:'Cognitive Pause Observed',    body:'12-second pause in word recall task. May need follow-up cognitive test.',                                                                priority:'mid', created_at:'2025-10-21 10:15'},
  {id:6,resident_name:'Jason Ong',     title:'Positive Social Interaction',  body:'Resident engaged positively in group activity session. No agitation detected.',                                                         priority:'low', created_at:'2025-10-21 15:00'},
  {id:7,resident_name:'Alice Tan',     title:'Appetite Improvement',         body:'Finished full meal for 3 consecutive days. Current nutrition plan appears effective.',                                                   priority:'low', created_at:'2025-10-20 12:30'},
  {id:8,resident_name:'Sharon Lim',    title:'BP Stabilising',               body:'Blood pressure readings trending back to normal range after medication adjustment.',                                                    priority:'low', created_at:'2025-10-20 10:00'},
];

// INIT
loadCategories();
loadRecords();
loadInsights();