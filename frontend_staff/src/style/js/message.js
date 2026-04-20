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
var pinnedMsgs = {};      // { convId: [msgId, ...] }
var msgReadCounts = {};   // { msgId: readCount }
var msgDelivery = {};     // { msgId: 'sent'|'delivered'|'read' }
var reactedMsgs = {};     // { msgId: { emoji: count } }
var deletedMsgs = {};     // { msgId: true }
var editedMsgs = {};      // { msgId: newContent }
var replyingTo = null;    // { id, sender_name, content }
var typingTimer = null;
var _isTyping = false;
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
      var myId = _getMyUserId();
      var myUser = JSON.parse(sessionStorage.getItem('user') || '{}');
      var myRole = myUser.global_role === 'admin' ? 'admin' : 'user';
      var myName = myUser.full_name || '';

      allConvs = d.map(function (c) {
        var name = c.name;
        var participants = c.participants || [];

        // For team/direct conversations with exactly 2 participants,
        // show the OTHER person's name (like WhatsApp)
        if (c.category === 'team' && participants.length === 2) {
          var other = participants.find(function(p) {
            return !(String(p.user_id) === String(myId) && (p.participant_type || 'user') === myRole);
          });
          if (other && other.display_name) name = other.display_name;
        }

        return {
          id: c.id,
          name: name,
          original_name: c.name,
          category: c.category,
          last_message: c.last_message || '',
          last_message_at: c.last_message_at || '',
          unread_count: c.unread_count || 0,
          sub: catLabel(c.category),
          color: convClr(c.id, c.category),
          online: false,
          participants: participants
        };
      });
      demo = false;
    } else throw new Error();
  } catch (e) {
    allConvs = DEMO_CONVS.map(function (c) { return Object.assign({}, c); });
    demo = true;
  }

  // Auto-sync: create conversations for residents that don't have one yet
  // Run always — even if no conversations exist yet (demo=true means no convs, not no auth)
  var hasAuth = !!sessionStorage.getItem('access_token');
  if (hasAuth) {
    try {
      var rr = await fetch(API_BASE + '/residents/', { headers: authH() });
      if (rr.ok) {
        var residents = await rr.json();
        for (var ri = 0; ri < residents.length; ri++) {
          var res = residents[ri];
          var convName = 'Resident Care: ' + res.full_name;
          // Check if conv already exists in loaded list
          var exists = allConvs.find(function(c) { return c.name === convName && c.category === 'resident'; });
          if (!exists) {
            // Try to create conv in backend
            try {
              var cr = await fetch(API_BASE + '/messages/conversations', {
                method: 'POST', headers: authH(),
                body: JSON.stringify({ name: convName, category: 'resident' })
              });
              if (cr.ok) {
                var cd = await cr.json();
                allConvs.push({ id: cd.id, name: convName, category: 'resident',
                  last_message: cd.last_message || '', last_message_at: cd.last_message_at || '',
                  unread_count: 0, sub: res.room ? 'Room ' + res.room : 'Resident',
                  color: CAT_CLR.resident, online: false });
              }
            } catch(e) {}
          }
        }
      }
    } catch(e) {}
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
    return '<div class="conv-item' + (c.id === currentId ? ' active' : '') + '" onclick="openConv(this)" data-cid="' + c.id + '">' +
      '<div class="conv-av' + (isAlert ? ' alert-av' : '') + '" style="background:' + (isAlert ? '#ef4444' : c.color) + '">' + ini(c.name) + dot + '</div>' +
      '<div class="conv-body">' +
      '<div class="conv-name-row"><div class="conv-name' + (c.unread_count > 0 ? ' unread' : '') + '">' + esc(c.name) + '</div><div class="conv-time">' + (c.last_message_at || '') + '</div></div>' +
      '<div class="conv-preview-row"><div class="conv-preview">' + esc(c.last_message || '') + '</div>' + badge + '</div>' +
      '</div></div>';
  }).join('');
}

