function authH(){
  const h={'Content-Type':'application/json'};
  const t=localStorage.getItem('access_token');
  if(t) h['Authorization']=`Bearer ${t}`;
  return h;
}

/*CLOCK  */
function updateClock(){
  const now=new Date();
  document.getElementById('tb-date').textContent=now.toLocaleDateString('en-AU',{month:'short',day:'numeric',year:'numeric'});
  document.getElementById('tb-time').textContent=now.toLocaleTimeString('en-AU',{hour:'2-digit',minute:'2-digit'});
}
updateClock();setInterval(updateClock,1000);

/*AUTH GUARD — admin only  */
let currentUser = null;

function initUser(){
  try{
    const u=JSON.parse(localStorage.getItem('user')||'{}');
    currentUser=u;
    // show admin name in top bar
    if(u.full_name){
      document.getElementById('admin-name').textContent=`Admin: ${u.full_name}`;
      document.getElementById('admin-role').textContent=u.role==='admin'?'Facility Manager':'Staff';
    }
    // role guard
    if(u.role!=='admin'){
      document.getElementById('admin-panel').style.display='none';
      document.getElementById('access-denied').style.display='flex';
      return false;
    }
    return true;
  }catch(e){
    document.getElementById('admin-panel').style.display='none';
    document.getElementById('access-denied').style.display='flex';
    return false;
  }
}

/*DEMO DATA */
const DEMO_STAFF=[
  {id:1,staff_id:'ST-4829',full_name:'Sarah Johnson',shift_time:'7:00 AM – 3:00 PM',hours:'8 hours',assigned_unit:'ICU Ward',   status:'active',  role:'Senior Carer'},
  {id:2,staff_id:'ST-3746',full_name:'Michael Chen',  shift_time:'3:00 PM – 11:00 PM',hours:'8 hours',assigned_unit:'Emergency',  status:'on_leave',role:'Nurse'},
  {id:3,staff_id:'ST-5920',full_name:'Emma Rodriguez',shift_time:'11:00 PM – 7:00 AM',hours:'8 hours',assigned_unit:'General Ward',status:'pending', role:'Carer'},
  {id:4,staff_id:'ST-1038',full_name:'David Kim',     shift_time:'7:00 AM – 3:00 PM',hours:'8 hours',assigned_unit:'Pediatrics', status:'active',  role:'Doctor'},
  {id:5,staff_id:'ST-2241',full_name:'Linda Pham',    shift_time:'7:00 AM – 3:00 PM',hours:'8 hours',assigned_unit:'Geriatrics', status:'active',  role:'Carer'},
  {id:6,staff_id:'ST-6610',full_name:'James Carter',  shift_time:'3:00 PM – 11:00 PM',hours:'8 hours',assigned_unit:'Neurology', status:'active',  role:'Nurse'},
];
const DEMO_ALERTS=[
  {level:'warning',title:'Staff Shortage Warning',message:'ICU Ward requires additional coverage for night shift'},
  {level:'critical',title:'Critical Task Overdue',message:'Equipment maintenance check pending for 2 days'},
  {level:'info',   title:'System Update',         message:'New staff scheduling features now available'},
];
const DEMO_TASKS=[
  {title:'Equipment Maintenance Check',status:'overdue',   desc:'ICU Ward ventilator maintenance overdue by 2 days.',    assignee:'Sarah Johnson',due:'Mar 12'},
  {title:'Medication Stock Audit',     status:'inprogress',desc:'Monthly medication inventory audit in progress.',        assignee:'Michael Chen',  due:'Mar 15'},
  {title:'Resident Care Plan Update',  status:'inprogress',desc:"Update Dorothy Williams' care plan with new medications.",assignee:'Emma Rodriguez', due:'Mar 14'},
  {title:'Staff Training Module',      status:'done',      desc:'All night-shift staff completed fire safety training.',  assignee:'All Staff',      due:'Mar 10'},
  {title:'CCTV System Calibration',    status:'overdue',   desc:'Monthly camera calibration for Floor 2.',                assignee:'David Kim',      due:'Mar 11'},
  {title:'Visitor Log Review',         status:'inprogress',desc:'Review visitor logs for this week.',                     assignee:'Linda Pham',     due:'Mar 16'},
];

