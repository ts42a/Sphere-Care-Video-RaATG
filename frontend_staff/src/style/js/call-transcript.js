/**
 * style/js/call-transcript.js
 *
 * Web (staff/admin browser) side of the ASR + ASL transcript system.
 *
 * Responsibilities:
 *   1. Record microphone in 2-second chunks → send as audio_chunk WS message
 *   2. Capture video frames at ~2fps → send as asl_frame WS message
 *   3. Receive call.caption and call.asl.result → render in transcript panel
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

  let _mediaRecorder  = null;
  let _audioStream    = null;
  let _chunkInterval  = null;
  let _frameInterval  = null;
  let _offscreenCanvas = null;
  let _offscreenCtx    = null;

  const CHUNK_INTERVAL_MS  = 2000;   // audio chunk every 2s
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

  function _appendItem({ speaker, text, type, timestamp }) {
    if (!_panelEl) return;

    const item = document.createElement("div");
    item.className = `transcript-item ${type}`;
    item.innerHTML = `
      <span class="transcript-speaker">${_escHtml(speaker)}</span>
      <span class="transcript-text">${_escHtml(text)}</span>
      <span class="transcript-time">${_escHtml(timestamp)}</span>
    `;
    _panelEl.appendChild(item);

    // Auto-scroll
    _panelEl.scrollTop = _panelEl.scrollHeight;

    // Trim old items (keep last 100)
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

  // ── Audio recording ────────────────────────────────────────────────────

  async function _startAudio() {
    try {
      _audioStream = await navigator.mediaDevices.getUserMedia({
        audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true },
        video: false,
      });
    } catch (err) {
      console.warn("[CallTranscript] Mic access denied:", err);
      return;
    }

    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : "audio/webm";

    const startRecorder = () => {
      if (!_enabled) return;

      const chunks = [];
      const recorder = new MediaRecorder(_audioStream, { mimeType });

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunks.push(e.data);
      };

      recorder.onstop = async () => {
        if (!chunks.length || !_enabled) return;

        const blob = new Blob(chunks, { type: mimeType });
        const arrayBuffer = await blob.arrayBuffer();
        const b64 = _arrayBufferToBase64(arrayBuffer);

        _send({
          type: "audio_chunk",
          payload: {
            call_id: String(_callId),
            audio_b64: b64,
            language: null, // auto-detect
          },
        });
      };

      recorder.start();
      _mediaRecorder = recorder;

      // Stop after chunk interval → triggers onstop → sends chunk
      setTimeout(() => {
        try {
          if (recorder.state === "recording") recorder.stop();
        } catch (_) {}
      }, CHUNK_INTERVAL_MS);
    };

    startRecorder();
    _chunkInterval = setInterval(startRecorder, CHUNK_INTERVAL_MS);
  }

  function _stopAudio() {
    if (_chunkInterval) { clearInterval(_chunkInterval); _chunkInterval = null; }
    if (_mediaRecorder && _mediaRecorder.state === "recording") {
      try { _mediaRecorder.stop(); } catch (_) {}
    }
    _mediaRecorder = null;
    if (_audioStream) {
      _audioStream.getTracks().forEach((t) => t.stop());
      _audioStream = null;
    }
  }

  function _arrayBufferToBase64(buffer) {
    let binary = "";
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
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
      _appendItem({
        speaker: p.speaker || "Staff",
        text:    p.text,
        type:    "asr",
        timestamp: _ts(p.ts),
      });
    }

    if (msg.type === "call.asl.result" && msg.payload) {
      const p = msg.payload;
      if (String(p.call_id) !== String(_callId)) return;
      _appendItem({
        speaker:   p.speaker || "ASL",
        text:      p.word ? `[ASL] ${p.word}` : `[ASL] ${p.letter}`,
        type:      "asl",
        timestamp: _ts(p.ts),
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

    await _startAudio();
    _startFrameCapture();
  }

  function stop() {
    _enabled = false;
    _stopAudio();
    _stopFrameCapture();
    if (_ws) _ws.removeEventListener("message", _onMessage);
    _ws     = null;
    _callId = null;
  }

  function setEnabled(val) {
    _enabled = val;
    if (!val) {
      _stopAudio();
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