async function openConv(elOrId) {
  // Accept either a DOM element (from onclick) or a raw id
  var id;
  if (elOrId && elOrId.dataset) {
    var raw = elOrId.dataset.cid;
    id = isNaN(raw) ? raw : parseInt(raw, 10);
  } else {
    id = elOrId;
  }
  currentId = id;
  var conv = allConvs.find(function (c) { return c.id == id; }); // == for type-safe compare
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
    var r = await fetch(API_BASE + '/messages/conversations/' + id + '/messages', { headers: authH() });
    if (!r.ok) throw new Error();
    localMsgs[id] = await r.json();
  } catch (e) {
    // Use demo messages if available, otherwise empty array (new conversation)
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
  if (!msgs.length) {
    el.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text3);font-size:13px;">No messages yet. Say hello!</div>';
    _updateScrollBtn();
    return;
  }

  // Pinned messages banner
  var pinned = (pinnedMsgs[currentId] || []);
  var pinnedHtml = '';
  if (pinned.length) {
    var pm = msgs.find(function(m){ return m.id == pinned[pinned.length-1]; });
    if (pm) pinnedHtml = '<div class="pinned-bar" onclick="scrollToMsg(this.dataset.pmid)" data-pmid="' + pm.id + '">' +
      '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"/></svg>' +
      '<span>' + esc((pm.content || '').slice(0, 60)) + '</span>' +
      '<button onclick="event.stopPropagation();unpinMsg(this.dataset.pmid)" data-pmid="' + pm.id + '" style="background:none;border:none;cursor:pointer;color:var(--text3);font-size:16px;padding:0 4px;">×</button>' +
    '</div>';
  }

  var html = pinnedHtml + '<div class="date-div">Today</div>';

  msgs.forEach(function (m, i) {
    // Call summary bubble
    if (m.isCallSummary) {
      html += '<div style="text-align:center;margin:8px 0;">' +
        '<span style="display:inline-block;background:#f0fdfa;color:#0f766e;border:1px solid #99f6e4;border-radius:20px;padding:4px 14px;font-size:12px;font-weight:600;">' +
        esc(m.content) + '</span></div>';
      return;
    }
    if (deletedMsgs[m.id]) {
      html += '<div class="msg-row' + (m.is_self === true || m.is_self === 'true' ? ' self' : '') + '">' +
        '<div class="bubble-deleted">🚫 Message deleted</div></div>';
      return;
    }
    var isSelf = m.is_self === true || m.is_self === 'true';
    var clr = isSelf ? '#2ec4b6' : senderClr(m.sender_name);
    var t = fmtTime(m.created_at);
    var showName = !isSelf && (i === 0 || msgs[i - 1].sender_name !== m.sender_name || msgs[i - 1].is_self === true || msgs[i - 1].is_self === 'true');
    // Delivery ticks: grey single=sent, grey double=delivered, teal double=read
    var delivery = msgDelivery[m.id] || 'sent';
    var tickSvg;
    if (delivery === 'read') {
      tickSvg = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#2ec4b6" stroke-width="2.5" stroke-linecap="round"><polyline points="2 12 7 17 22 6"/><polyline points="9 17 14 12" opacity=".5"/></svg>';
    } else if (delivery === 'delivered') {
      tickSvg = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#94a3b8" stroke-width="2.5" stroke-linecap="round"><polyline points="2 12 7 17 22 6"/><polyline points="9 17 14 12" opacity=".5"/></svg>';
    } else {
      tickSvg = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#94a3b8" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>';
    }
    var tick = isSelf ? '<span class="tick" title="' + delivery + '">' + tickSvg + '</span>' : '';
    var content = editedMsgs[m.id] || m.content || '';
    var isEdited = !!editedMsgs[m.id];

    // Reply quote
    var replyHtml = '';
    if (m.replyTo) {
      replyHtml = '<div class="reply-quote"><span class="reply-name">' + esc(m.replyTo.sender_name) + '</span>' +
        '<span class="reply-text">' + esc((m.replyTo.content || '').slice(0, 80)) + '</span></div>';
    }

    var bubbleHtml;
    if (m.fileHtml) {
      bubbleHtml = m.fileHtml;
    } else if (content.startsWith('[file] ')) {
      var parts = content.slice(7).split(' | ');
      bubbleHtml = makeFileBubble(parts[0] || 'file', parts[1] || '');
    } else {
      var txt = esc(content);
      if (hl) txt = txt.replace(new RegExp(esc(hl).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), function (s) { return '<mark style="background:#fef08a;border-radius:3px;">' + s + '</mark>'; });
      bubbleHtml = replyHtml + (isSelf ? '<div class="bubble self">' + txt + (isEdited ? '<span class="edited-tag"> (edited)</span>' : '') + '</div>'
        : '<div class="bubble other">' + txt + (isEdited ? '<span class="edited-tag"> (edited)</span>' : '') + '</div>');
    }

    // Reactions
    var rxns = reactedMsgs[m.id] || {};
    var rxnHtml = '';
    if (Object.keys(rxns).length) {
      rxnHtml = '<div class="reactions">';
      Object.keys(rxns).forEach(function(em){ rxnHtml += '<span class="rxn" onclick="toggleReaction(&quot;' + m.id + '&quot;,&quot;' + em + '&quot;)">' + em + ' ' + rxns[em] + '</span>'; });
      rxnHtml += '</div>';
    }

    var mid = String(m.id);
    var actions = ''; // no hover buttons — use right-click context menu instead

    var rowAttrs = 'data-mid="' + mid + '" data-self="' + (isSelf?'1':'0') + '" oncontextmenu="showMsgCtx(event,this)"';
    if (isSelf) {
      html += '<div class="msg-row self" ' + rowAttrs + '>' +
        '<div class="msg-col">' + bubbleHtml + rxnHtml +
        '<div class="msg-meta" style="justify-content:flex-end"><div class="msg-time">' + t + '</div>' + tick + '</div>' +
        '</div></div>';
    } else {
      html += '<div class="msg-row" ' + rowAttrs + '>' +
        '<div class="msg-av" style="background:' + clr + '">' + ini(m.sender_name) + '</div>' +
        '<div class="msg-col">' +
        (showName ? '<div class="msg-sender">' + esc(m.sender_name) + ' · ' + esc(m.sender_role || '') + '</div>' : '') +
        bubbleHtml + rxnHtml +
        '<div class="msg-meta"><div class="msg-time">' + t + '</div></div>' +
        '</div></div>';
    }
  });

  // Typing indicator
  html += '<div id="typing-indicator" style="display:none;" class="msg-row">' +
    '<div class="typing-dots"><span></span><span></span><span></span></div></div>';

  el.innerHTML = html;
  scrollBottom();
  _updateScrollBtn();
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
function handleKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); return; }
  // Typing indicator (local only — shows to self for now)
  if (!_isTyping) { _isTyping = true; }
  clearTimeout(typingTimer);
  typingTimer = setTimeout(function(){ _isTyping = false; }, 2000);
}

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
    var msg = { id: Date.now(), conversation_id: currentId, sender_name: ME.name, sender_role: ME.role, content: content, is_self: true, created_at: now, replyTo: replyingTo ? Object.assign({}, replyingTo) : null };
    cancelReply();
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

function openNewModal() {
  var f = document.getElementById('new-account-id');
  if (f) f.value = '';
  var fn = document.getElementById('new-name');
  if (fn) fn.value = '';
  var err = document.getElementById('new-modal-error');
  if (err) { err.textContent=''; err.style.display='none'; }
  var err2 = document.getElementById('new-team-error');
  if (err2) { err2.textContent=''; err2.style.display='none'; }
  // Reset submit button label based on active tab
  var btn = document.getElementById('new-modal-submit');
  if (btn) btn.textContent = 'Create';
  switchNewTab('team');
  document.getElementById('modal-new').classList.add('open');
}

function switchNewTab(tab) {
  var tabs = ['team', 'resident', 'staff'];
  tabs.forEach(function(t) {
    var btn = document.getElementById('tab-' + t);
    var body = document.getElementById('new-tab-' + t);
    var active = t === tab;
    if (btn) {
      btn.style.borderBottomColor = active ? '#0f172a' : 'transparent';
      btn.style.color = active ? '#0f172a' : '#94a3b8';
      btn.style.fontWeight = active ? '700' : '500';
    }
    if (body) body.style.display = active ? 'block' : 'none';
  });
  var btn = document.getElementById('new-modal-submit');
  if (btn) btn.textContent = tab === 'resident' ? 'Send Invitation' : 'Create';

  // Load staff list when switching to staff tab
  if (tab === 'staff') {
    var sel = document.getElementById('new-staff-code');
    if (sel && sel.options.length <= 1) {
      fetch(API_BASE + '/staff/', { headers: authH() })
        .then(function(r){ return r.json(); })
        .then(function(list) {
          sel.innerHTML = '<option value="">— Select staff member —</option>';
          var myId = _getMyUserId();
          list.forEach(function(s) {
            if (!s.user_id || String(s.user_id) === String(myId)) return;
            var opt = document.createElement('option');
            opt.value = s.user_id + '|' + s.full_name + '|user';
            opt.textContent = s.full_name + (s.role ? ' · ' + s.role : '');
            sel.appendChild(opt);
          });
          if (sel.options.length <= 1) sel.innerHTML = '<option value="">No staff available</option>';
        })
        .catch(function(){ sel.innerHTML = '<option value="">Failed to load staff</option>'; });
    }
  }
}

function closeModal(id) { document.getElementById(id).classList.remove('open'); }

async function createConv() {
  var residentBody = document.getElementById('new-tab-resident');
  var staffBody = document.getElementById('new-tab-staff');
  var isResidentTab = residentBody && residentBody.style.display !== 'none';
  var isStaffTab = staffBody && staffBody.style.display !== 'none';

  if (isResidentTab) {
    await _createResidentConv();
  } else if (isStaffTab) {
    await _createStaffConv();
  } else {
    await _createTeamConv();
  }
}