let allStaff=[];
let editingId=null;
let editingStaffId=null;
let usingDemo=false;
let usingDemoStats=true;
let usingDemoAlerts=true;

/*LOAD STAFF */
async function loadStaff(){
  try{
    const r=await fetch(`${API_BASE}/staff/`,{headers:authH()});
    if(!r.ok)throw new Error();
    const d=await r.json();
    if(d.length){allStaff=d;usingDemo=false;}
    else throw new Error('empty');
  }catch(e){allStaff=DEMO_STAFF.map(s=>({...s}));usingDemo=true;}

  // load stats from API
  try{
    const rs=await fetch(`${API_BASE}/staff/stats/summary`,{headers:authH()});
    if(rs.ok){
      const stats=await rs.json();
      document.getElementById('stat-active').textContent=stats.active_staff??'–';
      document.getElementById('stat-tasks').textContent=stats.pending_tasks??'–';
      document.getElementById('stat-shifts').textContent=stats.shifts_today??'–';
      usingDemoStats=false;
    } else throw new Error();
  }catch(e){usingDemoStats=true;}

  // load alerts from API
  try{
    const ra=await fetch(`${API_BASE}/alerts/?limit=5&is_read=false`,{headers:authH()});
    if(ra.ok){
      const alerts=await ra.json();
      if(alerts.length){renderAlertsFromAPI(alerts);usingDemoAlerts=false;}
      else throw new Error('empty');
    } else throw new Error();
  }catch(e){usingDemoAlerts=true;}

  renderStaff();
  if(usingDemoStats)renderStats();
  if(usingDemoAlerts)renderAlerts();
  renderTasks();
}

/*RENDER STAFF TABLE*/
function statusBadge(s){
  if(s==='active'||s==='Active')   return`<span class="status-badge status-active">● Active</span>`;
  if(s==='on_leave'||s==='On Leave')return`<span class="status-badge status-leave">● On Leave</span>`;
  return`<span class="status-badge status-pending">Pending</span>`;
}

function renderStaff(){
  const tbody=document.getElementById('staff-tbody');
  tbody.innerHTML=allStaff.map(s=>`
    <tr>
      <td><div class="staff-name">${esc(s.full_name)}</div><div class="staff-id">ID: ${esc(s.staff_id)}</div></td>
      <td><div class="shift-main">${esc(s.shift_time||'')}</div><div class="shift-hours">${esc(s.hours||'8 hours')}</div></td>
      <td>${esc(s.assigned_unit||'')}</td>
      <td>${statusBadge(s.status)}</td>
      <td>
        <button class="action-btn" title="View" onclick="viewStaff(${s.id})"><svg viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></button>
        <button class="action-btn" title="Edit" onclick="openEdit(${s.id})"><svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
      </td>
    </tr>`).join('');
  const total=allStaff.length;
  document.getElementById('staff-count').textContent=`Showing ${total} of ${total} staff members`;
}

/*STATS*/
function renderStats(){
  const active=allStaff.filter(s=>s.status==='active'||s.status==='Active').length;
  document.getElementById('stat-active').textContent=active;
  document.getElementById('stat-tasks').textContent=DEMO_TASKS.filter(t=>t.status!=='done').length;
  document.getElementById('stat-shifts').textContent=allStaff.length;
}

/*ALERTS*/
function renderAlerts(){
  const iconMap={
    warning:`<svg viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
    critical:`<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
    info:`<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`,
  };
  const cls={warning:'ai-amber',critical:'ai-red',info:'ai-blue'};
  document.getElementById('alerts-list').innerHTML=DEMO_ALERTS.map(a=>`
    <div class="alert-item">
      <div class="alert-icon ${cls[a.level]||'ai-blue'}">${iconMap[a.level]||iconMap.info}</div>
      <div class="alert-body">
        <div class="alert-ttl">${esc(a.title)}</div>
        <div class="alert-msg">${esc(a.message)}</div>
      </div>
    </div>`).join('');
}

