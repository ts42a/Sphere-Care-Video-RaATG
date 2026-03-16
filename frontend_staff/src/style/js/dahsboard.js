// ── GOOGLE OAUTH TOKEN HANDLER ──
(function handleOAuthToken() {
  const params = new URLSearchParams(window.location.search);
  const token  = params.get('token');
  if (token) {
    localStorage.setItem('access_token', token);
    window.history.replaceState({}, document.title, window.location.pathname);
  }
})();
// ── DASHBOARD MESSAGES WIDGET ──
(function() {
  // Avatar colour palette (matches message.js)
  var AVATAR_COLORS = ['#2ec4b6','#7c3aed','#db2777','#059669','#d97706','#0369a1','#dc2626','#9333ea'];
  var colorMap = {}, colorIdx = 0;

  function avatarColor(name) {
    if (!colorMap[name]) colorMap[name] = AVATAR_COLORS[colorIdx++ % AVATAR_COLORS.length];
    return colorMap[name];
  }

  function initials(name) {
    return (name || '?').split(' ').map(function(w){ return w[0]; }).join('').toUpperCase().slice(0,2);
  }

  function authHeaders() {
    var h = { 'Content-Type': 'application/json' };
    var t = localStorage.getItem('access_token');
    if (t) h['Authorization'] = 'Bearer ' + t;
    return h;
  }

  function esc(s) {
    return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function timeAgo(raw) {
    if (!raw) return '';
    // If it's already a short formatted string like "9:32 AM" or "2h ago", return as-is
    if (typeof raw === 'string' && raw.length < 20 && !/^\d{4}-/.test(raw)) return raw;
    try {
      var diff = Math.floor((Date.now() - new Date(raw).getTime()) / 60000); // minutes
      if (diff < 1)  return 'Just now';
      if (diff < 60) return diff + 'm ago';
      if (diff < 1440) return Math.floor(diff/60) + 'h ago';
      return Math.floor(diff/1440) + 'd ago';
    } catch(e) { return raw; }
  }

  function renderDashboardMsgs(convs) {
    var el = document.getElementById('dashboard-msg-list');
    if (!el) return;

    // Show top 3 convs with a last message
    var items = convs.filter(function(c){ return c.last_message; }).slice(0, 3);

    if (!items.length) {
      el.innerHTML = '<div style="text-align:center;padding:16px 0;color:var(--text3);font-size:12px;">No messages yet</div>';
      return;
    }

    el.innerHTML = items.map(function(c) {
      var color = avatarColor(c.name);
      var badge = c.unread_count > 0
        ? '<span style="background:var(--red);color:#fff;border-radius:10px;font-size:10px;font-weight:700;padding:1px 6px;margin-left:6px;">' + c.unread_count + '</span>'
        : '';
      return '<div class="msg-item" style="cursor:pointer;" onclick="window.location.href=\'message.html\'">'
        + '<div class="msg-avatar" style="background:' + color + ';width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:#fff;flex-shrink:0;">'
        + esc(initials(c.name))
        + '</div>'
        + '<div style="flex:1;min-width:0;">'
        + '<div style="display:flex;align-items:center;">'
        + '<span class="msg-name" style="' + (c.unread_count > 0 ? 'font-weight:800;' : '') + '">' + esc(c.name) + '</span>'
        + badge
        + '<span class="msg-time" style="margin-left:auto;">' + esc(timeAgo(c.last_message_at)) + '</span>'
        + '</div>'
        + '<div class="msg-text" style="' + (c.unread_count > 0 ? 'color:var(--text);font-weight:600;' : '') + 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">'
        + esc(c.last_message)
        + '</div>'
        + '</div>'
        + '</div>';
    }).join('');
  }

  async function loadDashboardMessages() {
    var el = document.getElementById('dashboard-msg-list');
    if (!el) return;

    try {
      var base = (typeof API_BASE !== 'undefined') ? API_BASE : '';
      var res = await fetch(base + '/messages/conversations', { headers: authHeaders() });
      if (!res.ok) throw new Error('not ok');
      var convs = await res.json();
      renderDashboardMsgs(convs);
    } catch(e) {
      // Fallback: show static placeholder if API fails
      if (el) el.innerHTML = [
        { name:'Care Team', last_message:'All residents checked in.', last_message_at:'1h ago', unread_count:0 },
        { name:'Night Shift', last_message:'Handover notes updated.', last_message_at:'3h ago', unread_count:2 },
        { name:'Admin Team', last_message:'Monthly report is ready.', last_message_at:'6h ago', unread_count:0 },
      ].map(function(c) {
        var color = avatarColor(c.name);
        var badge = c.unread_count > 0
          ? '<span style="background:var(--red);color:#fff;border-radius:10px;font-size:10px;font-weight:700;padding:1px 6px;margin-left:6px;">' + c.unread_count + '</span>'
          : '';
        return '<div class="msg-item">'
          + '<div class="msg-avatar" style="background:' + color + ';width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:#fff;flex-shrink:0;">'
          + esc(initials(c.name)) + '</div>'
          + '<div style="flex:1;min-width:0;">'
          + '<div style="display:flex;align-items:center;"><span class="msg-name">' + esc(c.name) + '</span>' + badge
          + '<span class="msg-time" style="margin-left:auto;">' + esc(c.last_message_at) + '</span></div>'
          + '<div class="msg-text">' + esc(c.last_message) + '</div>'
          + '</div></div>';
      }).join('');
    }
  }

  // Run on page load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadDashboardMessages);
  } else {
    loadDashboardMessages();
  }

  // Auto-refresh every 30 seconds
  setInterval(loadDashboardMessages, 30000);
})();