async function _createStaffConv() {
  var sel = document.getElementById('new-staff-code');
  var staffValue = sel ? sel.value : '';
  var errEl = document.getElementById('new-staff-error');

  if (!staffValue) {
    if (errEl) { errEl.textContent = 'Please select a staff member.'; errEl.style.display='block'; }
    return;
  }

  var btn = document.getElementById('new-modal-submit');
  if (btn) { btn.textContent = 'Creating…'; btn.disabled = true; }

  try {
    var parts = staffValue.split('|');
    var staffUserId = parseInt(parts[0], 10);
    var staffName = parts[1] || 'Staff';
    var staffParticipantType = parts[2] || 'user';

    var myUser = JSON.parse(sessionStorage.getItem('user') || '{}');
    var myId = _getMyUserId();
    var myRole = myUser.global_role || 'admin';
    var myType = myRole === 'admin' ? 'admin' : 'user';
    var myName = myUser.full_name || 'Me';

    var convName = staffName;
    var r = await fetch(API_BASE + '/messages/conversations', {
      method: 'POST', headers: authH(),
      body: JSON.stringify({
        name: convName,
        category: 'team',
        participants: [
          { user_id: myId, participant_type: myType, display_name: myName, role: myRole },
          { user_id: staffUserId, participant_type: staffParticipantType, display_name: staffName, role: 'staff' }
        ]
      })
    });
    if (!r.ok) {
      if (errEl) { errEl.textContent = 'Failed to create conversation.'; errEl.style.display='block'; }
      if (btn) { btn.textContent = 'Create'; btn.disabled = false; }
      return;
    }
    var cd = await r.json();
    var c = { id: cd.id, name: cd.name || convName, category: 'team',
      last_message: '', last_message_at: 'Just now',
      unread_count: 0, sub: 'Staff',
      color: convClr(cd.id, 'team'), online: false,
      participants: cd.participants || [],
      callee_user_id: staffUserId };
    allConvs.unshift(c);
    localMsgs[cd.id] = [];
    filterConvs();
    closeModal('modal-new');
    openConv(cd.id);
  } catch(e) {
    if (errEl) { errEl.textContent = 'Network error. Please try again.'; errEl.style.display='block'; }
    if (btn) { btn.textContent = 'Create'; btn.disabled = false; }
  }
}

async function _createTeamConv() {
  var nameInput = document.getElementById('new-name');
  var catSelect = document.getElementById('new-cat');
  var name = (nameInput ? nameInput.value : '').trim();
  var category = catSelect ? catSelect.value : 'team';
  var errEl = document.getElementById('new-team-error');

  if (!name) {
    if (errEl) { errEl.textContent = 'Please enter a conversation name.'; errEl.style.display='block'; }
    return;
  }

  var btn = document.getElementById('new-modal-submit');
  if (btn) { btn.textContent = 'Creating…'; btn.disabled = true; }

  try {
    var r = await fetch(API_BASE + '/messages/conversations', {
      method: 'POST', headers: authH(),
      body: JSON.stringify({ name: name, category: category })
    });
    if (!r.ok) {
      var d = await r.json().catch(function(){ return {}; });
      if (errEl) { errEl.textContent = (d.detail && d.detail.msg) || d.detail || 'Failed to create conversation.'; errEl.style.display='block'; }
      if (btn) { btn.textContent = 'Create'; btn.disabled = false; }
      return;
    }
    var cd = await r.json();
    var c = { id: cd.id, name: cd.name || name, category: cd.category || category,
      last_message: '', last_message_at: 'Just now',
      unread_count: 0, sub: catLabel(category),
      color: convClr(cd.id, category), online: false, participants: cd.participants || [] };
    allConvs.unshift(c);
    localMsgs[cd.id] = [];
    filterConvs();
    closeModal('modal-new');
    openConv(cd.id);
  } catch(e) {
    if (errEl) { errEl.textContent = 'Network error. Please try again.'; errEl.style.display='block'; }
    if (btn) { btn.textContent = 'Create'; btn.disabled = false; }
  }
}

async function _createResidentConv() {
  var accountId = (document.getElementById('new-account-id') || {}).value;
  accountId = (accountId || '').trim().toUpperCase();
  var errEl = document.getElementById('new-modal-error');
  if (!accountId) {
    if (errEl) { errEl.textContent = 'Please enter a Client Account ID.'; errEl.style.display='block'; }
    return;
  }
  var btn = document.getElementById('new-modal-submit');
  if (btn) { btn.textContent = 'Sending…'; btn.disabled = true; }
  try {
    var invRes = await fetch(API_BASE + '/center-membership/admin/invite', {
      method: 'POST', headers: authH(),
      body: JSON.stringify({ account_id: accountId })
    });
    var invData = await invRes.json();

    if (!invRes.ok) {
      var errMsg = 'Invalid Account ID.';
      if (invData) {
        if (typeof invData.detail === 'string') errMsg = invData.detail;
        else if (invData.detail && invData.detail.msg) errMsg = invData.detail.msg;
        else if (invData.msg) errMsg = invData.msg;
      }
      if (errEl) { errEl.textContent = errMsg; errEl.style.display='block'; }
      if (btn) { btn.textContent = 'Send Invitation'; btn.disabled = false; }
      return;
    }

    var clientName = invData.user_full_name || accountId;
    var newId = Date.now();
    var convName = 'Resident Care: ' + clientName;
    try {
      var convRes = await fetch(API_BASE + '/messages/conversations', {
        method: 'POST', headers: authH(),
        body: JSON.stringify({ name: convName, category: 'resident' })
      });
      if (convRes.ok) { var cd2 = await convRes.json(); newId = cd2.id; }
    } catch(e) {}

    var c = { id: newId, name: convName, category: 'resident',
      last_message: 'Invitation sent', last_message_at: 'Just now',
      unread_count: 0, sub: 'Resident Care',
      color: CAT_CLR.resident, online: false, participants: [] };
    allConvs.unshift(c);
    localMsgs[newId] = [];
    filterConvs();
    closeModal('modal-new');
    openConv(newId);
  } catch(e) {
    if (errEl) { errEl.textContent = 'Network error. Please try again.'; errEl.style.display='block'; }
    if (btn) { btn.textContent = 'Send Invitation'; btn.disabled = false; }
  }
}

