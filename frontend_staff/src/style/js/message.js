var ME = { name: 'Sarah Chen', role: 'Senior Carer' };

// Pull the logged-in user's name and role from session storage if available
(function () {
  try {
    var u = JSON.parse(sessionStorage.getItem('user') || '{}');
    if (u.full_name) ME.name = u.full_name;
    if (u.role || u.global_role) ME.role = u.role || u.global_role;
  } catch (_) {}
})();

// ── Auth helpers ──────────────────────────────────────────────
function authH()  { var h = { 'Content-Type': 'application/json' }; var t = sessionStorage.getItem('access_token'); if (t) h['Authorization'] = 'Bearer ' + t; return h; }
function authHF() { var h = {}; var t = sessionStorage.getItem('access_token'); if (t) h['Authorization'] = 'Bearer ' + t; return h; }

// ── Utility helpers ───────────────────────────────────────────
function esc(s)      { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function ini(n)      { return (n || '?').split(' ').map(function (w) { return w[0]; }).join('').toUpperCase().slice(0, 2); }
function scrollBottom() { var el = document.getElementById('chat-messages'); if (el) el.scrollTop = el.scrollHeight; }
function fmtSize(b)  { if (b < 1024) return b + 'B'; if (b < 1048576) return (b / 1024).toFixed(1) + 'KB'; return (b / 1048576).toFixed(1) + 'MB'; }

// ── Demo data (fallback when API is unavailable) ──────────────
var DEMO_CONVS = [
  { id: 1, name: 'Care Team - Floor 2',          category: 'team',     last_message: "Perfect, I'll check on her in 10 minutes",            last_message_at: '9:32 AM',    unread_count: 3, sub: 'Floor 2 · 4 participants', color: '#2ec4b6', online: true  },
  { id: 2, name: 'Sarah Chen',                   category: 'team',     last_message: "Can you help me with Mrs. Johnson's medication schedule?", last_message_at: '11:15 AM', unread_count: 1, sub: 'Senior Carer',             color: '#7c3aed', online: true  },
  { id: 3, name: 'Resident Care: Dorothy Williams', category: 'resident', last_message: 'Daily care report completed successfully',           last_message_at: 'Yesterday',  unread_count: 0, sub: 'Room 106',                 color: '#db2777', online: false },
  { id: 4, name: 'Night Shift Handover',         category: 'team',     last_message: 'All residents sleeping peacefully.',                   last_message_at: 'Yesterday',  unread_count: 0, sub: 'Night Team',               color: '#059669', online: false },
  { id: 5, name: 'Emergency Alerts',             category: 'alerts',   last_message: 'Fire drill scheduled for tomorrow at 2 PM',           last_message_at: '2 days ago', unread_count: 0, sub: 'System Alerts',            color: '#ef4444', online: false },
];
var DEMO_MSGS = {
  1: [
    { id: 1, conversation_id: 1, sender_name: 'Sarah Chen',  sender_role: 'Senior Carer', content: "Hi team! Mrs. Johnson in room 204 is asking for her afternoon medication. Can someone check on her?", is_self: 'false', created_at: '9:30 AM'  },
    { id: 2, conversation_id: 1, sender_name: 'Me',          sender_role: 'Senior Carer', content: "Perfect, I'll check on her in 10 minutes",                                                           is_self: 'true',  created_at: '9:32 AM'  },
    { id: 3, conversation_id: 1, sender_name: 'Mike Roberts',sender_role: 'Nurse',        content: "Thanks! I've also updated her care plan with the new medication schedule.",                          is_self: 'false', created_at: '10:15 AM' },
  ],
  2: [{ id: 4, conversation_id: 2, sender_name: 'Sarah Chen', sender_role: 'Senior Carer', content: "Can you help me with Mrs. Johnson's medication schedule?", is_self: 'false', created_at: '11:15 AM' }],
  3: [
    { id: 5, conversation_id: 3, sender_name: 'Linda Pham', sender_role: 'Carer',        content: "Daily care report for Dorothy Williams completed. All vitals stable.", is_self: 'false', created_at: '3:00 PM' },
    { id: 6, conversation_id: 3, sender_name: 'Me',         sender_role: 'Senior Carer', content: "Thank you! I've reviewed the report.",                                is_self: 'true',  created_at: '3:05 PM' },
  ],
  4: [{ id: 7, conversation_id: 4, sender_name: 'Night Team', sender_role: 'Carer', content: "All residents sleeping peacefully. No incidents to report.", is_self: 'false', created_at: '10:00 PM' }],
  5: [{ id: 8, conversation_id: 5, sender_name: 'System',     sender_role: 'Admin', content: "Fire drill scheduled for tomorrow at 2 PM. All staff please be prepared.", is_self: 'false', created_at: '2 days ago' }],
};

// ── State variables ───────────────────────────────────────────
var allConvs = [], filteredConvs = [], currentId = null, currentCat = '', localMsgs = {}, demo = false, pendingFiles = [];
var pinnedMsgs  = {};   // { convId: [msgId, ...] }
var reactedMsgs = {};   // { msgId: { emoji: count } }
var deletedMsgs = {};   // { msgId: true }
var editedMsgs  = {};   // { msgId: newContent }
var replyingTo  = null; // { id, sender_name, content }
var typingTimer = null;
var _isTyping   = false;

// ── Color palettes ────────────────────────────────────────────
var CAT_CLR  = { team: '#2ec4b6', resident: '#7c3aed', alerts: '#ef4444' };
var ID_CLR   = ['#2ec4b6', '#7c3aed', '#db2777', '#059669', '#d97706', '#0369a1', '#dc2626', '#9333ea'];
var SC_CLR   = ['#7c3aed', '#db2777', '#d97706', '#0369a1', '#059669', '#dc2626'];
var SENDER_CLR = {}, sci = 0;

function convClr(id, cat)  { return CAT_CLR[cat] || ID_CLR[id % ID_CLR.length]; }
function senderClr(n)      { if (!SENDER_CLR[n]) SENDER_CLR[n] = SC_CLR[sci++ % SC_CLR.length]; return SENDER_CLR[n]; }
function catLabel(c)       { return { team: 'Team Chat', resident: 'Resident Care', alerts: 'System Alerts' }[c] || 'Chat'; }

// ── Load conversations from API, fall back to demo data ───────
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

  // Auto-sync: create conversations for residents that don't have one yet.
  // Runs even when demo=true (demo means no existing convs, not unauthenticated).
  var hasAuth = !!sessionStorage.getItem('access_token');
  if (hasAuth) {
    try {
      var rr = await fetch(API_BASE + '/residents/', { headers: authH() });
      if (rr.ok) {
        var residents = await rr.json();
        for (var ri = 0; ri < residents.length; ri++) {
          var res = residents[ri];
          var convName = 'Resident Care: ' + res.full_name;
          // Only create a new conversation if one doesn't already exist
          var exists = allConvs.find(function(c) { return c.name === convName && c.category === 'resident'; });
          if (!exists) {
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

// ── Update the "N unread messages" label at the top of the panel ──
function updateLabel() {
  var t = allConvs.reduce(function (s, c) { return s + (c.unread_count || 0); }, 0);
  document.getElementById('unread-label').textContent = t ? t + ' unread message' + (t !== 1 ? 's' : '') : 'All caught up';
}

// ── Category tab filter ───────────────────────────────────────
function setCat(cat, btn) {
  currentCat = cat;
  document.querySelectorAll('.cat-tab').forEach(function (b) { b.classList.remove('active'); });
  btn.classList.add('active');
  filterConvs();
}

// ── Filter conversations by category and search query ─────────
function filterConvs() {
  var q = document.getElementById('conv-search').value.toLowerCase();
  filteredConvs = allConvs.filter(function (c) {
    if (currentCat && c.category !== currentCat) return false;
    if (q && !c.name.toLowerCase().includes(q) && !(c.last_message || '').toLowerCase().includes(q)) return false;
    return true;
  });
  renderConvList();
}

// ── Render the left-panel conversation list ───────────────────
function renderConvList() {
  var el = document.getElementById('conv-list');
  if (!filteredConvs.length) {
    el.innerHTML = '<div style="text-align:center;padding:40px 20px;color:var(--text3);font-size:13px;">No conversations found</div>';
    return;
  }
  el.innerHTML = filteredConvs.map(function (c) {
    var isAlert = c.category === 'alerts';
    var badge   = c.unread_count > 0 ? '<div class="unread-badge">' + c.unread_count + '</div>' : '';
    var dot     = c.online ? '<div class="online-dot"></div>' : '';
    return '<div class="conv-item' + (c.id === currentId ? ' active' : '') + '" onclick="openConv(this)" data-cid="' + c.id + '">' +
      '<div class="conv-av' + (isAlert ? ' alert-av' : '') + '" style="background:' + (isAlert ? '#ef4444' : c.color) + '">' + ini(c.name) + dot + '</div>' +
      '<div class="conv-body">' +
        '<div class="conv-name-row"><div class="conv-name' + (c.unread_count > 0 ? ' unread' : '') + '">' + esc(c.name) + '</div><div class="conv-time">' + (c.last_message_at || '') + '</div></div>' +
        '<div class="conv-preview-row"><div class="conv-preview">' + esc(c.last_message || '') + '</div>' + badge + '</div>' +
      '</div></div>';
  }).join('');
}

// ── Open a conversation — accepts a DOM element or a raw id ───
async function openConv(elOrId) {
  var id;
  if (elOrId && elOrId.dataset) {
    var raw = elOrId.dataset.cid;
    id = isNaN(raw) ? raw : parseInt(raw, 10);
  } else {
    id = elOrId;
  }
  currentId = id;
  var conv = allConvs.find(function (c) { return c.id == id; });
  if (!conv) return;

  // Mark conversation as read locally and on the server
  conv.unread_count = 0;
  updateLabel();
  renderConvList();
  try { if (!demo) await fetch(API_BASE + '/messages/conversations/' + id + '/read', { method: 'PATCH', headers: authH() }); } catch (e) {}

  // Reveal the chat view and populate the header
  document.getElementById('chat-empty').style.display = 'none';
  var cv = document.getElementById('chat-view');
  cv.style.display = 'flex';
  document.getElementById('ch-av').textContent  = ini(conv.name);
  document.getElementById('ch-av').style.background = conv.color;
  document.getElementById('ch-name').textContent = conv.name;
  document.getElementById('ch-sub').textContent  = conv.sub || catLabel(conv.category);

  await loadMsgs(id);
  document.getElementById('msg-input').focus();
}

// ── Load messages for a conversation ─────────────────────────
async function loadMsgs(id) {
  // Use cached messages if already loaded for this conversation
  if (localMsgs[id]) { renderMsgs(localMsgs[id]); return; }
  try {
    var r = await fetch(API_BASE + '/messages/conversations/' + id + '/messages', { headers: authH() });
    if (!r.ok) throw new Error();
    localMsgs[id] = await r.json();
  } catch (e) {
    // Fall back to demo messages (or empty array for new conversations)
    localMsgs[id] = (DEMO_MSGS[id] || []).map(function (m) { return Object.assign({}, m); });
  }
  renderMsgs(localMsgs[id]);
}

// ── Format a timestamp into a human-readable time string ──────
function fmtTime(t) {
  if (typeof t === 'string') return t;
  try { return new Date(t).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; }
}

// ── Build HTML for a server-side file attachment bubble ───────
function makeFileBubble(fname, furl) {
  var fullUrl = furl.startsWith('http') ? furl : API_BASE + furl;
  var ext  = fname.split('.').pop().toLowerCase();
  var isImg = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'].includes(ext);
  var isVid = ['mp4', 'mov', 'avi', 'webm', 'mpeg'].includes(ext);
  if (isImg) return '<img class="img-bubble" src="' + fullUrl + '" alt="' + esc(fname) + '" onclick="window.open(\'' + fullUrl + '\')" />';
  if (isVid) return '<video class="vid-bubble" src="' + fullUrl + '" controls></video>';
  return '<a class="file-bubble" href="' + fullUrl + '" download="' + esc(fname) + '" target="_blank"><div class="file-bubble-icon"><svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></div><div><div class="file-bubble-name">' + esc(fname) + '</div><div class="file-bubble-size">Tap to download</div></div></a>';
}

// ── Build HTML for a locally-staged (not yet uploaded) file ───
function localFileBubble(f) {
  if (f.type === 'image') return '<img class="img-bubble" src="' + f.objectUrl + '" alt="' + esc(f.file.name) + '" onclick="window.open(\'' + f.objectUrl + '\')" />';
  if (f.type === 'video') return '<video class="vid-bubble" src="' + f.objectUrl + '" controls></video>';
  return '<a class="file-bubble" href="' + f.objectUrl + '" download="' + esc(f.file.name) + '" target="_blank"><div class="file-bubble-icon"><svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></div><div><div class="file-bubble-name">' + esc(f.file.name) + '</div><div class="file-bubble-size">' + fmtSize(f.file.size) + '</div></div></a>';
}

// ── Render all messages in the active conversation ────────────
function renderMsgs(msgs, hl) {
  var el = document.getElementById('chat-messages');
  if (!msgs.length) {
    el.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text3);font-size:13px;">No messages yet. Say hello!</div>';
    _updateScrollBtn();
    return;
  }

  // Pinned message banner (shows the most recently pinned message)
  var pinned     = (pinnedMsgs[currentId] || []);
  var pinnedHtml = '';
  if (pinned.length) {
    var pm = msgs.find(function(m){ return m.id == pinned[pinned.length - 1]; });
    if (pm) pinnedHtml = '<div class="pinned-bar" onclick="scrollToMsg(this.dataset.pmid)" data-pmid="' + pm.id + '">' +
      '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"/></svg>' +
      '<span>' + esc((pm.content || '').slice(0, 60)) + '</span>' +
      '<button onclick="event.stopPropagation();unpinMsg(this.dataset.pmid)" data-pmid="' + pm.id + '" style="background:none;border:none;cursor:pointer;color:var(--text3);font-size:16px;padding:0 4px;">×</button>' +
    '</div>';
  }

  var html = pinnedHtml + '<div class="date-div">Today</div>';

  msgs.forEach(function (m, i) {
    // Deleted message placeholder
    if (deletedMsgs[m.id]) {
      html += '<div class="msg-row' + (m.is_self === true || m.is_self === 'true' ? ' self' : '') + '">' +
        '<div class="bubble-deleted">🚫 Message deleted</div></div>';
      return;
    }

    var isSelf   = m.is_self === true || m.is_self === 'true';
    var clr      = isSelf ? '#2ec4b6' : senderClr(m.sender_name);
    var t        = fmtTime(m.created_at);
    var showName = !isSelf && (i === 0 || msgs[i - 1].sender_name !== m.sender_name || msgs[i - 1].is_self === true || msgs[i - 1].is_self === 'true');
    var tick     = isSelf ? '<span class="tick"><svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg></span>' : '';
    var content  = editedMsgs[m.id] || m.content || '';
    var isEdited = !!editedMsgs[m.id];

    // Reply quote banner
    var replyHtml = '';
    if (m.replyTo) {
      replyHtml = '<div class="reply-quote"><span class="reply-name">' + esc(m.replyTo.sender_name) + '</span>' +
        '<span class="reply-text">' + esc((m.replyTo.content || '').slice(0, 80)) + '</span></div>';
    }

    // Bubble content: file attachment, server file reference, or plain text
    var bubbleHtml;
    if (m.fileHtml) {
      bubbleHtml = m.fileHtml;
    } else if (content.startsWith('[file] ')) {
      var parts  = content.slice(7).split(' | ');
      bubbleHtml = makeFileBubble(parts[0] || 'file', parts[1] || '');
    } else {
      var txt = esc(content);
      // Highlight search matches if a query string is provided
      if (hl) txt = txt.replace(new RegExp(esc(hl).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), function (s) { return '<mark style="background:#fef08a;border-radius:3px;">' + s + '</mark>'; });
      bubbleHtml = replyHtml + (isSelf
        ? '<div class="bubble self">'  + txt + (isEdited ? '<span class="edited-tag"> (edited)</span>' : '') + '</div>'
        : '<div class="bubble other">' + txt + (isEdited ? '<span class="edited-tag"> (edited)</span>' : '') + '</div>');
    }

    // Emoji reactions row
    var rxns    = reactedMsgs[m.id] || {};
    var rxnHtml = '';
    if (Object.keys(rxns).length) {
      rxnHtml = '<div class="reactions">';
      Object.keys(rxns).forEach(function(em){ rxnHtml += '<span class="rxn" onclick="toggleReaction(&quot;' + m.id + '&quot;,&quot;' + em + '&quot;)">' + em + ' ' + rxns[em] + '</span>'; });
      rxnHtml += '</div>';
    }

    var mid      = String(m.id);
    var rowAttrs = 'data-mid="' + mid + '" data-self="' + (isSelf ? '1' : '0') + '" oncontextmenu="showMsgCtx(event,this)"';

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

  // Typing indicator (hidden by default, shown via _showTyping)
  html += '<div id="typing-indicator" style="display:none;" class="msg-row">' +
    '<div class="typing-dots"><span></span><span></span><span></span></div></div>';

  el.innerHTML = html;
  scrollBottom();
  _updateScrollBtn();
}

// ── Handle files chosen via the file picker or drag-and-drop ──
function handleFiles(files) {
  if (!currentId) { alert('Please select a conversation first.'); return; }
  Array.from(files).forEach(function (file) {
    var type = file.type.startsWith('image/') ? 'image' : file.type.startsWith('video/') ? 'video' : 'doc';
    pendingFiles.push({ file: file, objectUrl: URL.createObjectURL(file), type: type });
  });
  document.getElementById('file-input').value = '';
  renderFilePreview();
}

// ── Render the file preview strip above the message input ─────
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

// ── Handle Enter key to send, and track typing state ─────────
function handleKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); return; }
  // Start typing indicator; auto-clear after 2 s of inactivity
  if (!_isTyping) { _isTyping = true; }
  clearTimeout(typingTimer);
  typingTimer = setTimeout(function(){ _isTyping = false; }, 2000);
}

// ── Send a message (text and/or file attachments) ─────────────
async function sendMessage() {
  var input   = document.getElementById('msg-input');
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

  // Upload each pending file and post a file message
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

  // Send the text message if one was typed
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

// ── Auto-resize the message textarea as the user types ────────
function autoResize(el) { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 120) + 'px'; }

// ── Mark current conversation as unread / read ────────────────
function markCurrentUnread() { if (!currentId) return; var c = allConvs.find(function (x) { return x.id === currentId; }); if (!c) return; c.unread_count = (c.unread_count || 0) + 1; updateLabel(); renderConvList(); }
function markCurrentRead()   { if (!currentId) return; var c = allConvs.find(function (x) { return x.id === currentId; }); if (!c) return; c.unread_count = 0; updateLabel(); renderConvList(); try { if (!demo) fetch(API_BASE + '/messages/conversations/' + currentId + '/read', { method: 'PATCH', headers: authH() }); } catch (e) {} }

// ── Toggle the in-conversation search bar ─────────────────────
function toggleMsgSearch() { var bar = document.getElementById('msg-search-bar'); var open = bar.style.display === 'none' || bar.style.display === ''; bar.style.display = open ? 'block' : 'none'; if (open) document.getElementById('msg-search-input').focus(); else { document.getElementById('msg-search-input').value = ''; renderMsgs(localMsgs[currentId] || []); } }
function searchInChat()     { var q = document.getElementById('msg-search-input').value.trim(); renderMsgs(localMsgs[currentId] || [], q); }

// ── Conversation-level context menu (more button) ─────────────
function showCtx(e) { e.stopPropagation(); var m = document.getElementById('ctx'); m.style.top = e.clientY + 'px'; m.style.left = Math.max(0, e.clientX - 180) + 'px'; m.classList.add('show'); }
function hideCtx()  { document.getElementById('ctx').classList.remove('show'); }
document.addEventListener('click', hideCtx);

// ── Delete the currently open conversation ────────────────────
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

// ── New conversation modal ────────────────────────────────────
function openNewModal() {
  var f = document.getElementById('new-account-id');
  if (f) f.value = '';
  var err = document.getElementById('new-modal-error');
  if (err) { err.textContent = ''; err.style.display = 'none'; }
  document.getElementById('modal-new').classList.add('open');
  setTimeout(function () { var f2 = document.getElementById('new-account-id'); if (f2) f2.focus(); }, 80);
}
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

// ── Create a new conversation (invites a resident by Account ID) ──
async function createConv() {
  var accountId = (document.getElementById('new-account-id') || {}).value;
  accountId     = (accountId || '').trim().toUpperCase();
  var errEl     = document.getElementById('new-modal-error');
  if (!accountId) {
    if (errEl) { errEl.textContent = 'Please enter a Client Account ID.'; errEl.style.display = 'block'; }
    return;
  }
  var btn = document.getElementById('new-modal-submit');
  if (btn) { btn.textContent = 'Sending…'; btn.disabled = true; }
  try {
    var invRes  = await fetch(API_BASE + '/center-membership/admin/invite', { method: 'POST', headers: authH(), body: JSON.stringify({ account_id: accountId }) });
    var invData = await invRes.json();
    if (!invRes.ok) {
      var errMsg = 'Invalid Account ID.';
      if (invData) {
        if (typeof invData.detail === 'string')      errMsg = invData.detail;
        else if (invData.detail && invData.detail.msg) errMsg = invData.detail.msg;
        else if (invData.msg)                         errMsg = invData.msg;
      }
      if (errEl) { errEl.textContent = errMsg; errEl.style.display = 'block'; }
      if (btn)   { btn.textContent = 'Send Invitation'; btn.disabled = false; }
      return;
    }

    var clientName = invData.user_full_name || accountId;
    var newId      = Date.now();
    var convName   = 'Resident Care: ' + clientName;

    // Create the backend conversation record for this resident
    try {
      var convRes = await fetch(API_BASE + '/messages/conversations', { method: 'POST', headers: authH(), body: JSON.stringify({ name: convName, category: 'resident' }) });
      if (convRes.ok) { var cd = await convRes.json(); newId = cd.id; }
    } catch(e) {}

    var c = { id: newId, name: convName, category: 'resident', last_message: 'Invitation sent', last_message_at: 'Just now', unread_count: 0, sub: 'Resident Care', color: CAT_CLR.resident, online: false };
    allConvs.unshift(c);
    localMsgs[newId] = [];
    filterConvs();
    closeModal('modal-new');
    openConv(newId);
  } catch(e) {
    if (errEl) { errEl.textContent = 'Network error. Please try again.'; errEl.style.display = 'block'; }
    if (btn)   { btn.textContent = 'Send Invitation'; btn.disabled = false; }
  }
}

// ── Drag-and-drop and scroll-to-bottom setup on DOM ready ─────
document.addEventListener('DOMContentLoaded', function () {
  var area = document.getElementById('chat-messages');
  if (!area) return;
  area.addEventListener('dragover',  function (e) { e.preventDefault(); area.classList.add('drag-over'); });
  area.addEventListener('dragleave', function ()  { area.classList.remove('drag-over'); });
  area.addEventListener('drop',      function (e) { e.preventDefault(); area.classList.remove('drag-over'); if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files); });
  area.addEventListener('scroll', _updateScrollBtn);
});

loadConvs();

// ════════════════════════════════════════════════════════════════
// CALLING FEATURE — 3-Layer Architecture
// ────────────────────────────────────────────────────────────────
// Layer 1: Capture  — getUserMedia, raw audio/video stream
// Layer 2: AI       — ASL detection + speech transcription
// Layer 3: Display  — renders call UI overlay + controls
// ════════════════════════════════════════════════════════════════

var _call = { active: false, type: null, stream: null, muted: false, videoOff: false, timer: null, seconds: 0 };

// ── Layer 1: Capture raw media from the device ────────────────
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

// ── Layer 2: ASL AI Detection ─────────────────────────────────
// Captures frames from the video element → POST to /api/v1/ai/asl/detect
// Backend: MediaPipe extracts landmarks → trained classifier → returns letter
var _aslCanvas     = null;
var _aslCtx        = null;
var _aslLoop       = null;
var _aslSentence   = '';
var _aslHoldLetter = '';
var _aslHoldCount  = 0;
var ASL_HOLD_FRAMES   = 18;
var ASL_INTERVAL_MS   = 180;
var ASL_STATIC_CONF   = 0.70;
var ASL_MOTION_CONF   = 0.76;
var ASL_MOTION_SEQLEN = 10;
var _aslMotionSeq     = [];

function _L2_aiPipeline(stream) {
  // Only run for video calls that have a real camera stream
  if (!stream || !stream.getVideoTracks().length) return stream;

  // Create an offscreen canvas used to extract JPEG frames for the API
  _aslCanvas        = document.createElement('canvas');
  _aslCanvas.width  = 320;
  _aslCanvas.height = 240;
  _aslCtx           = _aslCanvas.getContext('2d');

  // Reset ASL state for this call session
  _aslSentence   = '';
  _aslHoldLetter = '';
  _aslHoldCount  = 0;
  _aslMotionSeq  = [];
  // Subtitle box is injected after _L3_showOverlay to avoid innerHTML wipe

  _aslLoop = setInterval(_aslDetectFrame, ASL_INTERVAL_MS);
  return stream;
}

// ── Transcript panel — shared by Speech and ASL modes ─────────
// Layout:
//   TOP:    Mode tabs  [🎤 Speech] [👋 ASL]
//   MIDDLE: Live transcript text
//   BOTTOM: [Clear] [Space] (ASL only)

var _transcriptMode = 'speech'; // 'speech' | 'asl'
var _speechRec      = null;
var _speechFinal    = '';
var _speechInterim  = '';

function _injectAslSubtitle() {
  var el = document.getElementById('call-overlay');
  if (!el) return;
  if (document.getElementById('transcript-panel')) return;
  var box  = document.createElement('div');
  box.id   = 'transcript-panel';
  box.style.cssText = [
    'position:absolute;bottom:100px;left:50%;transform:translateX(-50%);z-index:99;',
    'background:rgba(0,0,0,0.80);backdrop-filter:blur(8px);',
    'border-radius:14px;padding:12px 16px;min-width:300px;max-width:90%;',
    'font-family:Inter,sans-serif;box-sizing:border-box;',
  ].join('');
  box.innerHTML =
    '<div style="display:flex;gap:6px;margin-bottom:10px;justify-content:center;">' +
      '<button id="tab-speech" onclick="_switchTranscriptMode(&quot;speech&quot;)" style="font-size:12px;padding:4px 14px;border-radius:20px;cursor:pointer;border:none;background:rgba(56,189,248,0.9);color:#0f172a;font-weight:700;">🎤 Speech</button>' +
      '<button id="tab-asl"    onclick="_switchTranscriptMode(&quot;asl&quot;)"    style="font-size:12px;padding:4px 14px;border-radius:20px;cursor:pointer;border:none;background:rgba(255,255,255,0.15);color:#fff;">👋 ASL</button>' +
    '</div>' +
    '<div id="transcript-live" style="color:#fff;font-size:14px;min-height:40px;text-align:center;line-height:1.5;word-break:break-word;">…</div>' +
    '<div id="asl-controls" style="display:none;margin-top:10px;display:flex;gap:8px;justify-content:center;flex-wrap:wrap;">' +
      '<button onclick="_aslClear()"         style="font-size:12px;padding:4px 12px;border-radius:20px;border:none;background:rgba(255,255,255,0.15);color:#fff;cursor:pointer;">Clear</button>' +
      '<button onclick="_aslSpace()"         style="font-size:12px;padding:4px 12px;border-radius:20px;border:none;background:rgba(255,255,255,0.15);color:#fff;cursor:pointer;">Space</button>' +
      '<button id="asl-mode-btn" onclick="_aslToggleGesture()" style="font-size:12px;padding:4px 12px;border-radius:20px;border:none;background:rgba(255,255,255,0.15);color:#38bdf8;cursor:pointer;">Static A-Z</button>' +
      '<div style="display:flex;align-items:center;gap:6px;color:#fff;font-size:12px;">' +
        '<span id="asl-live-letter" style="font-size:22px;font-weight:700;color:#38bdf8;">—</span>' +
        '<span id="asl-live-conf"   style="opacity:0.6;"></span>' +
      '</div>' +
    '</div>';
  el.appendChild(box);

  // Start the appropriate transcript mode
  _switchTranscriptMode('speech');
}

function _switchTranscriptMode(mode) {
  _transcriptMode = mode;
  var tabSpeech = document.getElementById('tab-speech');
  var tabAsl    = document.getElementById('tab-asl');
  var aslCtrl   = document.getElementById('asl-controls');
  if (tabSpeech) tabSpeech.style.background = mode === 'speech' ? 'rgba(56,189,248,0.9)' : 'rgba(255,255,255,0.15)';
  if (tabSpeech) tabSpeech.style.color       = mode === 'speech' ? '#0f172a'              : '#fff';
  if (tabAsl)    tabAsl.style.background     = mode === 'asl'    ? 'rgba(56,189,248,0.9)' : 'rgba(255,255,255,0.15)';
  if (tabAsl)    tabAsl.style.color          = mode === 'asl'    ? '#0f172a'              : '#fff';
  if (aslCtrl)   aslCtrl.style.display       = mode === 'asl'    ? 'flex'                 : 'none';

  if (mode === 'speech') {
    _startSpeechRecognition();
    _updateTranscriptLive(_speechFinal || '…');
  } else {
    _stopSpeechRecognition();
    _updateTranscriptLive(_aslSentence || '…');
  }
}

// ── Web Speech API integration ────────────────────────────────
function _startSpeechRecognition() {
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { _updateTranscriptLive('Speech recognition not supported in this browser.'); return; }
  _stopSpeechRecognition();
  _speechFinal   = '';
  _speechInterim = '';
  _speechRec     = new SR();
  _speechRec.continuous    = true;
  _speechRec.interimResults = true;
  _speechRec.lang          = 'en-AU';
  _speechRec.onresult = function(e) {
    _speechInterim = '';
    for (var i = e.resultIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) _speechFinal += e.results[i][0].transcript + ' ';
      else                      _speechInterim += e.results[i][0].transcript;
    }
    if (_transcriptMode === 'speech') _updateTranscriptLive((_speechFinal + _speechInterim).trim() || '…');
  };
  _speechRec.onend = function() {
    // Auto-restart if still in speech mode and the call is active
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
  _aslSentence = ''; _aslMotionSeq = [];
  if (_transcriptMode === 'asl') _updateTranscriptLive('…');
}
function _aslSpace() {
  _aslSentence += ' ';
  if (_transcriptMode === 'asl') _updateTranscriptLive(_aslSentence);
}
var _aslMode = 'static';
function _aslToggleGesture() {
  _aslMode       = _aslMode === 'static' ? 'motion' : 'static';
  _aslMotionSeq  = []; _aslHoldCount = 0; _aslHoldLetter = '';
  var btn = document.getElementById('asl-mode-btn');
  if (btn) { btn.textContent = _aslMode === 'static' ? 'Static A-Z' : 'Motion Words'; btn.style.color = _aslMode === 'static' ? '#38bdf8' : '#9fe1cb'; }
}
function _aslUpdateText() {
  if (_transcriptMode === 'asl') _updateTranscriptLive(_aslSentence || '…');
}

// ── Per-frame ASL detection loop ──────────────────────────────
async function _aslDetectFrame() {
  if (!_call.active || _call.type !== 'video') { _aslStopLoop(); return; }
  var video = document.getElementById('call-main-video');
  if (!video || !video.videoWidth) return;

  _aslCtx.drawImage(video, 0, 0, _aslCanvas.width, _aslCanvas.height);
  var b64 = _aslCanvas.toDataURL('image/jpeg', 0.7).split(',')[1];

  try {
    var token = sessionStorage.getItem('access_token') || '';
    var res   = await fetch(API_BASE + '/asl/detect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ image_b64: b64, mode: _aslMode, motion_seq: _aslMode === 'motion' ? _aslMotionSeq : null })
    });
    if (!res.ok) return;
    var data = await res.json();

    // Accumulate motion-sequence frames for multi-frame gesture recognition
    if (_aslMode === 'motion' && data.current_frame_features) {
      _aslMotionSeq.push(data.current_frame_features);
      if (_aslMotionSeq.length > ASL_MOTION_SEQLEN) _aslMotionSeq.shift();
    }

    var confThreshold = _aslMode === 'static' ? ASL_STATIC_CONF : ASL_MOTION_CONF;

    var letterEl = document.getElementById('asl-live-letter');
    var confEl   = document.getElementById('asl-live-conf');
    if (letterEl) letterEl.textContent = data.hand_detected && data.letter ? data.letter : '—';
    if (confEl)   confEl.textContent   = data.hand_detected && data.letter ? Math.round(data.confidence * 100) + '%' : '';

    // Hold-to-confirm: a letter must be held for ASL_HOLD_FRAMES consecutive frames before it is committed
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

    // Draw hand landmarks over the video if the backend returns them
    if (data.landmarks && data.landmarks.length) {
      _aslDrawLandmarks(data.landmarks, video.videoWidth, video.videoHeight);
    }
  } catch (e) { /* Silent fail — don't interrupt the call for a detection error */ }
}

// ── Draw hand landmarks as dots on an overlay canvas ─────────
function _aslDrawLandmarks(landmarks, vw, vh) {
  var canvas = document.getElementById('call-overlay');
  if (!canvas) return;
  var c = document.getElementById('asl-lm-canvas');
  if (!c) {
    c    = document.createElement('canvas');
    c.id = 'asl-lm-canvas';
    c.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:3;';
    canvas.appendChild(c);
  }
  c.width  = canvas.offsetWidth  || 640;
  c.height = canvas.offsetHeight || 480;
  var ctx  = c.getContext('2d');
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.fillStyle   = 'rgba(56,189,248,0.8)';
  ctx.strokeStyle = 'rgba(56,189,248,0.5)';
  ctx.lineWidth   = 1.5;
  landmarks.forEach(function(lm) {
    var x = lm[0] * c.width;
    var y = lm[1] * c.height;
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fill();
  });
}

// ── Stop the ASL detection loop and clean up its DOM elements ─
function _aslStopLoop() {
  if (_aslLoop) { clearInterval(_aslLoop); _aslLoop = null; }
  var box = document.getElementById('asl-subtitle-box');
  if (box) box.remove();
  var lmc = document.getElementById('asl-lm-canvas');
  if (lmc) lmc.remove();
}

// ── Layer 3: Display — build and show the call overlay ────────
function startAudioCall() { if (currentId) _beginCall('audio'); }
function startVideoCall()  { if (currentId) _beginCall('video'); }

async function _beginCall(type) {
  if (_call.active) return;
  _call.active   = true;
  _call.type     = type;
  _call.muted    = false;
  _call.videoOff = false;
  _call.seconds  = 0;

  var stream = await _L1_capture(type); // Layer 1: get media
  _L2_aiPipeline(stream);               // Layer 2: start AI pipeline
  _L3_showOverlay(type, stream);        // Layer 3: render overlay HTML
  _injectAslSubtitle();                 // Inject transcript panel AFTER overlay (avoids innerHTML wipe)
  _startTimer();                        // Begin call duration counter
}

// ── Render the full-screen call overlay HTML ──────────────────
function _L3_showOverlay(type, stream) {
  var conv  = allConvs.find(function (c) { return c.id === currentId; });
  var name  = conv ? conv.name  : 'Unknown';
  var color = conv ? conv.color : '#2ec4b6';
  var av    = ini(name);
  var el    = document.getElementById('call-overlay');
  if (!el) return;
  el.style.display = 'flex';
  el.className     = 'call-overlay call-overlay--' + type;

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
      // Slight delay so the DOM elements are ready before attaching the stream
      setTimeout(function () {
        var a = document.getElementById('call-main-video');
        var b = document.getElementById('call-pip-video');
        if (a) a.srcObject = stream;
        if (b) b.srcObject = stream;
      }, 50);
    }
  } else {
    // Audio call: animated pulsing avatar background
    el.innerHTML =
      '<div class="call-audio-bg" style="background:radial-gradient(circle at 50% 40%,' + color + '33 0%,#0f172a 70%);">' +
        '<div class="call-pulse call-pulse--3" style="border-color:' + color + '18;"></div>' +
        '<div class="call-pulse call-pulse--2" style="border-color:' + color + '30;"></div>' +
        '<div class="call-pulse"               style="border-color:' + color + '55;"></div>' +
        '<div class="call-av" style="background:' + color + '">' + av + '</div>' +
      '</div>' +
      _callInfo(name) + _callBtns(type);
  }
}

