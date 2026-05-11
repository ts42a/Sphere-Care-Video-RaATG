"""
backend/services/transcript_service.py

Handles two side-channel transcript streams for active calls:
  1. ASR  — Whisper speech-to-text
  2. ASL  — Gesture recognition from asl.py

Both broadcast via existing ws_manager.broadcast_call(call_id, payload)
so all call_watchers in the room receive them simultaneously.

WebSocket event shapes (received by both Expo and Web clients):

  call.caption  (ASR):
  {
    "type": "call.caption",
    "payload": {
      "call_id": "123",
      "segment_id": "uuid",
      "speaker": "usr_42",
      "text": "Hello how are you",
      "language": "en",
      "confidence": 0.92,
      "ts": 1715000002.4,
      "is_final": true
    }
  }

  call.asl.result  (ASL gesture):
  {
    "type": "call.asl.result",
    "payload": {
      "call_id": "123",
      "segment_id": "uuid",
      "speaker": "usr_42",
      "letter": "H",
      "word": "HELLO",          // null if only letter detected
      "confidence": 0.88,
      "mode": "static",         // "static" | "motion"
      "ts": 1715000005.0
    }
  }
"""

from __future__ import annotations

import logging
import time
import uuid
from typing import Optional

from backend.ws.ws_manager import ws_manager

logger = logging.getLogger(__name__)


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
) -> None:
    """
    Broadcast an ASR transcript segment to all participants in the call room.
    Called from ws.py after Whisper returns a result.
    """
    if not text:
        return

    payload = {
        "type": "call.caption",
        "payload": {
            "call_id": call_id,
            "segment_id": _sid(),
            "speaker": speaker,
            "text": text,
            "language": language,
            "confidence": round(confidence, 3),
            "ts": ts or time.time(),
            "is_final": is_final,
        },
    }

    await ws_manager.broadcast_call(call_id, payload)
    logger.debug(f"[transcript] call.caption → {call_id}: {text[:60]}")


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
    """
    Broadcast an ASL gesture result to all participants in the call room.
    Called from ws.py after the frontend sends an asl_frame message
    and asl.py returns a detection result.
    """
    if not letter:
        return

    payload = {
        "type": "call.asl.result",
        "payload": {
            "call_id": call_id,
            "segment_id": _sid(),
            "speaker": speaker,
            "letter": letter,
            "word": word,
            "confidence": round(confidence, 3),
            "mode": mode,
            "ts": ts or time.time(),
        },
    }

    await ws_manager.broadcast_call(call_id, payload)
    logger.debug(f"[transcript] call.asl.result → {call_id}: {letter}")