document.addEventListener('DOMContentLoaded', function () {
  var area = document.getElementById('chat-messages');
  if (!area) return;

  // Drag-drop
  area.addEventListener('dragover', function (e) { e.preventDefault(); area.classList.add('drag-over'); });
  area.addEventListener('dragleave', function () { area.classList.remove('drag-over'); });
  area.addEventListener('drop', function (e) { e.preventDefault(); area.classList.remove('drag-over'); if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files); });

  // Scroll-to-bottom button listener
  area.addEventListener('scroll', _updateScrollBtn);

  // Right-click handled by oncontextmenu on each .msg-row
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
var _activeCallId    = null;
var _outgoingCallId  = null;
var _pendingCallKind = null;
var _callerJoinPayload = null;

function _getMyUserId() {
  try {
    var u = JSON.parse(sessionStorage.getItem('user') || '{}');
    return u.id || u.user_id || u.admin_id || null;
  } catch(e) { return null; }
}

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
function startAudioCall() { if (currentId) _initiateCall('audio'); }
function startVideoCall()  { if (currentId) _initiateCall('video'); }

async function _initiateCall(type) {
  if (_call.active || _outgoingCallId) return;
  _pendingCallKind = type;

  // Resolve callee_user_id
  var calleeUserId = null;
  var conv = allConvs.find(function(c){ return c.id === currentId; });

  try {
    // Resident Care conversation — look up resident.client_user_id
    if (conv && conv.name && conv.name.startsWith('Resident Care: ')) {
      var residentName = conv.name.replace('Resident Care: ', '').trim();
      var rr = await fetch(API_BASE + '/residents/', { headers: authH() });
      if (rr.ok) {
        var residents = await rr.json();
        var match = residents.find(function(r) {
          return (r.full_name || '') === residentName;
        });
        if (match && match.client_user_id) {
          calleeUserId = match.client_user_id;
        } else if (match && !match.client_user_id) {
          showToast('This resident has not linked a mobile account yet');
          _pendingCallKind = null;
          return;
        }
      }
    }

    // Team/direct conversation — use participants already loaded in allConvs
    if (!calleeUserId && conv && conv.participants && conv.participants.length) {
      var myId = _getMyUserId();
      var myRole = (JSON.parse(sessionStorage.getItem('user') || '{}').global_role === 'admin') ? 'admin' : 'user';
      var other = conv.participants.find(function(p) {
        return !(String(p.user_id) === String(myId) && (p.participant_type || 'user') === myRole);
      });
      if (other) calleeUserId = other.user_id;
    }

    // Fallback: staff conv created with explicit callee_user_id
    if (!calleeUserId && conv && conv.callee_user_id) {
      calleeUserId = conv.callee_user_id;
    }
  } catch(e) {}

  if (!calleeUserId) {
    showToast('Cannot start call: recipient not found');
    _pendingCallKind = null;
    return;
  }

  _showCallingOverlay(type, conv ? conv.name : '');

  try {
    var r = await fetch(API_BASE + '/calls', {
      method: 'POST', headers: authH(),
      body: JSON.stringify({ callee_user_id: calleeUserId, kind: type })
    });
    if (!r.ok) {
      var err = await r.json().catch(function(){ return {}; });
      _dismissCallingOverlay();
      showToast(err.detail || 'Failed to start call');
      _pendingCallKind = null;
      return;
    }
    var data = await r.json();
    _outgoingCallId = data.call_id;
    _callerJoinPayload = data.join_payload || null;
  } catch(e) {
    _dismissCallingOverlay();
    showToast('Network error starting call');
    _pendingCallKind = null;
  }
}

function _showCallingOverlay(type, name) {
  var existing = document.getElementById('calling-overlay');
  if (existing) existing.remove();
  var ov = document.createElement('div');
  ov.id = 'calling-overlay';
  ov.style.cssText = 'position:fixed;inset:0;z-index:999998;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.65);';
  ov.innerHTML =
    '<div style="background:#1e2025;border-radius:20px;padding:36px 32px;min-width:300px;text-align:center;color:#fff;">' +
      '<div style="font-size:52px;margin-bottom:14px;animation:pulse 1s infinite;">' + (type === 'video' ? '📹' : '📞') + '</div>' +
      '<div style="font-size:18px;font-weight:800;margin-bottom:4px;">Calling…</div>' +
      '<div style="font-size:13px;color:rgba(255,255,255,0.55);margin-bottom:28px;">' + esc(name || '') + '</div>' +
      '<button onclick="_cancelOutgoingCall()" style="width:56px;height:56px;border-radius:50%;background:#ef4444;border:none;cursor:pointer;font-size:24px;" title="Cancel">📵</button>' +
    '</div>';
  document.body.appendChild(ov);
}

function _dismissCallingOverlay() {
  var el = document.getElementById('calling-overlay');
  if (el) el.remove();
}

async function _cancelOutgoingCall() {
  var cid = _outgoingCallId;
  _outgoingCallId = null;
  _pendingCallKind = null;
  _dismissCallingOverlay();
  if (!cid) return;
  try {
    await fetch(API_BASE + '/calls/' + cid + '/cancel', { method: 'POST', headers: authH() });
  } catch(e) {}
}

async function _beginCall(type) {
  if (_call.active) return;
  _call.active = true; _call.type = type; _call.muted = false; _call.videoOff = false; _call.seconds = 0;
  var stream = await _L1_capture(type);
  _L2_aiPipeline(stream);
  _L3_showOverlay(type, stream);
  _injectAslSubtitle();
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

async function endCall() {
  var cid = _activeCallId;
  var duration = _call.seconds;
  var convId = currentId;
  _activeCallId = null;
  if (cid) {
    try { await fetch(API_BASE + '/calls/' + cid + '/end', { method: 'POST', headers: authH() }); } catch(e) {}
  }
  _teardownCallMedia();
  _showCallSummary(duration, convId);
}

// ════════════════════════════════════════════════════
// FEATURE FUNCTIONS
// ════════════════════════════════════════════════════

// ── Recall / Delete message ──
async function recallMsg(msgId) {
  if (!confirm('Delete this message?')) return;
  // Optimistic UI
  deletedMsgs[msgId] = true;
  renderMsgs(localMsgs[currentId] || []);
  // Real API
  try {
    await fetch(API_BASE + '/messages/conversations/' + currentId + '/messages/' + msgId, {
      method: 'DELETE', headers: authH()
    });
    // Remove from local cache
    if (localMsgs[currentId]) {
      localMsgs[currentId] = localMsgs[currentId].filter(function(m){ return m.id != msgId; });
    }
  } catch(e) {}
}

// ── Edit message ──
async function editMsg(msgId) {
  var msgs = localMsgs[currentId] || [];
  var m = msgs.find(function(x){ return x.id == msgId; });
  if (!m) return;
  var newText = prompt('Edit message:', editedMsgs[msgId] || m.content || '');
  if (newText === null || newText.trim() === '') return;
  newText = newText.trim();
  // Optimistic UI
  editedMsgs[msgId] = newText;
  renderMsgs(msgs);
  // Real API
  try {
    await fetch(API_BASE + '/messages/conversations/' + currentId + '/messages/' + msgId, {
      method: 'PATCH', headers: authH(),
      body: JSON.stringify({ content: newText })
    });
  } catch(e) {}
}

// ── Reply to message ──
function replyToMsg(msgId, senderName, content) {
  replyingTo = { id: msgId, sender_name: senderName, content: content };
  var bar = document.getElementById('reply-bar');
  if (bar) {
    bar.style.display = 'flex';
    document.getElementById('reply-bar-name').textContent = senderName;
    document.getElementById('reply-bar-text').textContent = content.slice(0, 80);
  }
  document.getElementById('msg-input').focus();
}

function cancelReply() {
  replyingTo = null;
  var bar = document.getElementById('reply-bar');
  if (bar) bar.style.display = 'none';
}

// ── Pin / Unpin message ──
function pinMsg(msgId) {
  if (!pinnedMsgs[currentId]) pinnedMsgs[currentId] = [];
  var idx = pinnedMsgs[currentId].indexOf(msgId);
  if (idx === -1) pinnedMsgs[currentId].push(msgId);
  renderMsgs(localMsgs[currentId] || []);
}
function unpinMsg(msgId) {
  if (!pinnedMsgs[currentId]) return;
  pinnedMsgs[currentId] = pinnedMsgs[currentId].filter(function(x){ return x != msgId; });
  renderMsgs(localMsgs[currentId] || []);
}

// ── Scroll to message ──
function scrollToMsg(msgId) {
  var el = document.querySelector('[data-mid="' + msgId + '"]');
  if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.classList.add('msg-highlight'); setTimeout(function(){ el.classList.remove('msg-highlight'); }, 1500); }
}

// ── Copy message ──
function copyMsg(text) {
  navigator.clipboard.writeText(text).then(function(){ showToast('Copied!'); }).catch(function(){ showToast('Copy failed'); });
}

// ── Right-click context menu ──────────────────────────
var REACTION_EMOJIS = ['👍','❤️','😂','😮','😢','🙏','✅','🚨'];
var _ctxMsgId = null;
var _ctxIsSelf = false;

function showMsgCtx(e, rowEl) {
  e.preventDefault();
  e.stopPropagation();
  _closeMsgCtx();

  _ctxMsgId  = rowEl.dataset.mid;
  _ctxIsSelf = rowEl.dataset.self === '1';
  var msgs = localMsgs[currentId] || [];
  var m    = msgs.find(function(x){ return String(x.id) === String(_ctxMsgId); });
  var txt  = m ? (editedMsgs[_ctxMsgId] || m.content || '') : '';

  var menu = document.createElement('div');
  menu.id = 'msg-ctx-menu';
  menu.style.cssText = 'position:fixed;z-index:99999;background:#111214;border-radius:6px;padding:4px;min-width:188px;box-shadow:0 8px 24px rgba(0,0,0,0.5);font-family:Inter,sans-serif;user-select:none;';

  // Quick reactions row
  var rxnRow = document.createElement('div');
  rxnRow.style.cssText = 'display:flex;align-items:center;gap:1px;padding:4px 6px 8px;border-bottom:1px solid rgba(255,255,255,0.06);margin-bottom:4px;';
  REACTION_EMOJIS.slice(0,6).forEach(function(em) {
    var rb = document.createElement('button');
    rb.textContent = em;
    rb.title = em;
    rb.style.cssText = 'background:none;border:none;cursor:pointer;font-size:20px;padding:4px 6px;border-radius:5px;line-height:1;transition:background .1s;';
    rb.onmouseover = function(){ this.style.background='rgba(255,255,255,0.08)'; this.style.transform='scale(1.25)'; };
    rb.onmouseout  = function(){ this.style.background='none'; this.style.transform='scale(1)'; };
    rb.onclick = function(ev){ ev.stopPropagation(); toggleReaction(_ctxMsgId, em); _closeMsgCtx(); };
    rxnRow.appendChild(rb);
  });
  // More reactions button
  var moreBtn = document.createElement('button');
  moreBtn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>';
  moreBtn.style.cssText = 'background:none;border:none;cursor:pointer;color:rgba(255,255,255,0.4);padding:4px 6px;border-radius:5px;display:flex;align-items:center;transition:background .1s;margin-left:auto;';
  moreBtn.onmouseover = function(){ this.style.background='rgba(255,255,255,0.08)'; this.style.color='rgba(255,255,255,0.8)'; };
  moreBtn.onmouseout  = function(){ this.style.background='none'; this.style.color='rgba(255,255,255,0.4)'; };
  rxnRow.appendChild(moreBtn);
  menu.appendChild(rxnRow);

  // Menu items — matches screenshot structure
  var items = [
    { label: 'Add reaction',    icon: '😊', action: function(){ } },
    null, // divider
    { label: 'Reply',           icon: 'reply',  action: function(){ if(m) replyToMsg(_ctxMsgId, m.sender_name, txt); } },
    { label: 'Pin message',     icon: 'pin',    action: function(){ pinMsg(_ctxMsgId); } },
    { label: 'Copy text',       icon: 'copy',   action: function(){ copyMsg(txt); } },
    { label: 'Mark as unread',  icon: 'unread', action: function(){ markCurrentUnread(); } },
  ];
  if (_ctxIsSelf) {
    items.push({ label: 'Edit message',   icon: 'edit',   action: function(){ editMsg(_ctxMsgId); } });
    items.push(null);
    items.push({ label: 'Delete message', icon: 'delete', action: function(){ recallMsg(_ctxMsgId); }, danger: true });
  }

  var ICONS = {
    reply:  '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/></svg>',
    pin:    '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"/></svg>',
    copy:   '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
    unread: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>',
    edit:   '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
    delete: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>',
  };

  items.forEach(function(item) {
    if (!item) {
      // divider
      var div = document.createElement('div');
      div.style.cssText = 'height:1px;background:rgba(255,255,255,0.06);margin:4px 0;';
      menu.appendChild(div);
      return;
    }
    if (item.label === 'Add reaction') return; // skip — handled by rxnRow

    var btn = document.createElement('button');
    var iconHtml = ICONS[item.icon] || '';
    btn.innerHTML = '<span style="width:18px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">' + iconHtml + '</span><span>' + item.label + '</span>';
    btn.style.cssText = [
      'display:flex;align-items:center;gap:9px;width:100%;',
      'background:none;border:none;cursor:pointer;',
      'padding:7px 8px;border-radius:4px;',
      'font-size:13px;font-weight:400;text-align:left;',
      'color:' + (item.danger ? '#f87171' : 'rgba(220,221,222,0.9)') + ';',
      'transition:background .08s;',
    ].join('');
    btn.onmouseover = function(){ this.style.background = item.danger ? 'rgba(218,55,60,0.25)' : 'rgba(79,84,92,0.5)'; };
    btn.onmouseout  = function(){ this.style.background = 'none'; };
    btn.onclick = function(ev){ ev.stopPropagation(); item.action(); _closeMsgCtx(); };
    menu.appendChild(btn);
  });

  // Position near cursor
  document.body.appendChild(menu);
  var x = e.clientX, y = e.clientY;
  var mw = menu.offsetWidth, mh = menu.offsetHeight;
  if (x + mw > window.innerWidth  - 8) x = x - mw;
  if (y + mh > window.innerHeight - 8) y = y - mh;
  menu.style.left = x + 'px';
  menu.style.top  = y + 'px';

  setTimeout(function() {
    document.addEventListener('click', _closeMsgCtx, { once: true });
    document.addEventListener('contextmenu', _closeMsgCtx, { once: true });
  }, 10);
}

function _closeMsgCtx() {
  var m = document.getElementById('msg-ctx-menu');
  if (m) m.remove();
}

function showReactionPicker(msgId, e) {
  e.stopPropagation();
  var old = document.getElementById('rxn-picker');
  if (old) old.remove();
  var picker = document.createElement('div');
  picker.id = 'rxn-picker';
  picker.style.cssText = 'position:fixed;z-index:9999;background:#fff;border:1.5px solid var(--border);border-radius:12px;padding:8px;display:flex;gap:4px;box-shadow:0 4px 20px rgba(0,0,0,0.15);';
  REACTION_EMOJIS.forEach(function(em) {
    var btn = document.createElement('button');
    btn.textContent = em;
    btn.style.cssText = 'background:none;border:none;cursor:pointer;font-size:20px;padding:4px 6px;border-radius:8px;';
    btn.addEventListener('mouseover', function(){ this.style.background='#f0fdfa'; });
    btn.addEventListener('mouseout',  function(){ this.style.background='none'; });
    btn.addEventListener('click', function(ev) {
      ev.stopPropagation();
      toggleReaction(msgId, em);
      var p = document.getElementById('rxn-picker');
      if (p) p.remove();
    });
    picker.appendChild(btn);
  });
  var rect = e.target.getBoundingClientRect();
  picker.style.top  = (rect.top - 60) + 'px';
  picker.style.left = Math.max(8, rect.left - 80) + 'px';
  document.body.appendChild(picker);
  setTimeout(function(){ document.addEventListener('click', function rm(){ picker.remove(); document.removeEventListener('click', rm); }); }, 10);
}

function toggleReaction(msgId, emoji) {
  if (!reactedMsgs[msgId]) reactedMsgs[msgId] = {};
  if (reactedMsgs[msgId][emoji]) {
    reactedMsgs[msgId][emoji]--;
    if (reactedMsgs[msgId][emoji] <= 0) delete reactedMsgs[msgId][emoji];
  } else {
    reactedMsgs[msgId][emoji] = (reactedMsgs[msgId][emoji] || 0) + 1;
  }
  renderMsgs(localMsgs[currentId] || []);
}

// ── Typing indicator ──
function _showTyping() {
  var el = document.getElementById('typing-indicator');
  if (el) el.style.display = 'flex';
  scrollBottom();
}
function _hideTyping() {
  var el = document.getElementById('typing-indicator');
  if (el) el.style.display = 'none';
}

// ── Scroll to bottom button ──
function _updateScrollBtn() {
  var msgs = document.getElementById('chat-messages');
  var btn  = document.getElementById('scroll-bottom-btn');
  if (!msgs || !btn) return;
  var atBottom = msgs.scrollHeight - msgs.scrollTop - msgs.clientHeight < 80;
  btn.style.display = atBottom ? 'none' : 'flex';
}

// ── Toast notification ──
function showToast(msg) {
  var t = document.createElement('div');
  t.style.cssText = 'position:fixed;bottom:90px;left:50%;transform:translateX(-50%);background:#0f172a;color:#fff;padding:8px 18px;border-radius:20px;font-size:13px;z-index:99999;pointer-events:none;';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(function(){ t.remove(); }, 2000);
}

// ── Call duration display ──
function _fmtCallDuration(sec) {
  var m = Math.floor(sec / 60), s = sec % 60;
  return m + ':' + (s < 10 ? '0' : '') + s;
}

// ── Mute / unmute conversation ──────────────────────
var _mutedConvs = {};

async function toggleMuteConv() {
  if (!currentId) return;
  var isMuted = _mutedConvs[currentId];
  try {
    await fetch(API_BASE + '/messages/conversations/' + currentId + '/mute', {
      method: 'PATCH', headers: authH(),
      body: JSON.stringify({ muted: !isMuted })
    });
    _mutedConvs[currentId] = !isMuted;
    showToast(isMuted ? 'Notifications unmuted' : 'Conversation muted');
    _updateConvCtxBtn();
  } catch(e) { showToast('Failed to update mute setting'); }
}

function _updateConvCtxBtn() {
  var btn = document.getElementById('mute-conv-btn');
  if (btn) btn.textContent = _mutedConvs[currentId] ? '🔔 Unmute' : '🔕 Mute';
}

// ── Export conversation ──────────────────────────────
async function exportConv() {
  if (!currentId) return;
  try {
    var r = await fetch(API_BASE + '/messages/conversations/' + currentId + '/export', { headers: authH() });
    if (!r.ok) throw new Error();
    var text = await r.text();
    var blob = new Blob([text], { type: 'text/plain' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    var conv = allConvs.find(function(c){ return c.id == currentId; });
    a.download = (conv ? conv.name : 'conversation') + '.txt';
    a.click();
    URL.revokeObjectURL(a.href);
  } catch(e) { showToast('Export failed'); }
}

// ── Read receipts ─────────────────────────────────────
async function showReadReceipts() {
  if (!currentId) return;
  try {
    var r = await fetch(API_BASE + '/messages/conversations/' + currentId + '/read-receipts', { headers: authH() });
    if (!r.ok) throw new Error();
    var data = await r.json();
    var lines = data.map(function(p){
      var t = p.last_read_at ? new Date(p.last_read_at).toLocaleString('en-AU') : 'Not seen';
      return p.display_name + ' — ' + t;
    });
    showToast('Seen by ' + data.length + ' participants — check console');
    console.log('Read receipts:', lines);
  } catch(e) { showToast('Failed to load read receipts'); }
}

// ── Block user ────────────────────────────────────────
async function blockUser(userId) {
  if (!confirm('Block this user? Their messages will be hidden.')) return;
  try {
    await fetch(API_BASE + '/messages/block', {
      method: 'POST', headers: authH(),
      body: JSON.stringify({ user_id: userId })
    });
    showToast('User blocked');
  } catch(e) { showToast('Failed to block user'); }
}

// ── Group management UI ──────────────────────────────────────
function _closeModal(id) { var el = document.getElementById(id); if (el) el.remove(); }

async function showMembersModal() {
  if (!currentId) return;
  var participants = [];
  try {
    var r = await fetch(API_BASE + '/messages/conversations/' + currentId + '/participants', { headers: authH() });
    if (r.ok) participants = await r.json();
  } catch(e) {}

  _closeModal('members-modal-overlay');
  var overlay = document.createElement('div');
  overlay.id = 'members-modal-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:9999;display:flex;align-items:center;justify-content:center;';
  overlay.onclick = function(e){ if(e.target===overlay) overlay.remove(); };

  var modal = document.createElement('div');
  modal.style.cssText = 'background:#fff;border-radius:16px;padding:24px;min-width:360px;max-width:480px;width:92%;max-height:80vh;display:flex;flex-direction:column;gap:14px;';

  // Header
  var hdr = document.createElement('div');
  hdr.style.cssText = 'display:flex;justify-content:space-between;align-items:center;';
  var h3 = document.createElement('h3'); h3.style.cssText = 'font-size:15px;font-weight:800;margin:0;'; h3.textContent = 'Members (' + participants.length + ')';
  var xBtn = document.createElement('button'); xBtn.textContent = '×'; xBtn.style.cssText = 'background:none;border:none;cursor:pointer;font-size:22px;color:#94a3b8;line-height:1;'; xBtn.onclick = function(){ overlay.remove(); };
  hdr.appendChild(h3); hdr.appendChild(xBtn); modal.appendChild(hdr);

  // Add member input
  var addWrap = document.createElement('div');
  var addRow = document.createElement('div'); addRow.style.cssText = 'display:flex;gap:8px;';
  var addInput = document.createElement('input');
  addInput.placeholder = 'Account ID (e.g. ACC-47291038)';
  addInput.style.cssText = 'flex:1;padding:8px 12px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:13px;text-transform:uppercase;font-weight:600;letter-spacing:.5px;outline:none;';
  var addBtn = document.createElement('button');
  addBtn.textContent = 'Add';
  addBtn.style.cssText = 'padding:8px 16px;background:#0f172a;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:13px;font-weight:600;';
  var addErr = document.createElement('div'); addErr.style.cssText = 'font-size:11px;color:#ef4444;margin-top:4px;display:none;';

  addBtn.onclick = async function() {
    var accountId = addInput.value.trim().toUpperCase();
    if (!accountId) return;
    addBtn.textContent = '...'; addBtn.disabled = true; addErr.style.display = 'none';
    try {
      var invRes = await fetch(API_BASE.replace('/messages','') + '/center-membership/admin/invite', {
        method: 'POST', headers: authH(), body: JSON.stringify({ account_id: accountId })
      });
      var invData = await invRes.json();
      if (!invRes.ok) {
        addErr.textContent = (typeof invData.detail === 'string' ? invData.detail : (invData.detail && invData.detail.msg) || 'Invalid Account ID');
        addErr.style.display = 'block'; addBtn.textContent = 'Add'; addBtn.disabled = false; return;
      }
      var addRes = await fetch(API_BASE + '/messages/conversations/' + currentId + '/participants', {
        method: 'POST', headers: authH(),
        body: JSON.stringify({ user_id: invData.user_id || 0, participant_type: 'client', display_name: invData.user_full_name || accountId, role: 'member' })
      });
      if (!addRes.ok) {
        var ad = await addRes.json();
        addErr.textContent = ad.detail || 'Failed to add'; addErr.style.display = 'block';
        addBtn.textContent = 'Add'; addBtn.disabled = false; return;
      }
      showToast((invData.user_full_name || accountId) + ' added');
      overlay.remove(); showMembersModal();
    } catch(e) { addErr.textContent = 'Network error'; addErr.style.display = 'block'; addBtn.textContent = 'Add'; addBtn.disabled = false; }
  };

  addRow.appendChild(addInput); addRow.appendChild(addBtn);
  addWrap.appendChild(addRow); addWrap.appendChild(addErr);
  modal.appendChild(addWrap);

  // Divider
  var divEl = document.createElement('div'); divEl.style.cssText = 'height:1px;background:#f1f5f9;';
  modal.appendChild(divEl);

  // Members list
  var list = document.createElement('div'); list.style.cssText = 'overflow-y:auto;display:flex;flex-direction:column;gap:2px;';
  var colors = ['#2ec4b6','#7c3aed','#ef4444','#f59e0b','#3b82f6','#10b981'];

  if (!participants.length) {
    var empty = document.createElement('div'); empty.style.cssText = 'text-align:center;padding:24px;color:#94a3b8;font-size:13px;'; empty.textContent = 'No members yet';
    list.appendChild(empty);
  } else {
    participants.forEach(function(p) {
      var av = (p.display_name||'?').split(' ').map(function(w){return w[0]||'';}).join('').toUpperCase().slice(0,2);
      var clr = colors[Math.abs(p.user_id||0) % colors.length];
      var row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:12px;padding:10px 8px;border-radius:10px;';
      row.onmouseover = function(){ this.style.background='#f8fafc'; };
      row.onmouseout  = function(){ this.style.background=''; };

      var avEl = document.createElement('div');
      avEl.style.cssText = 'width:38px;height:38px;border-radius:50%;background:' + clr + ';display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;color:#fff;flex-shrink:0;';
      avEl.textContent = av;

      var info = document.createElement('div'); info.style.cssText = 'flex:1;min-width:0;';
      info.innerHTML = '<div style="font-size:13px;font-weight:600;">' + esc(p.display_name) + '</div><div style="font-size:11px;color:#94a3b8;">' + (p.role||'member') + ' · ' + p.participant_type + '</div>';

      var rmBtn = document.createElement('button');
      rmBtn.textContent = 'Remove';
      rmBtn.style.cssText = 'padding:5px 10px;border:1.5px solid #fee2e2;background:#fff;color:#ef4444;border-radius:6px;cursor:pointer;font-size:11px;font-weight:600;flex-shrink:0;';
      rmBtn.onmouseover = function(){ this.style.background='#fee2e2'; };
      rmBtn.onmouseout  = function(){ this.style.background='#fff'; };
      rmBtn.onclick = async function() {
        if (!confirm('Remove ' + p.display_name + '?')) return;
        try {
          var res = await fetch(API_BASE + '/messages/conversations/' + currentId + '/participants/' + p.id, { method: 'DELETE', headers: authH() });
          if (res.ok || res.status === 204) { showToast(p.display_name + ' removed'); overlay.remove(); showMembersModal(); }
          else showToast('Failed to remove');
        } catch(e) { showToast('Network error'); }
      };

      row.appendChild(avEl); row.appendChild(info); row.appendChild(rmBtn);
      list.appendChild(row);
    });
  }

  modal.appendChild(list);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
}

// ── Incoming call UI ─────────────────────────────────────────────────────
var _incomingCallId = null;

function _showIncomingCall(msg) {
  _incomingCallId = msg.call_id;
  var existing = document.getElementById('incoming-call-overlay');
  if (existing) existing.remove();

  var overlay = document.createElement('div');
  overlay.id = 'incoming-call-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:999999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.6);';

  var box = document.createElement('div');
  box.style.cssText = 'background:#1e2025;border-radius:20px;padding:32px 28px;min-width:300px;text-align:center;color:#fff;';

  var kindIcon = msg.kind === 'video' ? '📹' : '📞';
  var callerName = msg.caller_user_id ? 'User #' + msg.caller_user_id : 'Unknown';

  box.innerHTML =
    '<div style="font-size:48px;margin-bottom:16px;animation:pulse 1s infinite;">' + kindIcon + '</div>' +
    '<div style="font-size:18px;font-weight:800;margin-bottom:6px;">Incoming ' + (msg.kind||'Audio') + ' Call</div>' +
    '<div style="font-size:13px;color:rgba(255,255,255,0.6);margin-bottom:28px;">from ' + callerName + '</div>' +
    '<div style="display:flex;gap:16px;justify-content:center;">' +
      '<button id="decline-call-btn" style="width:56px;height:56px;border-radius:50%;background:#ef4444;border:none;cursor:pointer;font-size:24px;" title="Decline">📵</button>' +
      '<button id="accept-call-btn" style="width:56px;height:56px;border-radius:50%;background:#22c55e;border:none;cursor:pointer;font-size:24px;" title="Accept">📞</button>' +
    '</div>';

  overlay.appendChild(box);
  document.body.appendChild(overlay);

  box.querySelector('#accept-call-btn').onclick = function() { _acceptCall(msg.call_id, msg.kind); };
  box.querySelector('#decline-call-btn').onclick = function() { _declineCall(msg.call_id); };

  // Auto-dismiss after TTL
  setTimeout(function(){ _dismissIncomingCall(msg.call_id, ''); }, 62000);
}

function _dismissIncomingCall(callId, reason) {
  var el = document.getElementById('incoming-call-overlay');
  if (el) el.remove();
  if (reason) showToast(reason);
  _incomingCallId = null;
}

async function _acceptCall(callId, kind) {
  _dismissIncomingCall(callId, '');
  try {
    var r = await fetch(API_BASE + '/calls/' + callId + '/accept', {
      method: 'POST', headers: authH()
    });
    if (r.ok) {
      var data = await r.json();
      _activeCallId = callId;
      await _beginCall(kind || 'audio');
      // Connect to LiveKit with callee token
      if (data.join_payload && data.join_payload.access_token) {
        _lkConnect(data.join_payload.livekit_url, data.join_payload.access_token, kind);
      }
    } else {
      showToast('Failed to accept call');
    }
  } catch(e) { showToast('Failed to accept call'); }
}

async function _declineCall(callId) {
  _dismissIncomingCall(callId, '');
  try {
    await fetch(API_BASE + '/calls/' + callId + '/decline', {
      method: 'POST', headers: authH()
    });
  } catch(e) {}
}

function _endActiveCall() {
  var duration = _call.seconds;
  var convId = currentId;
  _activeCallId = null;
  _teardownCallMedia();
  _showCallSummary(duration, convId);
}

function _showCallSummary(seconds, convId) {
  var cid = convId || currentId;
  if (!cid) return;
  var m = Math.floor(seconds / 60), s = seconds % 60;
  var durStr = seconds < 5 ? 'Missed' : (seconds < 60 ? seconds + 's' : m + ':' + (s < 10 ? '0' : '') + s);
  var summary = {
    id: Date.now(),
    conversation_id: cid,
    sender_name: '',
    sender_role: '',
    content: '📞 Call ended · ' + durStr,
    is_self: false,
    created_at: new Date().toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' }),
    isCallSummary: true
  };
  if (!localMsgs[cid]) localMsgs[cid] = [];
  localMsgs[cid].push(summary);
  if (cid === currentId) renderMsgs(localMsgs[cid]);
}

function _teardownCallMedia() {
  // Disconnect LiveKit room
  if (_lkRoom) {
    try { _lkRoom.disconnect(); } catch(e) {}
    _lkRoom = null;
  }
  if (_call.stream) { _call.stream.getTracks().forEach(function(t){ t.stop(); }); _call.stream = null; }
  clearInterval(_call.timer);
  _stopSpeechRecognition();
  _aslStopLoop();
  _call.active = false; _call.type = null; _call.seconds = 0;
  var el = document.getElementById('call-overlay');
  if (el) { el.style.display = 'none'; el.innerHTML = ''; }
}

// ── LiveKit integration ───────────────────────────────────────
var _lkRoom = null;

async function _lkConnect(lkUrl, token, type) {
  if (!lkUrl || !token) return;
  if (typeof LivekitClient === 'undefined') return;
  try {
    var room = new LivekitClient.Room({
      adaptiveStream: true,
      dynacast: true,
    });
    _lkRoom = room;

    // Handle remote participants
    room.on(LivekitClient.RoomEvent.TrackSubscribed, function(track, publication, participant) {
      if (track.kind === LivekitClient.Track.Kind.Video) {
        var el = document.getElementById('call-main-video');
        if (el) track.attach(el);
      }
      if (track.kind === LivekitClient.Track.Kind.Audio) {
        var audioEl = track.attach();
        document.body.appendChild(audioEl);
      }
    });

    room.on(LivekitClient.RoomEvent.TrackUnsubscribed, function(track) {
      track.detach();
    });

    room.on(LivekitClient.RoomEvent.Disconnected, function() {
      _endActiveCall();
    });

    await room.connect(lkUrl, token);

    // Publish local tracks
    if (type === 'video') {
      await room.localParticipant.enableCameraAndMicrophone();
      var camTrack = room.localParticipant.getTrackPublication(LivekitClient.Track.Source.Camera);
      if (camTrack && camTrack.track) {
        var pipEl = document.getElementById('call-pip-video');
        if (pipEl) camTrack.track.attach(pipEl);
      }
    } else {
      await room.localParticipant.setMicrophoneEnabled(true);
    }
  } catch(e) {
    console.warn('LiveKit connect failed:', e);
  }
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
      // ── Call events ──
      if (msg.type === 'call.invite') { _showIncomingCall(msg); }
      if (msg.type === 'call.canceled') {
        _dismissIncomingCall(msg.call_id, 'Call canceled');
        if (msg.call_id === _outgoingCallId) { _outgoingCallId = null; _dismissCallingOverlay(); }
      }
      if (msg.type === 'call.timeout') {
        _dismissIncomingCall(msg.call_id, 'Call timed out');
        if (msg.call_id === _outgoingCallId) { _outgoingCallId = null; _dismissCallingOverlay(); showToast('Call timed out'); }
      }
      if (msg.type === 'call.declined') {
        if (msg.call_id === _outgoingCallId) { _outgoingCallId = null; _dismissCallingOverlay(); showToast('Call declined'); }
        else { showToast('Call declined'); _endActiveCall(); }
      }
      if (msg.type === 'call.ended') { showToast('Call ended'); _endActiveCall(); }
      if (msg.type === 'call.accepted') {
        // Caller side: callee accepted — start media
        if (msg.call_id === _outgoingCallId) {
          _activeCallId = _outgoingCallId;
          _outgoingCallId = null;
          _dismissCallingOverlay();
          _beginCall(_pendingCallKind || 'audio').then(function() {
            // Connect caller to LiveKit using stored join payload
            if (_callerJoinPayload && _callerJoinPayload.access_token) {
              _lkConnect(_callerJoinPayload.livekit_url, _callerJoinPayload.access_token, _pendingCallKind || 'audio');
            }
            _pendingCallKind = null;
          });
        }
      }
      // message.receipt
      if (msg.type === 'message.receipt') {
        var mid = msg.message_id;
        var cur = msgDelivery[mid] || 'sent';
        if (msg.status === 'read' || (msg.status === 'delivered' && cur === 'sent')) {
          msgDelivery[mid] = msg.status;
          if (msg.conversation_id === currentId) renderMsgs(localMsgs[currentId] || []);
        }
      }
      if (msg.type === 'conversations_update') { if (!demo) loadConvs(); }
    };
  }
  connect();
})();