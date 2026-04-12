var ME = { name: 'Sarah Chen', role: 'Senior Carer' };

// Pull name/role from session if available
(function () {
  try {
    var u = JSON.parse(sessionStorage.getItem('user') || '{}');
    if (u.full_name) ME.name = u.full_name;
    if (u.role || u.global_role) ME.role = u.role || u.global_role;
  } catch (_) {}
})();

function authH() { var h = { 'Content-Type': 'application/json' }; var t = sessionStorage.getItem('access_token'); if (t) h['Authorization'] = 'Bearer ' + t; return h; }
function authHF() { var h = {}; var t = sessionStorage.getItem('access_token'); if (t) h['Authorization'] = 'Bearer ' + t; return h; }
function esc(s) { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function ini(n) { return (n || '?').split(' ').map(function (w) { return w[0]; }).join('').toUpperCase().slice(0, 2); }
function scrollBottom() { var el = document.getElementById('chat-messages'); if (el) el.scrollTop = el.scrollHeight; }
function fmtSize(b) { if (b < 1024) return b + 'B'; if (b < 1048576) return (b / 1024).toFixed(1) + 'KB'; return (b / 1048576).toFixed(1) + 'MB'; }

var DEMO_CONVS = [
  { id: 1, name: 'Care Team - Floor 2', category: 'team', last_message: "Perfect, I'll check on her in 10 minutes", last_message_at: '9:32 AM', unread_count: 3, sub: 'Floor 2 · 4 participants', color: '#2ec4b6', online: true },
  { id: 2, name: 'Sarah Chen', category: 'team', last_message: "Can you help me with Mrs. Johnson's medication schedule?", last_message_at: '11:15 AM', unread_count: 1, sub: 'Senior Carer', color: '#7c3aed', online: true },
  { id: 3, name: 'Resident Care: Dorothy Williams', category: 'resident', last_message: 'Daily care report completed successfully', last_message_at: 'Yesterday', unread_count: 0, sub: 'Room 106', color: '#db2777', online: false },
  { id: 4, name: 'Night Shift Handover', category: 'team', last_message: 'All residents sleeping peacefully.', last_message_at: 'Yesterday', unread_count: 0, sub: 'Night Team', color: '#059669', online: false },
  { id: 5, name: 'Emergency Alerts', category: 'alerts', last_message: 'Fire drill scheduled for tomorrow at 2 PM', last_message_at: '2 days ago', unread_count: 0, sub: 'System Alerts', color: '#ef4444', online: false },
];
var DEMO_MSGS = {
  1: [
    { id: 1, conversation_id: 1, sender_name: 'Sarah Chen', sender_role: 'Senior Carer', content: "Hi team! Mrs. Johnson in room 204 is asking for her afternoon medication. Can someone check on her?", is_self: 'false', created_at: '9:30 AM' },
    { id: 2, conversation_id: 1, sender_name: 'Me', sender_role: 'Senior Carer', content: "Perfect, I'll check on her in 10 minutes", is_self: 'true', created_at: '9:32 AM' },
    { id: 3, conversation_id: 1, sender_name: 'Mike Roberts', sender_role: 'Nurse', content: "Thanks! I've also updated her care plan with the new medication schedule.", is_self: 'false', created_at: '10:15 AM' }
  ],
  2: [{ id: 4, conversation_id: 2, sender_name: 'Sarah Chen', sender_role: 'Senior Carer', content: "Can you help me with Mrs. Johnson's medication schedule?", is_self: 'false', created_at: '11:15 AM' }],
  3: [
    { id: 5, conversation_id: 3, sender_name: 'Linda Pham', sender_role: 'Carer', content: "Daily care report for Dorothy Williams completed. All vitals stable.", is_self: 'false', created_at: '3:00 PM' },
    { id: 6, conversation_id: 3, sender_name: 'Me', sender_role: 'Senior Carer', content: "Thank you! I've reviewed the report.", is_self: 'true', created_at: '3:05 PM' }
  ],
  4: [{ id: 7, conversation_id: 4, sender_name: 'Night Team', sender_role: 'Carer', content: "All residents sleeping peacefully. No incidents to report.", is_self: 'false', created_at: '10:00 PM' }],
  5: [{ id: 8, conversation_id: 5, sender_name: 'System', sender_role: 'Admin', content: "Fire drill scheduled for tomorrow at 2 PM. All staff please be prepared.", is_self: 'false', created_at: '2 days ago' }],
};

var allConvs = [], filteredConvs = [], currentId = null, currentCat = '', localMsgs = {}, demo = false, pendingFiles = [];
var CAT_CLR = { team: '#2ec4b6', resident: '#7c3aed', alerts: '#ef4444' };
var ID_CLR = ['#2ec4b6', '#7c3aed', '#db2777', '#059669', '#d97706', '#0369a1', '#dc2626', '#9333ea'];
var SC_CLR = ['#7c3aed', '#db2777', '#d97706', '#0369a1', '#059669', '#dc2626'];
var SENDER_CLR = {}, sci = 0;

function convClr(id, cat) { return CAT_CLR[cat] || ID_CLR[id % ID_CLR.length]; }
function senderClr(n) { if (!SENDER_CLR[n]) SENDER_CLR[n] = SC_CLR[sci++ % SC_CLR.length]; return SENDER_CLR[n]; }
function catLabel(c) { return { team: 'Team Chat', resident: 'Resident Care', alerts: 'System Alerts' }[c] || 'Chat'; }

async function loadConvs() {
  try {
    var r = await fetch(API_BASE + '/messages/conversations', { headers: authH() });
    if (!r.ok) throw new Error();
    var d = await r.json();
    if (d.length) {
      allConvs = d.map(function (c) {
        return { id: c.id, name: c.name, category: c.category, last_message: c.last_message || '', last_message_at: c.last_message_at || '', unread_count: c.unread_count || 0, sub: catLabel(c.category), color: convClr(c.id, c.category), online: false };
      });
      demo = false;
    } else throw new Error();
  } catch (e) {
    allConvs = DEMO_CONVS.map(function (c) { return Object.assign({}, c); });
    demo = true;
  }
  updateLabel();
  filterConvs();
}

function updateLabel() {
  var t = allConvs.reduce(function (s, c) { return s + (c.unread_count || 0); }, 0);
  document.getElementById('unread-label').textContent = t ? t + ' unread message' + (t !== 1 ? 's' : '') : 'All caught up';
}

function setCat(cat, btn) {
  currentCat = cat;
  document.querySelectorAll('.cat-tab').forEach(function (b) { b.classList.remove('active'); });
  btn.classList.add('active');
  filterConvs();
}

function filterConvs() {
  var q = document.getElementById('conv-search').value.toLowerCase();
  filteredConvs = allConvs.filter(function (c) {
    if (currentCat && c.category !== currentCat) return false;
    if (q && !c.name.toLowerCase().includes(q) && !(c.last_message || '').toLowerCase().includes(q)) return false;
    return true;
  });
  renderConvList();
}

// ── FIXED renderConvList — correct quotes so onclick fires ──
function renderConvList() {
  var el = document.getElementById('conv-list');
  if (!filteredConvs.length) {
    el.innerHTML = '<div style="text-align:center;padding:40px 20px;color:var(--text3);font-size:13px;">No conversations found</div>';
    return;
  }
  el.innerHTML = filteredConvs.map(function (c) {
    var isAlert = c.category === 'alerts';
    var badge = c.unread_count > 0 ? '<div class="unread-badge">' + c.unread_count + '</div>' : '';
    var dot = c.online ? '<div class="online-dot"></div>' : '';
    return '<div class="conv-item' + (c.id === currentId ? ' active' : '') + '" onclick="openConv(' + c.id + ')">' +
      '<div class="conv-av' + (isAlert ? ' alert-av' : '') + '" style="background:' + (isAlert ? '#ef4444' : c.color) + '">' + ini(c.name) + dot + '</div>' +
      '<div class="conv-body">' +
      '<div class="conv-name-row"><div class="conv-name' + (c.unread_count > 0 ? ' unread' : '') + '">' + esc(c.name) + '</div><div class="conv-time">' + (c.last_message_at || '') + '</div></div>' +
      '<div class="conv-preview-row"><div class="conv-preview">' + esc(c.last_message || '') + '</div>' + badge + '</div>' +
      '</div></div>';
  }).join('');
}

async function openConv(id) {
  currentId = id;
  var conv = allConvs.find(function (c) { return c.id === id; });
  if (!conv) return;
  conv.unread_count = 0;
  updateLabel();
  renderConvList();
  try { if (!demo) await fetch(API_BASE + '/messages/conversations/' + id + '/read', { method: 'PATCH', headers: authH() }); } catch (e) {}
  document.getElementById('chat-empty').style.display = 'none';
  var cv = document.getElementById('chat-view');
  cv.style.display = 'flex';
  document.getElementById('ch-av').textContent = ini(conv.name);
  document.getElementById('ch-av').style.background = conv.color;
  document.getElementById('ch-name').textContent = conv.name;
  document.getElementById('ch-sub').textContent = conv.sub || catLabel(conv.category);
  await loadMsgs(id);
  document.getElementById('msg-input').focus();
}

async function loadMsgs(id) {
  if (localMsgs[id]) { renderMsgs(localMsgs[id]); return; }
  try {
    if (demo) throw new Error();
    var r = await fetch(API_BASE + '/messages/conversations/' + id + '/messages', { headers: authH() });
    if (!r.ok) throw new Error();
    localMsgs[id] = await r.json();
  } catch (e) {
    localMsgs[id] = (DEMO_MSGS[id] || []).map(function (m) { return Object.assign({}, m); });
  }
  renderMsgs(localMsgs[id]);
}

function fmtTime(t) {
  if (typeof t === 'string') return t;
  try { return new Date(t).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; }
}

function makeFileBubble(fname, furl) {
  var fullUrl = furl.startsWith('http') ? furl : API_BASE + furl;
  var ext = fname.split('.').pop().toLowerCase();
  var isImg = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'].includes(ext);
  var isVid = ['mp4', 'mov', 'avi', 'webm', 'mpeg'].includes(ext);
  if (isImg) return '<img class="img-bubble" src="' + fullUrl + '" alt="' + esc(fname) + '" onclick="window.open(\'' + fullUrl + '\')" />';
  if (isVid) return '<video class="vid-bubble" src="' + fullUrl + '" controls></video>';
  return '<a class="file-bubble" href="' + fullUrl + '" download="' + esc(fname) + '" target="_blank"><div class="file-bubble-icon"><svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></div><div><div class="file-bubble-name">' + esc(fname) + '</div><div class="file-bubble-size">Tap to download</div></div></a>';
}

function localFileBubble(f) {
  if (f.type === 'image') return '<img class="img-bubble" src="' + f.objectUrl + '" alt="' + esc(f.file.name) + '" onclick="window.open(\'' + f.objectUrl + '\')" />';
  if (f.type === 'video') return '<video class="vid-bubble" src="' + f.objectUrl + '" controls></video>';
  return '<a class="file-bubble" href="' + f.objectUrl + '" download="' + esc(f.file.name) + '" target="_blank"><div class="file-bubble-icon"><svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></div><div><div class="file-bubble-name">' + esc(f.file.name) + '</div><div class="file-bubble-size">' + fmtSize(f.file.size) + '</div></div></a>';
}

function renderMsgs(msgs, hl) {
  var el = document.getElementById('chat-messages');
  if (!msgs.length) { el.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text3);font-size:13px;">No messages yet. Say hello!</div>'; return; }
  var html = '<div class="date-div">Today</div>';
  msgs.forEach(function (m, i) {
    var isSelf = m.is_self === true || m.is_self === 'true';
    var clr = isSelf ? '#2ec4b6' : senderClr(m.sender_name);
    var t = fmtTime(m.created_at);
    var showName = !isSelf && (i === 0 || msgs[i - 1].sender_name !== m.sender_name || msgs[i - 1].is_self === true || msgs[i - 1].is_self === 'true');
    var tick = isSelf ? '<span class="tick"><svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg></span>' : '';
    var bubbleHtml;
    if (m.fileHtml) {
      bubbleHtml = m.fileHtml;
    } else if (m.content && m.content.startsWith('[file] ')) {
      var parts = m.content.slice(7).split(' | ');
      bubbleHtml = makeFileBubble(parts[0] || 'file', parts[1] || '');
    } else {
      var txt = esc(m.content || '');
      if (hl) txt = txt.replace(new RegExp(esc(hl).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), function (s) { return '<mark style="background:#fef08a;border-radius:3px;">' + s + '</mark>'; });
      bubbleHtml = isSelf ? '<div class="bubble self">' + txt + '</div>' : '<div class="bubble other">' + txt + '</div>';
    }
    if (isSelf) {
      html += '<div class="msg-row self"><div class="msg-col">' + bubbleHtml + '<div class="msg-meta" style="justify-content:flex-end"><div class="msg-time">' + t + '</div>' + tick + '</div></div></div>';
    } else {
      html += '<div class="msg-row"><div class="msg-av" style="background:' + clr + '">' + ini(m.sender_name) + '</div><div class="msg-col">' + (showName ? '<div class="msg-sender">' + esc(m.sender_name) + ' · ' + esc(m.sender_role || '') + '</div>' : '') + bubbleHtml + '<div class="msg-meta"><div class="msg-time">' + t + '</div></div></div></div>';
    }
  });
  el.innerHTML = html;
  scrollBottom();
}

function handleFiles(files) {
  if (!currentId) { alert('Please select a conversation first.'); return; }
  Array.from(files).forEach(function (file) {
    var type = file.type.startsWith('image/') ? 'image' : file.type.startsWith('video/') ? 'video' : 'doc';
    pendingFiles.push({ file: file, objectUrl: URL.createObjectURL(file), type: type });
  });
  document.getElementById('file-input').value = '';
  renderFilePreview();
}

function renderFilePreview() {
  var strip = document.getElementById('file-preview-strip');
  if (!pendingFiles.length) { strip.style.display = 'none'; return; }
  strip.style.display = 'flex';
  strip.innerHTML = pendingFiles.map(function (f, i) {
    var inner;
    if (f.type === 'image') inner = '<img src="' + f.objectUrl + '" alt="' + esc(f.file.name) + '"/>';
    else if (f.type === 'video') inner = '<video src="' + f.objectUrl + '" muted></video>';
    else inner = '<div class="fp-doc"><svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg><div class="fp-doc-name">' + esc(f.file.name) + '</div></div>';
    return '<div class="fp-item">' + inner + '<button class="fp-remove" onclick="removePending(' + i + ')">x</button></div>';
  }).join('');
}

function removePending(i) { URL.revokeObjectURL(pendingFiles[i].objectUrl); pendingFiles.splice(i, 1); renderFilePreview(); }
function handleKey(e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }

async function sendMessage() {
  var input = document.getElementById('msg-input');
  var content = input.value.trim();
  if (!content && !pendingFiles.length) return;
  if (!currentId) return;
  input.value = '';
  autoResize(input);
  var now = new Date().toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' });
  if (!localMsgs[currentId]) localMsgs[currentId] = [];
  var filesToSend = pendingFiles.slice();
  pendingFiles = [];
  renderFilePreview();

  for (var i = 0; i < filesToSend.length; i++) {
    var f = filesToSend[i];
    var tempMsg = { id: Date.now() + Math.random(), conversation_id: currentId, sender_name: ME.name, sender_role: ME.role, content: '', is_self: true, created_at: now, fileHtml: localFileBubble(f) };
    localMsgs[currentId].push(tempMsg);
    try {
      if (!demo) {
        var form = new FormData();
        form.append('file', f.file);
        var res = await fetch(API_BASE + '/messages/upload', { method: 'POST', headers: authHF(), body: form });
        if (res.ok) {
          var info = await res.json();
          tempMsg.fileHtml = makeFileBubble(info.filename, info.url);
          var mc = '[file] ' + info.filename + ' | ' + info.url;
          await fetch(API_BASE + '/messages/conversations/' + currentId + '/messages', { method: 'POST', headers: authH(), body: JSON.stringify({ conversation_id: currentId, sender_name: ME.name, sender_role: ME.role, content: mc, is_self: true, message_type: 'text' }) });
        }
      }
    } catch (e) {}
  }

  if (filesToSend.length && !content) {
    var conv0 = allConvs.find(function (c) { return c.id === currentId; });
    if (conv0) { conv0.last_message = '[File] ' + filesToSend[0].file.name; conv0.last_message_at = now; }
  }

  if (content) {
    var msg = { id: Date.now(), conversation_id: currentId, sender_name: ME.name, sender_role: ME.role, content: content, is_self: true, created_at: now };
    localMsgs[currentId].push(msg);
    var conv1 = allConvs.find(function (c) { return c.id === currentId; });
    if (conv1) { conv1.last_message = content; conv1.last_message_at = now; }
    try {
      if (!demo) await fetch(API_BASE + '/messages/conversations/' + currentId + '/messages', { method: 'POST', headers: authH(), body: JSON.stringify({ conversation_id: currentId, sender_name: ME.name, sender_role: ME.role, content: content, is_self: true, message_type: 'text' }) });
    } catch (e) {}
  }

  renderMsgs(localMsgs[currentId]);
  renderConvList();
}

function autoResize(el) { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 120) + 'px'; }
function markCurrentUnread() { if (!currentId) return; var c = allConvs.find(function (x) { return x.id === currentId; }); if (!c) return; c.unread_count = (c.unread_count || 0) + 1; updateLabel(); renderConvList(); }
function markCurrentRead() { if (!currentId) return; var c = allConvs.find(function (x) { return x.id === currentId; }); if (!c) return; c.unread_count = 0; updateLabel(); renderConvList(); try { if (!demo) fetch(API_BASE + '/messages/conversations/' + currentId + '/read', { method: 'PATCH', headers: authH() }); } catch (e) {} }
function toggleMsgSearch() { var bar = document.getElementById('msg-search-bar'); var open = bar.style.display === 'none' || bar.style.display === ''; bar.style.display = open ? 'block' : 'none'; if (open) document.getElementById('msg-search-input').focus(); else { document.getElementById('msg-search-input').value = ''; renderMsgs(localMsgs[currentId] || []); } }
function searchInChat() { var q = document.getElementById('msg-search-input').value.trim(); renderMsgs(localMsgs[currentId] || [], q); }
function showCtx(e) { e.stopPropagation(); var m = document.getElementById('ctx'); m.style.top = e.clientY + 'px'; m.style.left = Math.max(0, e.clientX - 180) + 'px'; m.classList.add('show'); }
function hideCtx() { document.getElementById('ctx').classList.remove('show'); }
document.addEventListener('click', hideCtx);

