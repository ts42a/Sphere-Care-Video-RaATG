"""
backend/services/livekit_asr_service.py

Phase A LiveKit ASR worker.

The worker joins an active LiveKit room as a backend participant, subscribes to
remote audio tracks, buffers a few seconds of PCM, converts that buffer to WAV,
runs the existing Whisper service, and broadcasts final `call.caption` events.

This service deliberately isolates three concerns so phase B can later swap only
the transcription engine:
  1. LiveKit media subscription
  2. Audio buffering / chunking
  3. Transcript broadcasting

A future streaming STT engine can keep the same `call.caption` payload and emit
interim updates by reusing `segment_id` with `is_final=False`.
"""

from __future__ import annotations

import asyncio
import io
import logging
import os
import wave
import audioop
from dataclasses import dataclass, field
from datetime import timedelta
from typing import Dict, Optional

from backend.services import asr_service, transcript_service

logger = logging.getLogger(__name__)

SAMPLE_RATE = int(os.getenv("ASR_SAMPLE_RATE", "16000"))
NUM_CHANNELS = int(os.getenv("ASR_NUM_CHANNELS", "1"))
CHUNK_SECONDS = float(os.getenv("ASR_CHUNK_SECONDS", "1.5"))
MIN_CHUNK_BYTES = int(SAMPLE_RATE * NUM_CHANNELS * 2 * CHUNK_SECONDS)
MIN_RMS = int(os.getenv("ASR_MIN_RMS", "350"))
MIN_VOICE_BYTES = int(SAMPLE_RATE * NUM_CHANNELS * 2 * 1.0)


def _pcm16_to_wav_bytes(pcm_bytes: bytes) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wav_file:
        wav_file.setnchannels(NUM_CHANNELS)
        wav_file.setsampwidth(2)  # int16 PCM
        wav_file.setframerate(SAMPLE_RATE)
        wav_file.writeframes(pcm_bytes)
    return buf.getvalue()


def _mint_worker_token(room_id: str, identity: str) -> Optional[str]:
    import os

    lk_key = os.getenv("LIVEKIT_API_KEY")
    lk_secret = os.getenv("LIVEKIT_API_SECRET")

    if not lk_key or not lk_secret:
        logger.info("[livekit-asr] LIVEKIT_API_KEY or LIVEKIT_API_SECRET is missing")
        return None

    try:
        from livekit.api import AccessToken, VideoGrants

        return (
            AccessToken(lk_key, lk_secret)
            .with_identity(identity)
            .with_name("ASR Worker")
            .with_grants(
                VideoGrants(
                    room_join=True,
                    room=room_id,
                    can_subscribe=True,
                    can_publish=False,
                    can_publish_data=True,
                )
            )
            .to_jwt()
        )
    except Exception as exc:
        logger.warning("[livekit-asr] unable to mint worker token: %s", exc)
        return None
    
def _is_silence_or_too_short(pcm_bytes: bytes) -> bool:
    if not pcm_bytes or len(pcm_bytes) < MIN_VOICE_BYTES:
        return True

    try:
        rms = audioop.rms(pcm_bytes, 2)
    except Exception:
        return True

    if rms < MIN_RMS:
        logger.debug("[livekit-asr] skip silent chunk rms=%s bytes=%s", rms, len(pcm_bytes))
        return True

    return False


@dataclass
class _TrackState:
    participant_identity: str
    participant_name: str
    task: asyncio.Task


@dataclass
class _CallWorker:
    call_id: str
    room_id: str
    room: object
    track_tasks: Dict[str, _TrackState] = field(default_factory=dict)