// ── Build the call info block (name + status + timer) ─────────
function _callInfo(name) {
  return '<div class="call-info">' +
    '<div class="call-name">' + esc(name) + '</div>' +
    '<div class="call-status" id="call-status">Connecting…</div>' +
    // Timer is hidden until the call connects (shown after 1.5 s)
    '<div class="call-timer" id="call-timer" style="display:none;">0:00</div>' +
  '</div>';
}

// ── Build the call control buttons ────────────────────────────
function _callBtns(type) {
  return '<div class="call-controls">' +
    '<button class="call-btn" id="btn-mute" onclick="callToggleMute()" title="Mute">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>' +
    '</button>' +
    (type === 'video'
      ? '<button class="call-btn" id="btn-cam" onclick="callToggleVideo()" title="Camera">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>' +
        '</button>'
      : '') +
    '<button class="call-btn" id="btn-spk" onclick="callToggleSpeaker()" title="Speaker">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>' +
    '</button>' +
    '<button class="call-btn call-btn--end" onclick="endCall()" title="End call">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="transform:rotate(135deg)"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.6 1.18h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.77a16 16 0 0 0 6 6l.93-.93a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7a2 2 0 0 1 1.72 2.03z"/></svg>' +
    '</button>' +
  '</div>';
}

// ── Start the call duration timer ────────────────────────────
function _startTimer() {
  // Show the timer (and hide "Connecting…") after a short delay
  setTimeout(function () {
    var s = document.getElementById('call-status');
    var t = document.getElementById('call-timer');
    if (s) s.style.display = 'none';
    if (t) t.style.display = 'block';
  }, 1500);

  // Increment seconds counter and update the timer display every second
  _call.timer = setInterval(function () {
    _call.seconds++;
    var t = document.getElementById('call-timer');
    if (t) {
      var m = Math.floor(_call.seconds / 60), s = _call.seconds % 60;
      t.textContent = m + ':' + (s < 10 ? '0' : '') + s;
    }
  }, 1000);
}