async function deleteConv() {
  if (!currentId) return;
  if (!confirm('Delete this conversation?')) return;
  try { if (!demo) await fetch(API_BASE + '/messages/conversations/' + currentId, { method: 'DELETE', headers: authH() }); } catch (e) {}
  allConvs = allConvs.filter(function (c) { return c.id !== currentId; });
  delete localMsgs[currentId];
  currentId = null;
  document.getElementById('chat-view').style.display = 'none';
  document.getElementById('chat-empty').style.display = 'flex';
  updateLabel();
  filterConvs();
}

function openNewModal() { document.getElementById('new-name').value = ''; document.getElementById('modal-new').classList.add('open'); setTimeout(function () { document.getElementById('new-name').focus(); }, 80); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

async function createConv() {
  var name = document.getElementById('new-name').value.trim();
  var cat = document.getElementById('new-cat').value;
  if (!name) { document.getElementById('new-name').focus(); return; }
  var newId = Date.now();
  try {
    if (!demo) {
      var r = await fetch(API_BASE + '/messages/conversations', { method: 'POST', headers: authH(), body: JSON.stringify({ name: name, category: cat }) });
      if (r.ok) { var d = await r.json(); newId = d.id; }
    }
  } catch (e) {}
  var c = { id: newId, name: name, category: cat, last_message: '', last_message_at: 'Just now', unread_count: 0, sub: catLabel(cat), color: convClr(newId, cat), online: false };
  allConvs.unshift(c);
  localMsgs[newId] = [];
  filterConvs();
  closeModal('modal-new');
  openConv(newId);
}

document.addEventListener('DOMContentLoaded', function () {
  var area = document.getElementById('chat-messages');
  if (!area) return;
  area.addEventListener('dragover', function (e) { e.preventDefault(); area.classList.add('drag-over'); });
  area.addEventListener('dragleave', function () { area.classList.remove('drag-over'); });
  area.addEventListener('drop', function (e) { e.preventDefault(); area.classList.remove('drag-over'); if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files); });
});

