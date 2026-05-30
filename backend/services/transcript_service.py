"""
backend/services/transcript_service.py

Broadcasts call transcript side-channel events to every watcher in the same call.

`call.caption` is intentionally shaped for both the current chunked Whisper flow
and a future streaming STT flow:

  {
    "type": "call.caption",
    "payload": {
      "call_id": "123",
      "segment_id": "uuid-or-provider-segment-id",
      "speaker": "usr_42",              # backwards-compatible display key
      "speaker_id": "usr_42",           # stable machine-readable identity
      "speaker_name": "Sarah Nurse",    # optional display name
      "participant_role": "staff",      # optional
      "text": "Hello how are you",
      "language": "en",
      "confidence": 0.92,
      "ts": 1715000002.4,
      "is_final": true
    }
  }

For phase A, every caption is final. A future streaming STT engine can reuse the
same event and emit interim updates by keeping the same `segment_id` while
setting `is_final=false`, then send one final update with `is_final=true`.
"""

from __future__ import annotations

import logging
import time
import uuid
from typing import Optional

from backend.ws.ws_manager import ws_manager

logger = logging.getLogger(__name__)

# In-memory caption accumulator keyed by call_id (str).
# Populated by broadcast_caption; consumed once by get_and_clear_transcript.
_call_captions: dict[str, list[str]] = {}


def _sid() -> str:
    return str(uuid.uuid4())


async def broadcast_caption(
    *,
    call_id: str,
    speaker: str,
    text: str,
    language: str = "en",
    confidence: float = 1.0,
    ts: Optional[float] = None,
    is_final: bool = True,
    segment_id: Optional[str] = None,
    speaker_id: Optional[str] = None,
    speaker_name: Optional[str] = None,
    participant_role: Optional[str] = None,
    modality: str = "speech",
) -> None:
    """Broadcast one ASR/ASL transcript segment to all participants in the call.

    ``modality`` distinguishes the caption source on the frontend:
      - ``"speech"``  — Whisper ASR (default, backwards-compatible)
      - ``"asl"``     — ASL detection via livekit_asl_service
    """
    if not text:
        return

    # Accumulate for post-call AI summary
    key = str(call_id)
    if key not in _call_captions:
        _call_captions[key] = []
    label = f"[{speaker_name or speaker}]" if (speaker_name or speaker) else ""
    _call_captions[key].append(f"{label} {text}".strip())

    payload = {
        "type": "call.caption",
        "payload": {
            "call_id": str(call_id),
            "segment_id": segment_id or _sid(),
            "speaker": speaker,
            "speaker_id": speaker_id or speaker,
            "speaker_name": speaker_name,
            "participant_role": participant_role,
            "text": text,
            "language": language,
            "confidence": round(confidence, 3),
            "ts": ts or time.time(),
            "is_final": is_final,
            "modality": modality,
        },
    }

    await ws_manager.broadcast_call(str(call_id), payload)
    logger.debug(
        "[transcript] call.caption → %s [%s]: %s",
        call_id,
        "final" if is_final else "interim",
        text[:60],
    )


async def broadcast_asl_result(
    *,
    call_id: str,
    speaker: str,
    letter: str,
    word: Optional[str] = None,
    confidence: float = 1.0,
    mode: str = "static",
    ts: Optional[float] = None,
) -> None:
    """Broadcast an ASL gesture result to all participants in the call room."""
    if not letter:
        return

    payload = {
        "type": "call.asl.result",
        "payload": {
            "call_id": str(call_id),
            "segment_id": _sid(),
            "speaker": speaker,
            "letter": letter,
            "word": word,
            "confidence": round(confidence, 3),
            "mode": mode,
            "ts": ts or time.time(),
        },
    }

    await ws_manager.broadcast_call(str(call_id), payload)
    logger.debug("[transcript] call.asl.result → %s: %s", call_id, letter)


def get_and_clear_transcript(call_id: "str | int") -> str:
    """Return accumulated caption text for a call and remove it from memory."""
    return "\n".join(_call_captions.pop(str(call_id), []))