// ── In-call control handlers ──────────────────────────────────
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

// ── End the call and inject a call-summary message into chat ──
// FIX: Previously endCall() simply hid the overlay without recording
// how long the call lasted.  Now it saves the elapsed seconds and call
// type BEFORE resetting _call, then inserts a system message into the
// conversation so the duration is permanently visible in the chat history.
function endCall() {
  // Save call metadata before the _call object is reset to defaults
  var callSeconds = _call.seconds;
  var callType    = _call.type;
  var callConvId  = currentId;

  // Stop all media tracks and cancel the timer
  if (_call.stream) {
    _call.stream.getTracks().forEach(function (t) { t.stop(); });
    _call.stream = null;
  }
  clearInterval(_call.timer);
  _stopSpeechRecognition();
  _aslStopLoop();

  // Reset call state
  _call.active  = false;
  _call.type    = null;
  _call.seconds = 0;

  // Hide and clear the overlay
  var el = document.getElementById('call-overlay');
  if (el) { el.style.display = 'none'; el.innerHTML = ''; }

  // Insert a call-summary message into the chat (only if the call lasted at least 1 second)
  if (callConvId && callSeconds > 0) {
    var m    = Math.floor(callSeconds / 60);
    var s    = callSeconds % 60;
    var dur  = m + ':' + (s < 10 ? '0' : '') + s;
    var icon = callType === 'video' ? '📹' : '📞';
    var label = callType === 'video' ? 'Video' : 'Voice';
    var now  = new Date().toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' });

    var summaryMsg = {
      id:            Date.now(),
      conversation_id: callConvId,
      sender_name:   ME.name,
      sender_role:   ME.role,
      content:       icon + ' ' + label + ' call ended · ' + dur,
      is_self:       true,
      created_at:    now,
    };

    if (!localMsgs[callConvId]) localMsgs[callConvId] = [];
    localMsgs[callConvId].push(summaryMsg);

    // Re-render the message list if the user is still in that conversation
    if (callConvId === currentId) renderMsgs(localMsgs[callConvId]);
  }
}

