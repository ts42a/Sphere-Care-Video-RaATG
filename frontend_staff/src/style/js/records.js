let records = [];
let currentView = 'grid';
let searchTimeout = null;
let _tsTimers = [];
const LOCAL_RECORDING_INDEX_KEY = "spherecare_local_recordings_index_v1";

function normalizeRecordDateTime(rec){
  const raw = rec?.recorded_at || rec?.created_at || null;
  if (!raw) return { dateText: '—', timeText: '' };
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) {
    const s = String(raw);
    return {
      dateText: s.slice(0, 10) || '—',
      timeText: s.slice(11, 16) || ''
    };
  }
  return {
    dateText: d.toLocaleDateString('en-AU', { day: '2-digit', month: '2-digit', year: 'numeric' }),
    timeText: d.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hour12: false })
  };
}

function recordMatchesFilters(rec, search, cat, type){
  const text = [
    rec?.resident_name,
    rec?.category,
    rec?.record_type,
    rec?.notes,
  ].join(' ').toLowerCase();

  const matchesSearch = !search || text.includes(search.toLowerCase());
  const matchesCategory = !cat || String(rec?.category || '').toLowerCase() === String(cat).toLowerCase();
  const matchesType = !type || String(rec?.record_type || '').toLowerCase() === String(type).toLowerCase();
  return matchesSearch && matchesCategory && matchesType;
}

// CLOCK
function tick(){
  const d = new Date();
  document.getElementById('tb-date').textContent = d.toLocaleDateString('en-AU',{day:'numeric',month:'long',year:'numeric'});
  document.getElementById('tb-time').textContent = d.toLocaleTimeString('en-AU',{hour:'2-digit',minute:'2-digit'});
}
document.addEventListener('DOMContentLoaded', function() {
  tick(); setInterval(tick, 1000);
});

function authHeaders(){
  const h={'Content-Type':'application/json'};
  const t=sessionStorage.getItem('access_token')||sessionStorage.getItem('spherecare_token');
  if(t) h['Authorization']=`Bearer ${t}`;
  return h;
}

const DELETE_CONFIRM_WORD = 'Confirm';
let _deleteConfirmAction = null;

function localVaultIdFromRec(rec){
  const url = String(rec?.file_url || '');
  if (url.startsWith('localvault://')) return url.slice('localvault://'.length);
  if (String(rec?.id || '').startsWith('rec_')) return String(rec.id);
  return null;
}

function openDeleteConfirmModal({ title, message, onConfirm }) {
  _deleteConfirmAction = onConfirm;
  const titleEl = document.getElementById('delete-confirm-title');
  const msgEl = document.getElementById('delete-confirm-message');
  const input = document.getElementById('delete-confirm-input');
  const err = document.getElementById('delete-confirm-err');
  if (titleEl) titleEl.textContent = title || 'Delete recording';
  if (msgEl) msgEl.textContent = message || 'This cannot be undone.';
  if (input) input.value = '';
  if (err) { err.style.display = 'none'; err.textContent = ''; }
  const el = document.getElementById('modal-delete-confirm');
  if (!el) {
    console.error('Delete confirm modal missing from page');
    return;
  }
  openModal('modal-delete-confirm');
  setTimeout(() => input?.focus(), 100);
}

function closeDeleteConfirmModal() {
  _deleteConfirmAction = null;
  closeModal('modal-delete-confirm');
}

async function submitDeleteConfirmModal() {
  const input = document.getElementById('delete-confirm-input');
  const err = document.getElementById('delete-confirm-err');
  const btn = document.getElementById('delete-confirm-submit');
  const typed = (input?.value || '').trim();
  if (typed !== DELETE_CONFIRM_WORD) {
    if (err) {
      err.textContent = `Type ${DELETE_CONFIRM_WORD} to confirm this action.`;
      err.style.display = 'block';
    }
    return;
  }
  if (!_deleteConfirmAction) return;
  if (btn) { btn.disabled = true; btn.textContent = 'Deleting…'; }
  try {
    await _deleteConfirmAction();
    closeDeleteConfirmModal();
  } catch (e) {
    if (err) {
      err.textContent = e?.message || String(e);
      err.style.display = 'block';
    }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Delete'; }
  }
}

async function removeLocalVaultById(localId) {
  if (!localId) return;
  if (window.recordingVault?.vaultDeleteRecording) {
    try {
      await window.recordingVault.vaultDeleteRecording(String(localId));
    } catch (_) {}
  }
  try {
    const raw = localStorage.getItem(LOCAL_RECORDING_INDEX_KEY);
    const index = raw ? JSON.parse(raw) : [];
    if (Array.isArray(index)) {
      const filtered = index.filter((row) => String(row?.id) !== String(localId));
      localStorage.setItem(LOCAL_RECORDING_INDEX_KEY, JSON.stringify(filtered));
    }
  } catch (_) {}
}

