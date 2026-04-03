/**
 * Sphere Care – Shared WebSocket Client
 *
 * Works with ALL existing pages:
 *   - message.js, booking.js, notification.js
 *   - Uses sessionStorage keys:  access_token  /  user
 *     (same keys written by script.js + register_login.js)
 *   - Connects to your FastAPI backend:  ws://host/ws?token=...
 *
 * Each page still does its own REST calls via fetch() + API_BASE as before.
 * This file ONLY handles the shared WebSocket connection + event bus.
 *
 * Usage in any page:
 *   SC.on('new_message',    function(msg){ ... });
 *   SC.on('booking_updated',function(msg){ ... });
 *   SC.on('ai_alert',       function(msg){ ... });
 *   SC.send({ type: 'ping' });
 *   SC.isConnected();
 */
window.SC = (function () {

  var ws            = null;
  var reconnectTimer = null;
  var connected     = false;
  var listeners     = {};

  // ── Token: reads the same key that script.js + register_login.js write 
  function getToken() {
    return sessionStorage.getItem('access_token') ||
           sessionStorage.getItem('spherecare_token') ||
           '';
  }

  //  Connect 
  function connect() {
    var t = getToken();
    if (!t) return; // not logged in yet

    // Don't double-connect
    if (ws && (ws.readyState === WebSocket.CONNECTING ||
               ws.readyState === WebSocket.OPEN)) return;

    var proto = location.protocol === 'https:' ? 'wss' : 'ws';
    // FastAPI backend expects token as query param: /ws?token=...
    ws = new WebSocket(proto + '://' + location.host + '/ws?token=' + encodeURIComponent(t));

    ws.onopen = function () {
      connected = true;
      clearTimeout(reconnectTimer);
      emit('_connected');
    };

    ws.onmessage = function (event) {
      var msg;
      try { msg = JSON.parse(event.data); } catch (e) { return; }
      if (!msg || !msg.type) return;
      emit(msg.type, msg);
    };

    ws.onclose = function () {
      connected = false;
      emit('_disconnected');
      // Auto-reconnect after 3s
      reconnectTimer = setTimeout(connect, 3000);
    };

    ws.onerror = function () {
      // onclose fires after onerror, reconnect handled there
    };
  }

  //  Send 
  function send(msg) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  //  Event bus 
  function on(type, fn) {
    if (!listeners[type]) listeners[type] = [];
    listeners[type].push(fn);
  }

  function off(type, fn) {
    if (!listeners[type]) return;
    listeners[type] = listeners[type].filter(function (f) { return f !== fn; });
  }

  function emit(type, data) {
    (listeners[type] || []).forEach(function (fn) { fn(data); });
  }

  //  Auto-connect on page load if already logged in
  if (getToken()) connect();

  //Public API
  return {
    connect:     connect,
    send:        send,
    on:          on,
    off:         off,
    isConnected: function () { return connected; },
    getToken:    getToken,
  };

})();