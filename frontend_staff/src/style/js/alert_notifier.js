/**
 * alert_notifier.js
 *
 * Polls /notifications/incoming-alerts and shows a center-screen modal + sound
 * the first time each alert appears in the session.
 */

const AlertNotifier = (() => {
  const POLL_MS = 12_000;
  const SEEN_KEY = 'spherecare_seen_alert_keys';
  const BASELINE_KEY = 'spherecare_alert_baseline_done';

  let _queue = [];
  let _showing = false;
  let _knownKeys = new Set();
  let _baselineDone = false;
  let _pollTimer = null;
  let _audioCtx = null;

  function _authHeaders() {
    const token = sessionStorage.getItem('access_token') || sessionStorage.getItem('spherecare_token') || '';
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  function _loadSeen() {
    try {
      const raw = sessionStorage.getItem(SEEN_KEY);
      if (raw) JSON.parse(raw).forEach(k => _knownKeys.add(k));
    } catch (_) {}
    _baselineDone = sessionStorage.getItem(BASELINE_KEY) === '1';
  }

  function _saveSeen() {
    sessionStorage.setItem(SEEN_KEY, JSON.stringify([..._knownKeys]));
  }

  function _ensureDom() {
    if (document.getElementById('alert-notifier-root')) return;

    const root = document.createElement('div');
    root.id = 'alert-notifier-root';
    root.innerHTML = `
      <div class="alert-notifier-backdrop" id="alert-notifier-backdrop" hidden></div>
      <div class="alert-notifier-modal" id="alert-notifier-modal" role="alertdialog" aria-modal="true" aria-labelledby="alert-notifier-title" hidden>
        <div class="alert-notifier-icon" id="alert-notifier-icon" aria-hidden="true"></div>
        <div class="alert-notifier-badge" id="alert-notifier-badge">New alert</div>
        <h2 class="alert-notifier-title" id="alert-notifier-title"></h2>
        <p class="alert-notifier-message" id="alert-notifier-message"></p>
        <div class="alert-notifier-actions">
          <button type="button" class="alert-notifier-btn alert-notifier-btn-primary" id="alert-notifier-review">Review</button>
          <button type="button" class="alert-notifier-btn alert-notifier-btn-secondary" id="alert-notifier-dismiss">Dismiss</button>
        </div>
      </div>
    `;
    document.body.appendChild(root);

    document.getElementById('alert-notifier-dismiss').addEventListener('click', _closeCurrent);
    document.getElementById('alert-notifier-backdrop').addEventListener('click', _closeCurrent);
    document.getElementById('alert-notifier-review').addEventListener('click', () => {
      const item = _queue[0];
      if (item && item.action_url) window.location.href = item.action_url;
      _closeCurrent();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && _showing) _closeCurrent();
    });
  }

  function _playAlertSound() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      if (!_audioCtx) _audioCtx = new Ctx();
      if (_audioCtx.state === 'suspended') _audioCtx.resume();

      const now = _audioCtx.currentTime;
      const tones = [
        { freq: 880, start: 0, dur: 0.18 },
        { freq: 660, start: 0.22, dur: 0.28 },
      ];

      tones.forEach(({ freq, start, dur }) => {
        const osc = _audioCtx.createOscillator();
        const gain = _audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, now + start);
        gain.gain.exponentialRampToValueAtTime(0.35, now + start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + start + dur);
        osc.connect(gain);
        gain.connect(_audioCtx.destination);
        osc.start(now + start);
        osc.stop(now + start + dur + 0.05);
      });
    } catch (_) {}
  }

  function _severityClass(severity) {
    const s = String(severity || '').toLowerCase();
    if (s === 'critical') return 'alert-notifier--critical';
    if (s === 'high') return 'alert-notifier--high';
    return 'alert-notifier--medium';
  }

  function _iconFor(severity) {
    const s = String(severity || '').toLowerCase();
    const stroke = s === 'critical' ? '#ef4444' : s === 'high' ? '#f59e0b' : '#3b82f6';
    return `<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="${stroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
  }

  function _showNext() {
    if (_showing || !_queue.length) return;
    _showing = true;
    _ensureDom();

    const item = _queue.shift();
    const modal = document.getElementById('alert-notifier-modal');
    const backdrop = document.getElementById('alert-notifier-backdrop');
    const titleEl = document.getElementById('alert-notifier-title');
    const msgEl = document.getElementById('alert-notifier-message');
    const iconEl = document.getElementById('alert-notifier-icon');
    const badgeEl = document.getElementById('alert-notifier-badge');

    modal.className = `alert-notifier-modal ${_severityClass(item.severity)}`;
    titleEl.textContent = item.title || 'New alert';
    msgEl.textContent = item.message || '';
    iconEl.innerHTML = _iconFor(item.severity);
    badgeEl.textContent = item.alert_type === 'flag' ? 'AI flag' : item.alert_type === 'camera' ? 'Camera alert' : 'New alert';

    backdrop.hidden = false;
    modal.hidden = false;
    requestAnimationFrame(() => {
      backdrop.classList.add('alert-notifier-backdrop--visible');
      modal.classList.add('alert-notifier-modal--visible');
    });

    _playAlertSound();
    if (typeof BadgeManager !== 'undefined' && BadgeManager.refresh) {
      BadgeManager.refresh();
    }
  }

  function _closeCurrent() {
    const modal = document.getElementById('alert-notifier-modal');
    const backdrop = document.getElementById('alert-notifier-backdrop');
    if (!modal || !backdrop) {
      _showing = false;
      _showNext();
      return;
    }

    modal.classList.remove('alert-notifier-modal--visible');
    backdrop.classList.remove('alert-notifier-backdrop--visible');
    setTimeout(() => {
      modal.hidden = true;
      backdrop.hidden = true;
      _showing = false;
      _showNext();
    }, 220);
  }

  function _enqueueNew(items) {
    items.forEach(item => {
      if (!item || !item.key || _knownKeys.has(item.key)) return;
      _knownKeys.add(item.key);
      _queue.push(item);
    });
    _saveSeen();
    _showNext();
  }

  async function poll() {
    const token = sessionStorage.getItem('access_token') || sessionStorage.getItem('spherecare_token');
    if (!token) return;

    const apiBase = typeof API_BASE !== 'undefined' ? API_BASE : '/api/v1';
    try {
      const res = await fetch(`${apiBase}/notifications/incoming-alerts`, {
        headers: _authHeaders(),
      });
      if (!res.ok) return;
      const items = await res.json();

      if (!_baselineDone) {
        items.forEach(item => {
          if (item && item.key) _knownKeys.add(item.key);
        });
        _saveSeen();
        sessionStorage.setItem(BASELINE_KEY, '1');
        _baselineDone = true;
        return;
      }

      const fresh = items.filter(item => item && item.key && !_knownKeys.has(item.key));
      if (fresh.length) _enqueueNew(fresh);
    } catch (_) {}
  }

  function start() {
    if (window.location.pathname.includes('register-login')) return;

    _loadSeen();
    _ensureDom();
    poll();
    if (_pollTimer) clearInterval(_pollTimer);
    _pollTimer = setInterval(poll, POLL_MS);
  }

  function resetBaseline() {
    sessionStorage.removeItem(BASELINE_KEY);
    sessionStorage.removeItem(SEEN_KEY);
    _knownKeys.clear();
    _baselineDone = false;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  return { poll, start, resetBaseline };
})();