/*ALERTS FROM API*/
function renderAlertsFromAPI(alerts){
  const iconMap={
    warning:`<svg viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
    critical:`<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
    info:`<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`,
  };
  const cls={warning:'ai-amber',critical:'ai-red',info:'ai-blue'};
  document.getElementById('alerts-list').innerHTML=alerts.map(a=>`
    <div class="alert-item">
      <div class="alert-icon ${cls[a.level]||'ai-blue'}">${iconMap[a.level]||iconMap.info}</div>
      <div class="alert-body">
        <div class="alert-ttl">${esc(a.title)}</div>
        <div class="alert-msg">${esc(a.message)}</div>
      </div>
    </div>`).join('');
}

/*TASKS */
function renderTasks(){
  const badgeMap={overdue:'tb-overdue',inprogress:'tb-inprogress',done:'tb-done'};
  const labelMap={overdue:'Overdue',inprogress:'In Progress',done:'Done'};
  document.getElementById('task-grid').innerHTML=DEMO_TASKS.map(t=>`
    <div class="task-card">
      <div class="task-hdr">
        <div class="task-title">${esc(t.title)}</div>
        <div class="task-badge ${badgeMap[t.status]||'tb-inprogress'}">${labelMap[t.status]||t.status}</div>
      </div>
      <div class="task-desc">${esc(t.desc)}</div>
      <div class="task-meta">
        <span>👤 ${esc(t.assignee)}</span>
        <span>📅 Due: ${esc(t.due)}</span>
      </div>
    </div>`).join('');
}