loadConvs();

// ════════════════════════════════════════════════════════════
// CALLING FEATURE — 3 Layer Architecture
// ────────────────────────────────────────────────────────────
// Layer 1: Capture  — getUserMedia, raw audio/video stream
// Layer 2: Empty    — reserved for AI processing pipeline
//                     (transcription, sentiment, keywords)
// Layer 3: Display  — renders call UI overlay + controls
// ════════════════════════════════════════════════════════════

var _call = { active: false, type: null, stream: null, muted: false, videoOff: false, timer: null, seconds: 0 };

// ── Layer 1: Capture raw media ────────────────────────────────
async function _L1_capture(type) {
  try {
    var stream = await navigator.mediaDevices.getUserMedia(
      type === 'video' ? { audio: true, video: { width: 1280, height: 720 } } : { audio: true, video: false }
    );
    _call.stream = stream;
    return stream;
  } catch (e) {
    _call.stream = null;
    return null;
  }
}

// ── Layer 2: AI Processing — reserved ─────────────────────────
// Connect AI gateway here (transcription / sentiment / keywords)
// ── Layer 2: ASL AI Detection ─────────────────────────────────
// Captures frames from the video element → POST to /api/v1/ai/asl/detect
// Backend: MediaPipe extracts landmarks → trained classifier → returns letter
var _aslCanvas  = null;
var _aslCtx     = null;
var _aslLoop    = null;
var _aslSentence = '';
var _aslHoldLetter = '';
var _aslHoldCount  = 0;
var ASL_HOLD_FRAMES   = 18;
var ASL_INTERVAL_MS   = 180;
var ASL_STATIC_CONF   = 0.70;
var ASL_MOTION_CONF   = 0.76;
var ASL_MOTION_SEQLEN = 10;
var _aslMotionSeq     = [];