// ════════════════════════════════════════════════════
// FEATURE FUNCTIONS
// ════════════════════════════════════════════════════

// ── Delete (recall) a message ─────────────────────────────────
function recallMsg(msgId) {
  if (!confirm('Delete this message?')) return;
  deletedMsgs[msgId] = true;
  renderMsgs(localMsgs[currentId] || []);
  try { fetch(API_BASE + '/messages/' + msgId, { method: 'DELETE', headers: authH() }); } catch(e) {}
}

// ── Edit the text of an existing message ─────────────────────
function editMsg(msgId) {
  var msgs   = localMsgs[currentId] || [];
  var m      = msgs.find(function(x){ return x.id == msgId; });
  if (!m) return;
  var newText = prompt('Edit message:', editedMsgs[msgId] || m.content || '');
  if (newText === null || newText.trim() === '') return;
  editedMsgs[msgId] = newText.trim();
  renderMsgs(msgs);
}

// ── Set the active reply-to context ──────────────────────────
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

// ── Pin / Unpin a message ────────────────────────────────────
function pinMsg(msgId) {
  if (!pinnedMsgs[currentId]) pinnedMsgs[currentId] = [];
  if (pinnedMsgs[currentId].indexOf(msgId) === -1) pinnedMsgs[currentId].push(msgId);
  renderMsgs(localMsgs[currentId] || []);
}
function unpinMsg(msgId) {
  if (!pinnedMsgs[currentId]) return;
  pinnedMsgs[currentId] = pinnedMsgs[currentId].filter(function(x){ return x != msgId; });
  renderMsgs(localMsgs[currentId] || []);
}