async function deleteServerRecordById(serverId) {
  const res = await fetch(`${API_BASE}/records/${encodeURIComponent(serverId)}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  if (res.status === 401) throw new Error('Not signed in. Log in and try again.');
  if (!res.ok && res.status !== 204) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `Delete failed (HTTP ${res.status})`);
  }
}

function dropRecordsFromState({ localId, serverId, primaryId }) {
  records = records.filter((x) => {
    const xLocal = localVaultIdFromRec(x);
    if (localId && xLocal === localId) return false;
    if (serverId && String(x.id) === String(serverId)) return false;
    if (primaryId && String(x.id) === String(primaryId)) return false;
    return true;
  });
  renderAll();
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
  const merged = [];
  const seenIds = new Set();
  let apiConnected = true;

  try{

    if (window.recordingVault?.vaultListRecordings) {
      try {
        const vaultRows = await window.recordingVault.vaultListRecordings();
        vaultRows.forEach((row) => {
          const id = String(row.id || "");
          if (!id || seenIds.has(id)) return;
          seenIds.add(id);
          merged.push({
            id,
            resident_name: "This device",
            category: row.cameraLabel || "Local camera recording",
            record_type: "video",
            duration: row.durationMs ? `${Math.max(1, Math.round(Number(row.durationMs) / 1000))}s` : "—",
            notes: row.notes || "Encrypted local vault recording",
            recorded_at: row.startedAt || row.createdAt || null,
            created_at: row.createdAt || row.startedAt || null,
            file_url: `localvault://${id}`,
            is_local_vault: true,
            vaultMeta: row,
          });
        });
      } catch (_) {}
    }

    try {
      const localIndexRaw = localStorage.getItem(LOCAL_RECORDING_INDEX_KEY);
      const localIndex = localIndexRaw ? JSON.parse(localIndexRaw) : [];
      if (Array.isArray(localIndex)) {
        localIndex.forEach((row) => {
          const id = String(row.id || "");
          if (!id || seenIds.has(id)) return;
          seenIds.add(id);
          merged.push({
            id,
            resident_name: "This device",
            category: row.cameraLabel || "Local camera recording",
            record_type: "video",
            duration: row.durationMs ? `${Math.max(1, Math.round(Number(row.durationMs) / 1000))}s` : "—",
            notes: row.notes || "Encrypted local vault recording",
            recorded_at: row.startedAt || row.createdAt || null,
            created_at: row.createdAt || row.startedAt || null,
            file_url: `localvault://${id}`,
            is_local_vault: true,
            vaultMeta: null,
          });
        });
      }
    } catch (_) {}

    const serverByVaultId = new Map();
    try {
      const res=await fetch(`${API_BASE}/records/?${p}`,{headers:authHeaders()});
      if(!res.ok) throw new Error();
      const data=await res.json();
      data.forEach((row) => {
        const id = String(row.id);
        const vaultLocalId = localVaultIdFromRec(row);
        if (vaultLocalId) serverByVaultId.set(vaultLocalId, row);
        if (seenIds.has(id)) return;
        seenIds.add(id);
        if (vaultLocalId) seenIds.add(vaultLocalId);
        merged.push({ ...row, vaultLocalId });
      });
    } catch (e) {
      apiConnected = false;
    }

    // Drop local duplicates when server already has the same vault id
    for (let i = merged.length - 1; i >= 0; i--) {
      const row = merged[i];
      if (!row.is_local_vault && !String(row.id).startsWith('rec_')) continue;
      const lid = localVaultIdFromRec(row);
      if (lid && serverByVaultId.has(lid)) merged.splice(i, 1);
    }

    merged.sort((a, b) => {
      const aTs = Date.parse(a.created_at || a.recorded_at || 0) || 0;
      const bTs = Date.parse(b.created_at || b.recorded_at || 0) || 0;
      return bTs - aTs;
    });
    records = merged.filter((r) => recordMatchesFilters(r, search, cat, type));
    showApiStatus(apiConnected);
  }catch(e){
    records = merged.filter((r) => recordMatchesFilters(r, search, cat, type));
    showApiStatus(false);
  }
  if (typeof window.hideSkeleton === 'function') window.hideSkeleton();
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

function isLocalVaultRecord(rec){
  const fileUrl = String(rec?.file_url || '');
  if (fileUrl.startsWith('localvault://')) return true;
  // Be strict: avoid treating string values like "false" as truthy.
  return rec?.is_local_vault === true || rec?.source === 'local_vault';
}