function _L2_aiPipeline(stream) {
  // Only run for video calls with a real stream
  if (!stream || !stream.getVideoTracks().length) return stream;

  // Offscreen canvas for frame capture
  _aslCanvas = document.createElement('canvas');
  _aslCanvas.width  = 320;
  _aslCanvas.height = 240;
  _aslCtx = _aslCanvas.getContext('2d');

  // Show ASL subtitle box in overlay
  _aslSentence   = '';
  _aslHoldLetter = '';
  _aslHoldCount  = 0;
  _aslMotionSeq  = [];
  // subtitle injected after _L3_showOverlay to avoid innerHTML wipe

  // Start detection loop
  _aslLoop = setInterval(_aslDetectFrame, ASL_INTERVAL_MS);

  return stream;
}

// ── Transcript panel — shared by both modes ──────────────────
// Panel layout:
//   TOP:    Mode tabs  [🎤 Speech] [👋 ASL]
//   MIDDLE: Live transcript text
//   BOTTOM: [Clear] [Space] (ASL only)

var _transcriptMode = 'speech';   // 'speech' | 'asl'
var _speechRec      = null;
var _speechFinal    = '';
var _speechInterim  = '';

function _injectAslSubtitle() {
  var el = document.getElementById('call-overlay');
  if (!el) return;
  if (document.getElementById('transcript-panel')) return;
  var box = document.createElement('div');
  box.id = 'transcript-panel';
  box.style.cssText = [
    'position:absolute;bottom:100px;left:50%;transform:translateX(-50%);z-index:99;',
    'background:rgba(0,0,0,0.80);backdrop-filter:blur(8px);',
    'border-radius:14px;padding:12px 16px;min-width:300px;max-width:90%;',
    'font-family:Inter,sans-serif;box-sizing:border-box;',
  ].join('');

  box.innerHTML =
    // Mode tabs
    '<div style="display:flex;gap:6px;margin-bottom:10px;justify-content:center;">' +
      '<button id="tab-speech" onclick="_switchTranscriptMode(&quot;speech&quot;)" style="' +
        'font-size:12px;padding:4px 14px;border-radius:20px;cursor:pointer;border:none;' +
        'background:rgba(56,189,248,0.9);color:#0f172a;font-weight:700;">🎤 Speech</button>' +
      '<button id="tab-asl" onclick="_switchTranscriptMode(&quot;asl&quot;)" style="' +
        'font-size:12px;padding:4px 14px;border-radius:20px;cursor:pointer;border:none;' +
        'background:rgba(255,255,255,0.15);color:#fff;">👋 ASL</button>' +
    '</div>' +
    // Live text area
    '<div id="transcript-live" style="' +
      'font-size:14px;color:#fff;line-height:1.55;min-height:40px;max-height:100px;' +
      'overflow-y:auto;text-align:center;word-break:break-word;"></div>' +
    // ASL detail row (letter + confidence)
    '<div id="asl-detail-row" style="display:none;margin-top:6px;text-align:center;">' +
      '<span id="asl-live-letter" style="font-size:36px;font-weight:700;color:#fff;line-height:1;">—</span>' +
      '<span id="asl-live-conf" style="font-size:11px;color:#9fe1cb;margin-left:8px;"></span>' +
    '</div>' +
    // ASL controls
    '<div id="asl-controls" style="display:none;gap:6px;margin-top:8px;justify-content:center;">' +
      '<button onclick="_aslToggleGesture()" id="asl-mode-btn" style="' +
        'font-size:11px;padding:3px 10px;background:rgba(56,189,248,0.25);' +
        'border:0.5px solid rgba(56,189,248,0.4);border-radius:6px;color:#38bdf8;cursor:pointer;">Static A-Z</button>' +
      '<button onclick="_aslClear()" style="' +
        'font-size:11px;padding:3px 10px;background:rgba(255,255,255,0.12);' +
        'border:0.5px solid rgba(255,255,255,0.2);border-radius:6px;color:#fff;cursor:pointer;">Clear</button>' +
      '<button onclick="_aslSpace()" style="' +
        'font-size:11px;padding:3px 10px;background:rgba(255,255,255,0.12);' +
        'border:0.5px solid rgba(255,255,255,0.2);border-radius:6px;color:#fff;cursor:pointer;">Space</button>' +
    '</div>' +
    // Speech status
    '<div id="speech-status" style="font-size:11px;color:rgba(255,255,255,0.5);text-align:center;margin-top:6px;">Listening…</div>';

  el.appendChild(box);

  // Start in speech mode by default
  _switchTranscriptMode('speech');
}