// ── Smooth-scroll to a specific message by id ────────────────
function scrollToMsg(msgId) {
  var el = document.querySelector('[data-mid="' + msgId + '"]');
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('msg-highlight');
    setTimeout(function(){ el.classList.remove('msg-highlight'); }, 1500);
  }
}

// ── Copy message text to clipboard ───────────────────────────
function copyMsg(text) {
  navigator.clipboard.writeText(text)
    .then(function(){ showToast('Copied!'); })
    .catch(function(){ showToast('Copy failed'); });
}

// ── Right-click context menu for messages ────────────────────
var REACTION_EMOJIS = ['👍','❤️','😂','😮','😢','🙏','✅','🚨'];
var _ctxMsgId  = null;
var _ctxIsSelf = false;

function showMsgCtx(e, rowEl) {
  e.preventDefault();
  e.stopPropagation();
  _closeMsgCtx();

  _ctxMsgId  = rowEl.dataset.mid;
  _ctxIsSelf = rowEl.dataset.self === '1';
  var msgs   = localMsgs[currentId] || [];
  var m      = msgs.find(function(x){ return String(x.id) === String(_ctxMsgId); });
  var txt    = m ? (editedMsgs[_ctxMsgId] || m.content || '') : '';

  var menu = document.createElement('div');
  menu.id  = 'msg-ctx-menu';
  menu.style.cssText = 'position:fixed;z-index:99999;background:#111214;border-radius:6px;padding:4px;min-width:188px;box-shadow:0 8px 24px rgba(0,0,0,0.5);font-family:Inter,sans-serif;user-select:none;';

  // Quick reaction emoji row
  var rxnRow = document.createElement('div');
  rxnRow.style.cssText = 'display:flex;align-items:center;gap:1px;padding:4px 6px 8px;border-bottom:1px solid rgba(255,255,255,0.06);margin-bottom:4px;';
  REACTION_EMOJIS.slice(0, 6).forEach(function(em) {
    var rb = document.createElement('button');
    rb.textContent = em;
    rb.title       = em;
    rb.style.cssText = 'background:none;border:none;cursor:pointer;font-size:20px;padding:4px 6px;border-radius:5px;line-height:1;transition:background .1s;';
    rb.onmouseover = function(){ this.style.background = 'rgba(255,255,255,0.08)'; this.style.transform = 'scale(1.25)'; };
    rb.onmouseout  = function(){ this.style.background = 'none'; this.style.transform = 'scale(1)'; };
    rb.onclick     = function(ev){ ev.stopPropagation(); toggleReaction(_ctxMsgId, em); _closeMsgCtx(); };
    rxnRow.appendChild(rb);
  });
  // "More reactions" button (+ icon)
  var moreBtn = document.createElement('button');
  moreBtn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>';
  moreBtn.style.cssText = 'background:none;border:none;cursor:pointer;color:rgba(255,255,255,0.4);padding:4px 6px;border-radius:5px;display:flex;align-items:center;transition:background .1s;margin-left:auto;';
  moreBtn.onmouseover = function(){ this.style.background = 'rgba(255,255,255,0.08)'; this.style.color = 'rgba(255,255,255,0.8)'; };
  moreBtn.onmouseout  = function(){ this.style.background = 'none'; this.style.color = 'rgba(255,255,255,0.4)'; };
  rxnRow.appendChild(moreBtn);
  menu.appendChild(rxnRow);

  // Action menu items
  var items = [
    { label: 'Add reaction',   icon: '😊',    action: function(){} },
    null, // ── divider ──
    { label: 'Reply',          icon: 'reply',  action: function(){ if (m) replyToMsg(_ctxMsgId, m.sender_name, txt); } },
    { label: 'Pin message',    icon: 'pin',    action: function(){ pinMsg(_ctxMsgId); } },
    { label: 'Copy text',      icon: 'copy',   action: function(){ copyMsg(txt); } },
    { label: 'Mark as unread', icon: 'unread', action: function(){ markCurrentUnread(); } },
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
      // Divider line
      var div = document.createElement('div');
      div.style.cssText = 'height:1px;background:rgba(255,255,255,0.06);margin:4px 0;';
      menu.appendChild(div);
      return;
    }
    if (item.label === 'Add reaction') return; // Handled by the emoji row above

    var btn     = document.createElement('button');
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
    btn.onclick     = function(ev){ ev.stopPropagation(); item.action(); _closeMsgCtx(); };
    menu.appendChild(btn);
  });

  // Position the menu near the cursor, keeping it within the viewport
  document.body.appendChild(menu);
  var x  = e.clientX, y = e.clientY;
  var mw = menu.offsetWidth, mh = menu.offsetHeight;
  if (x + mw > window.innerWidth  - 8) x = x - mw;
  if (y + mh > window.innerHeight - 8) y = y - mh;
  menu.style.left = x + 'px';
  menu.style.top  = y + 'px';

  setTimeout(function() {
    document.addEventListener('click',       _closeMsgCtx, { once: true });
    document.addEventListener('contextmenu', _closeMsgCtx, { once: true });
  }, 10);
}