function recordNeedsVaultAccess(rec) {
  if (!rec) return false;
  if (isLocalVaultRecord(rec)) return true;
  return !!localVaultIdFromRec(rec);
}

async function ensureVaultUnlockedForDelete() {
  if (window.recordingVault?.vaultIsUnlocked?.()) {
    refreshVaultStatusPill();
    return true;
  }
  const ok = await ensureVaultUnlockedFromRecords();
  refreshVaultStatusPill();
  if (!ok) {
    alert('Unlock the vault first using the "Vault Unlock" button in the header, then try again.');
  }
  return ok;
}

// VIEW / DOWNLOAD
async function resolveVaultRowById(localId){
  if (!window.recordingVault?.vaultListRecordings) return null;
  const rows = await window.recordingVault.vaultListRecordings();
  return rows.find((x) => String(x.id) === String(localId)) || null;
}

function refreshVaultStatusPill(){
  const pill = document.getElementById('vault-status-pill');
  if (!pill) return;
  const unlocked = !!window.recordingVault?.vaultIsUnlocked?.();
  pill.classList.remove('locked', 'unlocked');
  pill.classList.add(unlocked ? 'unlocked' : 'locked');
  pill.textContent = unlocked ? 'Vault: Unlocked' : 'Vault: Locked';
}

async function ensureVaultUnlockedFromRecords(){
  if (
    !window.recordingVault?.vaultHasPassword ||
    !window.recordingVault?.vaultUnlock ||
    !window.recordingVault?.vaultSetPassword ||
    !window.recordingVault?.vaultIsUnlocked
  ) {
    alert('Vault module is not loaded.');
    return false;
  }

  if (window.recordingVault.vaultIsUnlocked()) {
    refreshVaultStatusPill();
    return true;
  }

  const hasPassword = await window.recordingVault.vaultHasPassword();
  if (!hasPassword) {
    const newPass = prompt('Set a new vault password (minimum 8 characters):');
    if (!newPass) return false;
    if (String(newPass).length < 8) {
      alert('Password must be at least 8 characters.');
      return false;
    }
    await window.recordingVault.vaultSetPassword(newPass);
    refreshVaultStatusPill();
    return true;
  }

  const pass = prompt('Enter vault password to unlock recordings:');
  if (!pass) return false;
  await window.recordingVault.vaultUnlock(pass);
  refreshVaultStatusPill();
  return true;
}

async function openLocalVaultRecord(rec, forDownload){
  if (!window.recordingVault?.vaultDecryptToArrayBuffer) {
    alert('Vault module is not loaded.');
    return;
  }
  const ok = await ensureVaultUnlockedFromRecords();
  if (!ok) return;
  const localId = String(rec.id);
  const vaultMeta = rec.vaultMeta || await resolveVaultRowById(localId);
  if (!vaultMeta?.ivB64 || !vaultMeta?.cipherB64) {
    alert('Encrypted payload not found for this local record.');
    return;
  }
  const plain = await window.recordingVault.vaultDecryptToArrayBuffer(vaultMeta.ivB64, vaultMeta.cipherB64);
  const blob = new Blob([plain], { type: vaultMeta.mimeType || "video/webm" });
  const blobUrl = URL.createObjectURL(blob);
  if (forDownload) {
    const a=document.createElement('a');
    a.href=blobUrl;
    a.download=`${rec.category||'record'}_${rec.resident_name||'resident'}.webm`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 4000);
    return;
  }
  window.open(blobUrl, '_blank');
  setTimeout(() => URL.revokeObjectURL(blobUrl), 120000);
}

async function viewRecord(id){
  const r=records.find(x=>String(x.id)===String(id));
  if(!r) return;
  const params = new URLSearchParams();
  params.set('tab', 'playback');
  params.set('playback_id', String(r.id));
  if (r?.file_url) {
    params.set('playback_file', String(r.file_url));
  }
  window.location.href = `/pages/recording_console.html?${params.toString()}`;
}
async function downloadRecord(id){
  const r=records.find(x=>String(x.id)===String(id));
  if(!r) return;
  if (isLocalVaultRecord(r)) {
    await openLocalVaultRecord(r, true);
    return;
  }
  if(r?.file_url&&r.file_url!=='#'){
    const a=document.createElement('a');
    a.href=r.file_url;
    a.download=`${r.category||'record'}_${r.resident_name||'resident'}`;
    a.click();
  } else alert('No file available to download.');
}