function _switchTranscriptMode(mode) {
  _transcriptMode = mode;

  // Update tab styles
  var ts = document.getElementById('tab-speech');
  var ta = document.getElementById('tab-asl');
  if (ts) { ts.style.background = mode==='speech' ? 'rgba(56,189,248,0.9)' : 'rgba(255,255,255,0.15)'; ts.style.color = mode==='speech' ? '#0f172a' : '#fff'; }
  if (ta) { ta.style.background = mode==='asl'    ? 'rgba(56,189,248,0.9)' : 'rgba(255,255,255,0.15)'; ta.style.color = mode==='asl'    ? '#0f172a' : '#fff'; }

  var aslDetail = document.getElementById('asl-detail-row');
  var aslCtrl   = document.getElementById('asl-controls');
  var spStatus  = document.getElementById('speech-status');

  if (mode === 'speech') {
    if (aslDetail) aslDetail.style.display = 'none';
    if (aslCtrl)   aslCtrl.style.display   = 'none';
    if (spStatus)  spStatus.style.display  = 'block';
    _startSpeechRecognition();
  } else {
    if (aslDetail) aslDetail.style.display = 'block';
    if (aslCtrl)   aslCtrl.style.display   = 'flex';
    if (spStatus)  spStatus.style.display  = 'none';
    _stopSpeechRecognition();
    _updateTranscriptLive(_aslSentence || '…');
  }
}