function _closeMsgCtx() {
  var m = document.getElementById('msg-ctx-menu');
  if (m) m.remove();
}

// ── Extended emoji reaction picker ───────────────────────────
function showReactionPicker(msgId, e) {
  e.stopPropagation();
  var old = document.getElementById('rxn-picker');
  if (old) old.remove();
  var picker   = document.createElement('div');
  picker.id    = 'rxn-picker';
  picker.style.cssText = 'position:fixed;z-index:9999;background:#fff;border:1.5px solid var(--border);border-radius:12px;padding:8px;display:flex;gap:4px;box-shadow:0 4px 20px rgba(0,0,0,0.15);';
  REACTION_EMOJIS.forEach(function(em) {
    var btn = document.createElement('button');
    btn.textContent = em;
    btn.style.cssText = 'background:none;border:none;cursor:pointer;font-size:20px;padding:4px 6px;border-radius:8px;';
    btn.addEventListener('mouseover', function(){ this.style.background = '#f0fdfa'; });
    btn.addEventListener('mouseout',  function(){ this.style.background = 'none'; });
    btn.addEventListener('click', function(ev) {
      ev.stopPropagation();
      toggleReaction(msgId, em);
      var p = document.getElementById('rxn-picker');
      if (p) p.remove();
    });
    picker.appendChild(btn);
  });
  var rect       = e.target.getBoundingClientRect();
  picker.style.top  = (rect.top - 60) + 'px';
  picker.style.left = Math.max(8, rect.left - 80) + 'px';
  document.body.appendChild(picker);
  setTimeout(function(){
    document.addEventListener('click', function rm(){ picker.remove(); document.removeEventListener('click', rm); });
  }, 10);
}