/*TABS*/
function switchTab(name,btn){
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(p=>p.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('tab-'+name).classList.add('active');
}

/*EDIT MODAL*/
function openEdit(id){
  const s=allStaff.find(x=>x.id===id);if(!s)return;
  editingId=id;
  editingStaffId=s.staff_id||'';
  document.getElementById('edit-name').value=s.full_name||'';
  document.getElementById('edit-id').value=s.staff_id||'';
  document.getElementById('edit-shift').value=s.shift_time||'';
  document.getElementById('edit-unit').value=s.assigned_unit||'ICU Ward';
  document.getElementById('edit-status').value=s.status==='on_leave'?'on_leave':s.status==='pending'?'pending':'active';
  document.getElementById('edit-role').value=s.role||'Carer';
  document.getElementById('modal-edit').classList.add('open');
}
function closeModal(){document.getElementById('modal-edit').classList.remove('open');}

async function saveStaff(){
  const s=allStaff.find(x=>x.id===editingId);if(!s)return;
  s.full_name   =document.getElementById('edit-name').value.trim();
  s.shift_time  =document.getElementById('edit-shift').value.trim();
  s.assigned_unit=document.getElementById('edit-unit').value;
  s.status      =document.getElementById('edit-status').value;
  s.role        =document.getElementById('edit-role').value;
  // API PATCH
  try{
    if(!usingDemo)await fetch(`${API_BASE}/staff/${editingStaffId}`,{
      method:'PATCH',headers:authH(),body:JSON.stringify({
        full_name:s.full_name,shift_time:s.shift_time,
        assigned_unit:s.assigned_unit,status:s.status,role:s.role}),
    });
  }catch(e){}
  renderStaff();renderStats();closeModal();
}

async function deleteStaff(){
  if(!confirm('Delete this staff member?'))return;
  try{
    if(!usingDemo)await fetch(`${API_BASE}/staff/${editingStaffId}`,{method:'DELETE',headers:authH()});
  }catch(e){}
  allStaff=allStaff.filter(x=>x.id!==editingId);
  renderStaff();renderStats();closeModal();
}

function viewStaff(id){
  const s=allStaff.find(x=>x.id===id);if(!s)return;
  alert(`${s.full_name} (${s.staff_id})\nUnit: ${s.assigned_unit}\nShift: ${s.shift_time}\nRole: ${s.role}\nStatus: ${s.status}`);
}

/*EXPORT PDF */
function exportPDF(){
  const {jsPDF}=window.jspdf;
  const doc=new jsPDF({orientation:'landscape',unit:'mm',format:'a4'});
  const now=new Date();
  const dateStr=now.toLocaleDateString('en-AU',{day:'numeric',month:'long',year:'numeric'});
  const timeStr=now.toLocaleTimeString('en-AU',{hour:'2-digit',minute:'2-digit'});
  const adminName=(currentUser&&currentUser.full_name)||'Admin';

  // Header
  doc.setFillColor(15,27,45);
  doc.rect(0,0,297,22,'F');
  doc.setTextColor(255,255,255);
  doc.setFontSize(14);doc.setFont('helvetica','bold');
  doc.text('Sphere Care — Staff Activity Report',14,14);
  doc.setFontSize(9);doc.setFont('helvetica','normal');
  doc.text(`Generated: ${dateStr} ${timeStr}   |   By: ${adminName}`,14,20);
  doc.text('CONFIDENTIAL',297-14,14,{align:'right'});

  // Summary row
  const active=allStaff.filter(s=>s.status==='active'||s.status==='Active').length;
  doc.setTextColor(30,40,60);
  doc.setFontSize(9);doc.setFont('helvetica','bold');
  doc.text(`Total Staff: ${allStaff.length}   |   Active: ${active}   |   On Leave: ${allStaff.filter(s=>s.status==='on_leave'||s.status==='On Leave').length}   |   Pending: ${allStaff.filter(s=>s.status==='pending'||s.status==='Pending').length}`,14,30);

  // Table
  doc.autoTable({
    startY:34,
    head:[['Staff Name','Staff ID','Shift Time','Assigned Unit','Role','Status']],
    body:allStaff.map(s=>[
      s.full_name||'',
      s.staff_id||'',
      s.shift_time||'',
      s.assigned_unit||'',
      s.role||'',
      s.status==='on_leave'?'On Leave':s.status==='active'?'Active':s.status==='pending'?'Pending':s.status||'',
    ]),
    headStyles:{fillColor:[46,196,182],textColor:255,fontStyle:'bold',fontSize:10},
    bodyStyles:{fontSize:9,textColor:[30,40,60]},
    alternateRowStyles:{fillColor:[240,244,248]},
    columnStyles:{0:{fontStyle:'bold'},5:{halign:'center'}},
    didDrawCell:(data)=>{
      if(data.section==='body'&&data.column.index===5){
        const val=data.cell.raw;
        let clr=null;
        if(val==='Active')    clr=[34,197,94];
        else if(val==='On Leave') clr=[245,158,11];
        else if(val==='Pending')  clr=[148,163,184];
        if(clr){
          doc.setFillColor(...clr);
          const {x,y,width,height}=data.cell;
          doc.roundedRect(x+2,y+2,width-4,height-4,2,2,'F');
          doc.setTextColor(255,255,255);
          doc.setFontSize(8);doc.setFont('helvetica','bold');
          doc.text(val,x+width/2,y+height/2+1,{align:'center'});
        }
      }
    },
    margin:{left:14,right:14},
  });

  // Footer
  const pageCount=doc.internal.getNumberOfPages();
  for(let i=1;i<=pageCount;i++){
    doc.setPage(i);
    doc.setFontSize(8);doc.setFont('helvetica','normal');
    doc.setTextColor(150,160,175);
    doc.text(`Page ${i} of ${pageCount}  |  Sphere Care — AI-Powered Aged Care Platform  |  CONFIDENTIAL`,14,doc.internal.pageSize.height-8);
  }

  doc.save(`SphereCarw_Staff_Report_${now.toISOString().slice(0,10)}.pdf`);
}

/*HELPERS */
function esc(s){return(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}

/*INIT  */
const isAdmin=initUser();
if(isAdmin)loadStaff();
