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
import re
import time
import uuid
from difflib import SequenceMatcher
from typing import Optional

from backend.ws.ws_manager import ws_manager

logger = logging.getLogger(__name__)

# In-memory caption accumulator keyed by call_id (str).
# Populated by broadcast_caption; consumed once by get_and_clear_transcript.
_call_captions: dict[str, list[str]] = {}
# Recent normalized captions keyed by call_id. Used to suppress overlap duplicates.
_recent_captions: dict[str, list[tuple[str, str]]] = {}


def _sid() -> str:
    return str(uuid.uuid4())


def _clean_caption_text(text: str) -> str:
    text = " ".join(str(text or "").replace("\n", " ").split())
    text = re.sub(r"\[\s*\d+\s*\]", "", text).strip()
    return text


def _normalise_caption(text: str) -> str:
    text = _clean_caption_text(text).lower()
    text = re.sub(r"[^a-z0-9\s]", "", text)
    return " ".join(text.split())


def _safe_speaker_label(speaker_name: Optional[str], speaker: str) -> str:
    label = str(speaker_name or speaker or "").strip()
    # LiveKit identities in this project are often numeric IDs. Do not store
    # them in the transcript used for AI summary because they pollute the model.
    if not label or re.fullmatch(r"\d+", label):
        return ""
    if label.lower().startswith(("usr_", "client_", "staff_", "asr_agent_")):
        return ""
    return label


def _is_duplicate_caption(call_id: str, speaker_key: str, text: str) -> bool:
    norm = _normalise_caption(text)
    if not norm:
        return True
    recent = _recent_captions.setdefault(str(call_id), [])
    for prev_speaker, prev_norm in reversed(recent[-6:]):
        if prev_speaker != speaker_key or not prev_norm:
            continue
        if norm == prev_norm:
            return True
        # Overlap chunks often repeat almost the same phrase.
        score = SequenceMatcher(None, norm, prev_norm).ratio()
        if score >= 0.92:
            return True
        shorter, longer = sorted((norm, prev_norm), key=len)
        if len(shorter) >= 12 and shorter in longer and len(shorter) / max(len(longer), 1) >= 0.65:
            return True
    recent.append((speaker_key, norm))
    if len(recent) > 20:
        del recent[:-20]
    return False


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
    text = _clean_caption_text(text)
    if not text:
        return

    # Suppress duplicate captions created by the ASR overlap window.
    key = str(call_id)
    speaker_key = str(speaker_id or speaker or "unknown")
    if _is_duplicate_caption(key, speaker_key, text):
        logger.debug("[transcript] duplicate caption skipped call=%s speaker=%s text=%s", call_id, speaker_key, text[:60])
        return

    # Accumulate for post-call AI summary. Avoid raw numeric labels like [5].
    if key not in _call_captions:
        _call_captions[key] = []
    label = _safe_speaker_label(speaker_name, speaker)
    _call_captions[key].append(f"[{label}] {text}".strip() if label else text)

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