// ── Toggle an emoji reaction on a message ────────────────────
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

// ── Typing indicator helpers ──────────────────────────────────
function _showTyping() {
  var el = document.getElementById('typing-indicator');
  if (el) el.style.display = 'flex';
  scrollBottom();
}
function _hideTyping() {
  var el = document.getElementById('typing-indicator');
  if (el) el.style.display = 'none';
}

// ── Show / hide the scroll-to-bottom floating button ─────────
function _updateScrollBtn() {
  var msgs = document.getElementById('chat-messages');
  var btn  = document.getElementById('scroll-bottom-btn');
  if (!msgs || !btn) return;
  var atBottom = msgs.scrollHeight - msgs.scrollTop - msgs.clientHeight < 80;
  btn.style.display = atBottom ? 'none' : 'flex';
}

// ── Transient toast notification ─────────────────────────────
function showToast(msg) {
  var t = document.createElement('div');
  t.style.cssText = 'position:fixed;bottom:90px;left:50%;transform:translateX(-50%);background:#0f172a;color:#fff;padding:8px 18px;border-radius:20px;font-size:13px;z-index:99999;pointer-events:none;';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(function(){ t.remove(); }, 2000);
}

// ── Format seconds into M:SS string (used by _startTimer) ────
function _fmtCallDuration(sec) {
  var m = Math.floor(sec / 60), s = sec % 60;
  return m + ':' + (s < 10 ? '0' : '') + s;
}