// ── Speech Recognition (Web Speech API) ──────────────────────
function _startSpeechRecognition() {
  _stopSpeechRecognition();
  var SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRec) {
    var el = document.getElementById('speech-status');
    if (el) el.textContent = 'Speech recognition not supported in this browser.';
    return;
  }
  _speechRec = new SpeechRec();
  _speechRec.continuous     = true;
  _speechRec.interimResults = true;
  _speechRec.lang           = 'en-AU';

  _speechRec.onstart = function() {
    var el = document.getElementById('speech-status');
    if (el) el.textContent = '🔴 Listening…';
  };

  _speechRec.onresult = function(e) {
    _speechInterim = '';
    for (var i = e.resultIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) {
        _speechFinal += e.results[i][0].transcript + ' ';
      } else {
        _speechInterim += e.results[i][0].transcript;
      }
    }
    // Show final (white) + interim (grey)
    var el = document.getElementById('transcript-live');
    if (el) el.innerHTML =
      '<span style="color:#fff;">' + esc(_speechFinal) + '</span>' +
      '<span style="color:rgba(255,255,255,0.5);">' + esc(_speechInterim) + '</span>';
  };

  _speechRec.onerror = function(e) {
    var el = document.getElementById('speech-status');
    if (el) el.textContent = e.error === 'not-allowed' ? 'Mic permission denied.' : 'Error: ' + e.error;
  };

  _speechRec.onend = function() {
    // Auto-restart if still in speech mode and call active
    if (_transcriptMode === 'speech' && _call.active) {
      try { _speechRec.start(); } catch(e) {}
    }
  };

  try { _speechRec.start(); } catch(e) {}
}

function _stopSpeechRecognition() {
  if (_speechRec) {
    try { _speechRec.stop(); } catch(e) {}
    _speechRec = null;
  }
}

function _updateTranscriptLive(text) {
  var el = document.getElementById('transcript-live');
  if (el) el.textContent = text;
}

// ── ASL helpers ───────────────────────────────────────────────
function _aslClear() {
  _aslSentence=''; _aslMotionSeq=[];
  if (_transcriptMode === 'asl') _updateTranscriptLive('…');
}
function _aslSpace() {
  _aslSentence+=' ';
  if (_transcriptMode === 'asl') _updateTranscriptLive(_aslSentence);
}
var _aslMode = 'static';
function _aslToggleGesture() {
  _aslMode = _aslMode === 'static' ? 'motion' : 'static';
  _aslMotionSeq = []; _aslHoldCount = 0; _aslHoldLetter = '';
  var btn = document.getElementById('asl-mode-btn');
  if (btn) { btn.textContent = _aslMode === 'static' ? 'Static A-Z' : 'Motion Words'; btn.style.color = _aslMode === 'static' ? '#38bdf8' : '#9fe1cb'; }
}
function _aslUpdateText() {
  if (_transcriptMode === 'asl') _updateTranscriptLive(_aslSentence || '…');
}