function resolveServerIdForRecord(rec) {
  if (/^\d+$/.test(String(rec?.id))) return String(rec.id);
  const localId = localVaultIdFromRec(rec);
  if (!localId) return null;
  const match = records.find(
    (x) => /^\d+$/.test(String(x.id)) && localVaultIdFromRec(x) === localId
  );
  return match ? String(match.id) : null;
}

async function deleteRecord(id) {
  const r = records.find((x) => String(x.id) === String(id));
  if (!r) return;
  if (recordNeedsVaultAccess(r) || localVaultIdFromRec(r)) {
    const vaultOk = await ensureVaultUnlockedForDelete();
    if (!vaultOk) return;
  }
  const label = r.category || r.resident_name || 'this recording';
  openDeleteConfirmModal({
    title: 'Delete recording',
    message: `Remove "${label}" from this device and the server (if uploaded). Vault is unlocked. This cannot be undone.`,
    onConfirm: async () => {
      if (!(await ensureVaultUnlockedForDelete())) {
        throw new Error('Vault is locked. Unlock the vault and try again.');
      }
      const localId = localVaultIdFromRec(r);
      const serverId = resolveServerIdForRecord(r);
      await removeLocalVaultById(localId);
      if (serverId) await deleteServerRecordById(serverId);
      dropRecordsFromState({ localId, serverId, primaryId: r.id });
    },
  });
}

async function openDeleteAllModal() {
  const vaultOk = await ensureVaultUnlockedForDelete();
  if (!vaultOk) return;
  openDeleteConfirmModal({
    title: 'Delete all recordings',
    message: `Remove all ${records.length} recording(s) from this browser vault and the server. Vault is unlocked. This cannot be undone.`,
    onConfirm: async () => {
      if (!(await ensureVaultUnlockedForDelete())) {
        throw new Error('Vault is locked. Unlock the vault and try again.');
      }
      await deleteAllRecordsConfirmed();
    },
  });
}

async function deleteAllRecordsConfirmed() {
  if (!(await ensureVaultUnlockedForDelete())) {
    throw new Error('Vault is locked. Unlock the vault and try again.');
  }
  const localRows = window.recordingVault?.vaultListRecordings
    ? await window.recordingVault.vaultListRecordings()
  : [];
  for (const row of localRows) {
    await removeLocalVaultById(row.id);
  }
  localStorage.removeItem(LOCAL_RECORDING_INDEX_KEY);

  let serverDeleted = 0;
  const res = await fetch(`${API_BASE}/records/bulk/all`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  if (res.status === 401) throw new Error('Not signed in. Log in and try again.');
  if (res.ok) {
    const data = await res.json();
    serverDeleted = Number(data.deleted) || 0;
  } else {
    const rows = await fetch(`${API_BASE}/records/?limit=200`, { headers: authHeaders() });
    if (rows.ok) {
      const list = await rows.json();
      for (const r of Array.isArray(list) ? list : []) {
        await deleteServerRecordById(r.id);
        serverDeleted += 1;
      }
    }
  }

  records = [];
  await loadRecords();
  alert(`Deleted ${localRows.length} local vault clip(s) and ${serverDeleted} server record(s).`);
}

async function unlockVaultFromRecords(){
  try {
    const ok = await ensureVaultUnlockedFromRecords();
    if (ok) alert('Vault unlocked.');
  } catch (err) {
    alert(`Vault unlock failed: ${err?.message || err}`);
  } finally {
    refreshVaultStatusPill();
  }
}

function lockVaultFromRecords(){
  if (!window.recordingVault?.vaultLock) {
    alert('Vault lock feature is not available.');
    return;
  }
  window.recordingVault.vaultLock();
  refreshVaultStatusPill();
  alert('Vault locked.');
}

async function deleteAllLocalVaultRecords(){
  await openDeleteAllModal();
}

// RENDER
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function bindDeleteButtons(root) {
  if (!root) return;
  root.querySelectorAll('[data-delete-record-id]').forEach((btn) => {
    if (btn.dataset.deleteBound) return;
    btn.dataset.deleteBound = '1';
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      deleteRecord(btn.getAttribute('data-delete-record-id'));
    });
  });
}