// ── WebSocket real-time layer ─────────────────────────────────
(function () {
  var proto = location.protocol === 'https:' ? 'wss' : 'ws';
  var ws;
  function connect() {
    var token = sessionStorage.getItem('access_token') || '';
    ws = new WebSocket(proto + '://' + location.host + '/ws?token=' + encodeURIComponent(token));
    ws.onopen  = function () {};
    ws.onclose = function () { setTimeout(connect, 3000); }; // Auto-reconnect after 3 s
    ws.onerror = function () {};
    ws.onmessage = function (e) {
      var msg; try { msg = JSON.parse(e.data); } catch (err) { return; }

      // New message pushed from the server
      if (msg.type === 'new_message') {
        var m      = msg.message;
        var convId = msg.conversation_id;
        if (m.sender_name === ME.name) return; // Ignore echoes of our own messages
        if (!localMsgs[convId]) localMsgs[convId] = [];
        localMsgs[convId].push(m);
        var conv = allConvs.find(function (c) { return c.id === convId; });
        if (conv) {
          conv.last_message    = m.content || '';
          conv.last_message_at = fmtTime(m.created_at);
          if (convId !== currentId) conv.unread_count = (conv.unread_count || 0) + 1;
        }
        if (convId === currentId) renderMsgs(localMsgs[convId]);
        updateLabel();
        renderConvList();
      }

      // Presence update (online/offline indicator)
      if (msg.type === 'presence') {
        var conv = allConvs.find(function (c) { return c.id === msg.conversation_id; });
        if (conv) { conv.online = msg.online; renderConvList(); }
      }

      // Server signals that the conversation list should be refreshed
      if (msg.type === 'conversations_update') { if (!demo) loadConvs(); }
    };
  }
  connect();
})();