class LiveKitAsrManager:
    """Manages one backend ASR participant per active call."""

    def __init__(self) -> None:
        self._workers: Dict[str, _CallWorker] = {}
        self._lock = asyncio.Lock()

    async def start_call(self, *, call_id: str | int, room_id: str, livekit_url: Optional[str]) -> bool:
        call_key = str(call_id)
        if not livekit_url:
            logger.info("[livekit-asr] skipped call %s because LIVEKIT_URL is missing", call_key)
            return False

        async with self._lock:
            if call_key in self._workers:
                return True

            token = _mint_worker_token(room_id, f"asr_agent_{call_key}")
            if not token:
                logger.info("[livekit-asr] skipped call %s because worker token is unavailable", call_key)
                return False

            try:
                from livekit import rtc
            except ImportError:
                logger.warning("[livekit-asr] livekit package is not installed; worker not started")
                return False

            room = rtc.Room()
            worker = _CallWorker(call_id=call_key, room_id=room_id, room=room)

            @room.on("track_subscribed")
            def _on_track_subscribed(track, publication, participant) -> None:
                try:
                    if track.kind != rtc.TrackKind.KIND_AUDIO:
                        return
                except Exception:
                    return

                if str(getattr(participant, "identity", "")).startswith("asr_agent_"):
                    return

                track_sid = str(getattr(publication, "sid", id(track)))
                if track_sid in worker.track_tasks:
                    return

                task = asyncio.create_task(
                    self._consume_audio_track(
                        call_id=call_key,
                        track=track,
                        participant_identity=str(getattr(participant, "identity", "unknown")),
                        participant_name=str(getattr(participant, "name", "") or getattr(participant, "identity", "unknown")),
                    )
                )
                worker.track_tasks[track_sid] = _TrackState(
                    participant_identity=str(getattr(participant, "identity", "unknown")),
                    participant_name=str(getattr(participant, "name", "") or getattr(participant, "identity", "unknown")),
                    task=task,
                )
                logger.info(
                    "[livekit-asr] subscribed call=%s track=%s participant=%s",
                    call_key,
                    track_sid,
                    getattr(participant, "identity", "unknown"),
                )

            @room.on("track_unsubscribed")
            def _on_track_unsubscribed(track, publication, participant) -> None:
                track_sid = str(getattr(publication, "sid", id(track)))
                state = worker.track_tasks.pop(track_sid, None)
                if state:
                    state.task.cancel()

            try:
                await room.connect(livekit_url, token)
            except Exception as exc:
                logger.exception("[livekit-asr] failed to connect call %s: %s", call_key, exc)
                return False

            self._workers[call_key] = worker
            logger.info("[livekit-asr] worker started for call=%s room=%s", call_key, room_id)
            return True

    async def stop_call(self, call_id: str | int) -> None:
        call_key = str(call_id)
        async with self._lock:
            worker = self._workers.pop(call_key, None)

        if not worker:
            return

        for state in worker.track_tasks.values():
            state.task.cancel()
        worker.track_tasks.clear()

        try:
            await worker.room.disconnect()
        except Exception as exc:
            logger.warning("[livekit-asr] disconnect failed for call %s: %s", call_key, exc)

        logger.info("[livekit-asr] worker stopped for call=%s", call_key)

    async def _consume_audio_track(
        self,
        *,
        call_id: str,
        track,
        participant_identity: str,
        participant_name: str,
    ) -> None:
        try:
            from livekit import rtc

            audio_stream = rtc.AudioStream(track, sample_rate=SAMPLE_RATE, num_channels=NUM_CHANNELS)
            pcm = bytearray()

            async for frame_event in audio_stream:
                frame = frame_event.frame
                pcm.extend(bytes(frame.data))

                if len(pcm) < MIN_CHUNK_BYTES:
                    continue

                pcm_chunk = bytes(pcm)
                pcm.clear()

                if _is_silence_or_too_short(pcm_chunk):
                    continue

                wav_bytes = _pcm16_to_wav_bytes(pcm_chunk)

                _lang = os.getenv("WHISPER_LANGUAGE", None)
                result = await asr_service.transcribe(
                    wav_bytes,
                    language=_lang,
                    file_suffix=".wav",
                )
                text = result.get("text", "").strip()
                if not text:
                    continue

                await transcript_service.broadcast_caption(
                    call_id=call_id,
                    speaker=participant_identity,
                    speaker_id=participant_identity,
                    speaker_name=participant_name,
                    text=text,
                    language=result.get("language", "en"),
                    confidence=1.0,
                    is_final=True,
                )
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.exception(
                "[livekit-asr] audio consumer failed call=%s participant=%s: %s",
                call_id,
                participant_identity,
                exc,
            )


livekit_asr_manager = LiveKitAsrManager()