function renderAll(){
  renderGrid(); renderList();
  bindDeleteButtons(document.getElementById('view-grid'));
  bindDeleteButtons(document.getElementById('rec-tbody'));
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
  const idArg = JSON.stringify(r.id);
  const figs=['🚶','🧑','👴','👵','🧓','🧑‍🦯'];
  const f1=figs[i%figs.length], f2=figs[(i+3)%figs.length];
  const s1=7+i*1.5, s2=11+i*1.2;
  if(r.record_type==='document') return `
    <div class="rec-thumb-doc" onclick="viewRecord(${idArg})">
      <svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
      <div class="type-badge-abs rtb-document">document</div>
    </div>`;
  if(r.record_type==='audio') return `
    <div class="rec-thumb-audio" onclick="viewRecord(${idArg})">
      <svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>
      <div class="type-badge-abs rtb-audio">audio</div>
    </div>`;
  return `
    <div class="rec-thumb" onclick="viewRecord(${idArg})">
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
        ${(() => {
          const dt = normalizeRecordDateTime(r);
          return `
        <div class="rec-name">${r.resident_name||'—'}</div>
        <div class="rec-category">${r.category||'—'}</div>
        <div class="rec-datetime">${dt.dateText}&nbsp;&nbsp;${dt.timeText}</div>
        <div class="rec-notes">${r.notes||'—'}</div>
        <div class="rec-actions-row">
          <button class="ra-btn view" onclick='viewRecord(${JSON.stringify(r.id)})'>
            <svg viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>View
          </button>
          <button class="ra-btn dl" onclick='downloadRecord(${JSON.stringify(r.id)})'>
            <svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>Download
          </button>
          <button type="button" class="ra-btn del" data-delete-record-id="${escapeHtml(String(r.id))}">
            <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>Delete
          </button>
        </div>
      </div>`;
      })()}
    </div>`).join('');
  startTsTimers();
}

function renderList(){
  document.getElementById('rec-tbody').innerHTML=records.map(r=>`
    <tr>
      ${(() => {
        const dt = normalizeRecordDateTime(r);
        return `
      <td style="font-weight:700">${r.resident_name||'—'}</td>
      <td>${r.category||'—'}</td>
      <td><span class="type-pill tp-${r.record_type||'document'}">${r.record_type||'—'}</span></td>
      <td>${r.duration||'—'}</td>
      <td><div style="font-size:12.5px">${dt.dateText}</div><div style="font-size:11px;color:var(--text3)">${dt.timeText}</div></td>
      <td style="max-width:170px;font-size:12.5px;color:var(--text2)">${r.notes||'—'}</td>
      <td><div style="display:flex;gap:5px">
        <button class="tbl-btn" title="View" onclick='viewRecord(${JSON.stringify(r.id)})'><svg viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></button>
        <button class="tbl-btn dl" title="Download" onclick='downloadRecord(${JSON.stringify(r.id)})'><svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg></button>
        <button type="button" class="tbl-btn" title="Delete" data-delete-record-id="${escapeHtml(String(r.id))}"><svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg></button>
      </div></td>
    </tr>`;
      })()}
  `).join('');
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
    renderInsights(data.insights||[]);
  }catch(e){ renderInsights([]); }
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
function openModal(id){
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.add('open');
  document.body.style.overflow = 'hidden';
  if (typeof window.hideSkeleton === 'function') window.hideSkeleton();
}
function closeModal(id){
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove('open');
  document.body.style.overflow = '';
}
document.addEventListener('DOMContentLoaded', function() {
  document.querySelectorAll('.overlay').forEach(o=>o.addEventListener('click',e=>{if(e.target===o)closeModal(o.id);}));
  const delBtn = document.getElementById('delete-confirm-submit');
  if (delBtn) delBtn.addEventListener('click', () => submitDeleteConfirmModal());
  const delInput = document.getElementById('delete-confirm-input');
  if (delInput) {
    delInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submitDeleteConfirmModal();
    });
  }
});

function showApiStatus(connected){
  let el=document.getElementById('api-status');
  if(!el){el=document.createElement('div');el.id='api-status';el.style.cssText='position:fixed;bottom:18px;right:18px;padding:8px 14px;border-radius:10px;font-size:12px;font-weight:700;z-index:999;transition:opacity 3s;';document.body.append(el);}
  el.textContent=connected?'✓ Connected to API':'⚠ Using demo data (API offline)';
  el.style.background=connected?'#dcfce7':'#fff7ed';
  el.style.color=connected?'#15803d':'#c2410c';
  el.style.opacity='1';setTimeout(()=>el.style.opacity='0',3000);
}

// DEMO DATA

window.deleteRecord = deleteRecord;
window.openDeleteAllModal = openDeleteAllModal;
window.closeDeleteConfirmModal = closeDeleteConfirmModal;
window.deleteAllLocalVaultRecords = deleteAllLocalVaultRecords;

// INIT
document.addEventListener('DOMContentLoaded', function() {
  loadCategories();
  loadRecords();
  loadInsights();
  refreshVaultStatusPill();
  setInterval(refreshVaultStatusPill, 2500);
});