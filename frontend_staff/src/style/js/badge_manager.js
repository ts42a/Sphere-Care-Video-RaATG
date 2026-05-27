/**
 * badge_manager.js
 *
 * 管理 Sphere Care sidebar 实时 notification badges。
 * 依赖 script.js 里定义的全局变量 API_BASE = '/api/v1'
 * 必须在 notification.js 之前加载。
 */

const BadgeManager = (() => {
  const counts = { messages: 0, alerts: 0, flags: 0, total: 0 };
  let _refreshTimer = null;

  // ── DOM ────────────────────────────────────────────────────────
  function _getOrCreateBadge(anchor) {
    let badge = anchor.querySelector('.nav-badge');
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'nav-badge';
      anchor.appendChild(badge);
    }
    return badge;
  }

  function _updateDom(key, value) {
    document.querySelectorAll(`[data-badge="${key}"]`).forEach(anchor => {
      const badge = _getOrCreateBadge(anchor);
      if (value > 0) {
        badge.textContent = value > 99 ? '99+' : String(value);
        badge.style.display = '';
        badge.classList.add('nav-badge--visible');
      } else {
        badge.style.display = 'none';
        badge.classList.remove('nav-badge--visible');
      }
    });
  }

  function _applyAll() {
    ['messages', 'alerts', 'flags'].forEach(k => _updateDom(k, counts[k]));
  }

  // ── REST fetch ─────────────────────────────────────────────────
  async function refresh() {
    try {
      const token = sessionStorage.getItem('access_token') || '';
      const res = await fetch(`${API_BASE}/notifications/unread-counts`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) return;
      const data = await res.json();
      Object.assign(counts, data);
      _applyAll();
    } catch (_) {
      // badges are non-critical, fail silently
    }
  }

  // ── WebSocket handler ──────────────────────────────────────────
  function handleWsMessage(msg) {
    if (msg.type !== 'badge_update') return;
    if (msg.messages != null) counts.messages = msg.messages;
    if (msg.alerts   != null) counts.alerts   = msg.alerts;
    if (msg.flags    != null) counts.flags    = msg.flags;
    counts.total = counts.messages + counts.alerts + counts.flags;
    _applyAll();
  }

  // ── Page-level instant clear ───────────────────────────────────
  function markPageRead(key) {
    if (!(key in counts)) return;
    counts[key] = 0;
    counts.total = counts.messages + counts.alerts + counts.flags;
    _updateDom(key, 0);
    clearTimeout(_refreshTimer);
    _refreshTimer = setTimeout(refresh, 1500);
  }

  // ── Init ───────────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', refresh);
  } else {
    refresh();
  }
  setInterval(refresh, 60_000);

  return { refresh, handleWsMessage, markPageRead, counts };
})();