/**
 * style/js/call-transcript.js
 *
 * Web (staff/admin browser) side of the ASR + ASL transcript system.
 *
 * Responsibilities:
 *   1. Capture video frames at ~2fps → send as asl_frame WS message
 *   2. Receive backend-broadcast call.caption and call.asl.result events
 *   3. Upsert interim/final transcript segments by segment_id
 *
 * Audio is no longer recorded in the browser for ASR. The backend now owns ASR
 * by subscribing to LiveKit room audio, so staff and client render the same
 * transcript stream.
 *
 * HOW TO INITIALISE (call this once the call becomes active):
 *
 *   CallTranscript.start({
 *     ws,           // your existing WebSocket instance
 *     callId,       // string or number
 *     videoEl,      // <video> element showing the local/remote feed (for frame capture)
 *     panelEl,      // <div> where transcript items are appended
 *     enabled: true
 *   });
 *
 *   // When call ends:
 *   CallTranscript.stop();
 *
 * The transcript panel renders items like:
 *   <div class="transcript-item asr">
 *     <span class="transcript-speaker">usr_42</span>
 *     <span class="transcript-text">Hello how are you</span>
 *     <span class="transcript-time">12:34:05</span>
 *   </div>
 */

const CallTranscript = (() => {
  // ── State ──────────────────────────────────────────────────────────────
  let _ws       = null;
  let _callId   = null;
  let _panelEl  = null;
  let _videoEl  = null;
  let _enabled  = false;

  let _frameInterval  = null;
  let _offscreenCanvas = null;
  let _offscreenCtx    = null;

  const FRAME_INTERVAL_MS  = 500;    // ASL frame every 500ms (~2fps)
  const ASL_MODE           = "static"; // "static" | "motion"

  // ── Helpers ────────────────────────────────────────────────────────────
  function _ts(unixSec) {
    const d = new Date(unixSec * 1000);
    return [d.getHours(), d.getMinutes(), d.getSeconds()]
      .map((n) => String(n).padStart(2, "0"))
      .join(":");
  }

  function _send(msg) {
    if (_ws && _ws.readyState === WebSocket.OPEN) {
      _ws.send(JSON.stringify(msg));
    }
  }

  function _upsertItem({ segmentId, speaker, text, type, timestamp, isFinal = true }) {
    if (!_panelEl) return;

    const selector = segmentId ? `[data-segment-id="${CSS.escape(String(segmentId))}"]` : null;
    let item = selector ? _panelEl.querySelector(selector) : null;

    if (!item) {
      item = document.createElement("div");
      item.className = `transcript-item ${type}`;
      if (segmentId) item.dataset.segmentId = String(segmentId);
      _panelEl.appendChild(item);
    }

    item.className = `transcript-item ${type}${isFinal ? " final" : " interim"}`;
    item.innerHTML = `
      <span class="transcript-speaker">${_escHtml(speaker)}</span>
      <span class="transcript-text">${_escHtml(text)}</span>
      <span class="transcript-time">${_escHtml(timestamp)}</span>
    `;

    _panelEl.scrollTop = _panelEl.scrollHeight;

    while (_panelEl.children.length > 100) {
      _panelEl.removeChild(_panelEl.firstChild);
    }
  }

  function _escHtml(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  // ── ASL frame capture ──────────────────────────────────────────────────

  function _startFrameCapture() {
    if (!_videoEl) return;

    _offscreenCanvas = document.createElement("canvas");
    _offscreenCanvas.width  = 320;
    _offscreenCanvas.height = 240;
    _offscreenCtx = _offscreenCanvas.getContext("2d");

    _frameInterval = setInterval(() => {
      if (!_enabled || !_videoEl || _videoEl.readyState < 2) return;

      try {
        _offscreenCtx.drawImage(
          _videoEl, 0, 0,
          _offscreenCanvas.width, _offscreenCanvas.height
        );

        // Export as JPEG (smaller than PNG)
        const dataUrl = _offscreenCanvas.toDataURL("image/jpeg", 0.6);
        const b64 = dataUrl.split(",")[1];
        if (!b64) return;

        _send({
          type: "asl_frame",
          payload: {
            call_id: String(_callId),
            image_b64: b64,
            mode: ASL_MODE,
            motion_seq: [],
          },
        });
      } catch (err) {
        console.warn("[CallTranscript] Frame capture error:", err);
      }
    }, FRAME_INTERVAL_MS);
  }

  function _stopFrameCapture() {
    if (_frameInterval) { clearInterval(_frameInterval); _frameInterval = null; }
    _offscreenCanvas = null;
    _offscreenCtx    = null;
  }

  // ── WebSocket message handler ──────────────────────────────────────────

  function _onMessage(event) {
    let msg;
    try { msg = JSON.parse(event.data); } catch (_) { return; }

    if (msg.type === "call.caption" && msg.payload) {
      const p = msg.payload;
      if (String(p.call_id) !== String(_callId)) return;
      _upsertItem({
        segmentId: p.segment_id,
        speaker: p.speaker_name || p.speaker || "Unknown speaker",
        text: p.text,
        type: "asr",
        timestamp: _ts(p.ts),
        isFinal: p.is_final !== false,
      });
    }

    if (msg.type === "call.asl.result" && msg.payload) {
      const p = msg.payload;
      if (String(p.call_id) !== String(_callId)) return;
      _upsertItem({
        segmentId: p.segment_id,
        speaker: p.speaker || "ASL",
        text: p.word ? `[ASL] ${p.word}` : `[ASL] ${p.letter}`,
        type: "asl",
        timestamp: _ts(p.ts),
        isFinal: true,
      });
    }
  }

  // ── Public API ─────────────────────────────────────────────────────────

  async function start({ ws, callId, videoEl, panelEl, enabled = true }) {
    _ws      = ws;
    _callId  = callId;
    _videoEl = videoEl || null;
    _panelEl = panelEl || null;
    _enabled = enabled;

    if (!_enabled) return;

    _ws.addEventListener("message", _onMessage);

    _startFrameCapture();
  }

  function stop() {
    _enabled = false;
    _stopFrameCapture();
    if (_ws) _ws.removeEventListener("message", _onMessage);
    _ws     = null;
    _callId = null;
  }

  function setEnabled(val) {
    _enabled = val;
    if (!val) {
      _stopFrameCapture();
    }
  }

  return { start, stop, setEnabled };
})();

// ── CSS to add to your call page stylesheet ────────────────────────────────
/*
.transcript-item {
  display: flex;
  gap: 8px;
  align-items: baseline;
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 13px;
  margin-bottom: 4px;
}

.transcript-item.asr  { background: rgba(59,130,246,0.08); }
.transcript-item.asl  { background: rgba(139,92,246,0.10); }

.transcript-speaker {
  font-weight: 700;
  color: #3b82f6;
  min-width: 60px;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.transcript-item.asl .transcript-speaker { color: #8b5cf6; }

.transcript-text {
  flex: 1;
  color: #1e293b;
}

.transcript-time {
  font-size: 11px;
  color: #94a3b8;
  white-space: nowrap;
}
*/