async function _aslDetectFrame() {
  if (!_call.active || _call.type !== 'video') { _aslStopLoop(); return; }
  var video = document.getElementById('call-main-video');
  if (!video || !video.videoWidth) return;

  // Draw frame to offscreen canvas
  _aslCtx.drawImage(video, 0, 0, _aslCanvas.width, _aslCanvas.height);
  var b64 = _aslCanvas.toDataURL('image/jpeg', 0.7).split(',')[1];

  try {
    var token = sessionStorage.getItem('access_token') || '';
    var res = await fetch(API_BASE + '/asl/detect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ image_b64: b64, mode: _aslMode, motion_seq: _aslMode === 'motion' ? _aslMotionSeq : null })
    });
    if (!res.ok) return;
    var data = await res.json();

    // Accumulate motion sequence frames
    if (_aslMode === 'motion' && data.current_frame_features) {
      _aslMotionSeq.push(data.current_frame_features);
      if (_aslMotionSeq.length > ASL_MOTION_SEQLEN) _aslMotionSeq.shift();
    }

    var confThreshold = _aslMode === 'static' ? ASL_STATIC_CONF : ASL_MOTION_CONF;

    // Update letter display
    var letterEl = document.getElementById('asl-live-letter');
    var confEl   = document.getElementById('asl-live-conf');
    if (letterEl) letterEl.textContent = data.hand_detected && data.letter ? data.letter : '—';
    if (confEl)   confEl.textContent   = data.hand_detected && data.letter ? Math.round(data.confidence * 100) + '%' : '';

    // Hold-to-confirm logic
    if (data.hand_detected && data.letter && data.confidence >= confThreshold) {
      if (data.letter === _aslHoldLetter) {
        _aslHoldCount++;
        if (_aslHoldCount >= ASL_HOLD_FRAMES) {
          if (_aslMode === 'motion') {
            if (_aslSentence) _aslSentence += ' ';
            _aslSentence += data.letter;
            _aslMotionSeq = [];
          } else {
            _aslSentence += data.letter;
          }
          _aslUpdateText();
          // also update letter display
          var lEl = document.getElementById('asl-live-letter');
          if (lEl) lEl.textContent = data.letter;
          _aslHoldCount  = 0;
          _aslHoldLetter = '';
        }
      } else {
        _aslHoldLetter = data.letter;
        _aslHoldCount  = 1;
      }
    } else {
      _aslHoldCount  = 0;
      _aslHoldLetter = '';
    }

    // Draw landmarks on video canvas if returned
    if (data.landmarks && data.landmarks.length) {
      _aslDrawLandmarks(data.landmarks, video.videoWidth, video.videoHeight);
    }

  } catch (e) { /* silent fail — don't interrupt call */ }
}

function _aslDrawLandmarks(landmarks, vw, vh) {
  var canvas = document.getElementById('call-overlay');
  if (!canvas) return;
  // Find or create a small overlay canvas
  var c = document.getElementById('asl-lm-canvas');
  if (!c) {
    c = document.createElement('canvas');
    c.id = 'asl-lm-canvas';
    c.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:3;';
    canvas.appendChild(c);
  }
  c.width  = canvas.offsetWidth  || 640;
  c.height = canvas.offsetHeight || 480;
  var ctx = c.getContext('2d');
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.fillStyle = 'rgba(56,189,248,0.8)';
  ctx.strokeStyle = 'rgba(56,189,248,0.5)';
  ctx.lineWidth = 1.5;
  landmarks.forEach(function(lm) {
    var x = lm[0] * c.width;
    var y = lm[1] * c.height;
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fill();
  });
}

function _aslStopLoop() {
  if (_aslLoop) { clearInterval(_aslLoop); _aslLoop = null; }
  var box = document.getElementById('asl-subtitle-box');
  if (box) box.remove();
  var lmc = document.getElementById('asl-lm-canvas');
  if (lmc) lmc.remove();
}

// ── Layer 3: Display overlay ──────────────────────────────────
function startAudioCall() { if (currentId) _beginCall('audio'); }
function startVideoCall()  { if (currentId) _beginCall('video'); }

async function _beginCall(type) {
  if (_call.active) return;
  _call.active = true; _call.type = type; _call.muted = false; _call.videoOff = false; _call.seconds = 0;
  var stream = await _L1_capture(type); // Layer 1
  _L2_aiPipeline(stream);               // Layer 2
  _L3_showOverlay(type, stream);        // Layer 3 — renders overlay HTML
  _injectAslSubtitle(); // inject AFTER overlay rendered (both audio + video)
  _startTimer();
}

function _L3_showOverlay(type, stream) {
  var conv  = allConvs.find(function (c) { return c.id === currentId; });
  var name  = conv ? conv.name  : 'Unknown';
  var color = conv ? conv.color : '#2ec4b6';
  var av    = ini(name);
  var el    = document.getElementById('call-overlay');
  if (!el) return;
  el.style.display = 'flex';
  el.className = 'call-overlay call-overlay--' + type;

  if (type === 'video') {
    el.innerHTML =
      '<div class="call-video-bg">' +
        '<video id="call-main-video" autoplay muted playsinline></video>' +
        '<div class="call-video-grad"></div>' +
      '</div>' +
      '<div class="call-pip">' +
        '<video id="call-pip-video" autoplay muted playsinline></video>' +
      '</div>' +
      _callInfo(name) + _callBtns(type);
    if (stream) {
      setTimeout(function () {
        var a = document.getElementById('call-main-video');
        var b = document.getElementById('call-pip-video');
        if (a) a.srcObject = stream;
        if (b) b.srcObject = stream;
      }, 50);
    }
  } else {
    el.innerHTML =
      '<div class="call-audio-bg" style="background:radial-gradient(circle at 50% 40%,' + color + '33 0%,#0f172a 70%);">' +
        '<div class="call-pulse call-pulse--3" style="border-color:' + color + '18;"></div>' +
        '<div class="call-pulse call-pulse--2" style="border-color:' + color + '30;"></div>' +
        '<div class="call-pulse" style="border-color:' + color + '55;"></div>' +
        '<div class="call-av" style="background:' + color + '">' + av + '</div>' +
      '</div>' +
      _callInfo(name) + _callBtns(type);
  }
}

function _callInfo(name) {
  return '<div class="call-info">' +
    '<div class="call-name">' + esc(name) + '</div>' +
    '<div class="call-status" id="call-status">Connecting…</div>' +
    '<div class="call-timer" id="call-timer" style="display:none;">0:00</div>' +
  '</div>';
}

function _callBtns(type) {
  return '<div class="call-controls">' +
    '<button class="call-btn" id="btn-mute" onclick="callToggleMute()" title="Mute">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>' +
    '</button>' +
    (type === 'video' ?
      '<button class="call-btn" id="btn-cam" onclick="callToggleVideo()" title="Camera">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>' +
      '</button>' : '') +
    '<button class="call-btn" id="btn-spk" onclick="callToggleSpeaker()" title="Speaker">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>' +
    '</button>' +
    '<button class="call-btn call-btn--end" onclick="endCall()" title="End call">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="transform:rotate(135deg)"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.6 1.18h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.77a16 16 0 0 0 6 6l.93-.93a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7a2 2 0 0 1 1.72 2.03z"/></svg>' +
    '</button>' +
  '</div>';
}

function _startTimer() {
  setTimeout(function () {
    var s = document.getElementById('call-status');
    var t = document.getElementById('call-timer');
    if (s) s.style.display = 'none';
    if (t) t.style.display = 'block';
  }, 1500);
  _call.timer = setInterval(function () {
    _call.seconds++;
    var t = document.getElementById('call-timer');
    if (t) { var m = Math.floor(_call.seconds / 60), s = _call.seconds % 60; t.textContent = m + ':' + (s < 10 ? '0' : '') + s; }
  }, 1000);
}

function callToggleMute() {
  _call.muted = !_call.muted;
  if (_call.stream) _call.stream.getAudioTracks().forEach(function (t) { t.enabled = !_call.muted; });
  var b = document.getElementById('btn-mute');
  if (b) b.classList.toggle('call-btn--on', _call.muted);
}

function callToggleVideo() {
  _call.videoOff = !_call.videoOff;
  if (_call.stream) _call.stream.getVideoTracks().forEach(function (t) { t.enabled = !_call.videoOff; });
  var b = document.getElementById('btn-cam');
  if (b) b.classList.toggle('call-btn--on', _call.videoOff);
  var v = document.getElementById('call-main-video');
  if (v) v.style.opacity = _call.videoOff ? '0' : '1';
}

function callToggleSpeaker() {
  var b = document.getElementById('btn-spk');
  if (b) b.classList.toggle('call-btn--on');
}

function endCall() {
  if (_call.stream) { _call.stream.getTracks().forEach(function (t) { t.stop(); }); _call.stream = null; }
  clearInterval(_call.timer);
  _stopSpeechRecognition();  // ── stop speech recognition
  _aslStopLoop();            // ── stop ASL detection
  _call.active = false; _call.type = null; _call.seconds = 0;
  var el = document.getElementById('call-overlay');
  if (el) { el.style.display = 'none'; el.innerHTML = ''; }
}

// ── WebSocket real-time layer ──────────────────────────────────────────────
(function () {
  var proto = location.protocol === 'https:' ? 'wss' : 'ws';
  var ws;
  function connect() {
    var token = sessionStorage.getItem('access_token') || '';
    ws = new WebSocket(proto + '://' + location.host + '/ws?token=' + encodeURIComponent(token));
    ws.onopen  = function () {};
    ws.onclose = function () { setTimeout(connect, 3000); };
    ws.onerror = function () {};
    ws.onmessage = function (e) {
      var msg; try { msg = JSON.parse(e.data); } catch (err) { return; }
      if (msg.type === 'new_message') {
        var m = msg.message, convId = msg.conversation_id;
        if (m.sender_name === ME.name) return;
        if (!localMsgs[convId]) localMsgs[convId] = [];
        localMsgs[convId].push(m);
        var conv = allConvs.find(function (c) { return c.id === convId; });
        if (conv) { conv.last_message = m.content || ''; conv.last_message_at = fmtTime(m.created_at); if (convId !== currentId) conv.unread_count = (conv.unread_count || 0) + 1; }
        if (convId === currentId) renderMsgs(localMsgs[convId]);
        updateLabel(); renderConvList();
      }
      if (msg.type === 'presence') {
        var conv = allConvs.find(function (c) { return c.id === msg.conversation_id; });
        if (conv) { conv.online = msg.online; renderConvList(); }
      }
      if (msg.type === 'conversations_update') { if (!demo) loadConvs(); }
    };
  }
  connect();
})();