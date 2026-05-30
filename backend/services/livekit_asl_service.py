"""
backend/services/livekit_asl_service.py

Phase A LiveKit ASL worker.

Mirrors livekit_asr_service.py exactly in structure but operates on **video**
tracks instead of audio tracks.  Each incoming video frame is passed to the
existing ASL detection service; when a sign is recognised the result is
broadcast as a `call.caption` event with ``modality="asl"`` so the frontend
can distinguish it from speech captions.

The same three-concern isolation as the ASR worker is preserved so a future
GPU-backed streaming model can slot in by replacing only the detection call:
  1. LiveKit video subscription
  2. Frame sampling / throttling
  3. Caption broadcasting

Frame sampling
--------------
Video arrives at ~30 fps but running inference on every frame is wasteful.
``ASL_FRAME_INTERVAL`` (default 0.15 s) controls the minimum gap between
inference calls.  ``ASL_MOTION_THRESHOLD`` gates on mean absolute pixel delta
so static frames are dropped cheaply before the model is invoked.

Detection API contract
----------------------
``asl_service.detect(frame_bgr: np.ndarray) -> dict`` is assumed to return::

    {
        "text": str,          # recognised gloss / word, empty when none
        "confidence": float,  # 0.0 – 1.0
        "language": str,      # e.g. "asl"
    }

If your existing detection function has a different signature, adapt the
``_run_detection`` helper at the bottom of this file.
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
from dataclasses import dataclass, field
from datetime import timedelta
from typing import Dict, Optional

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Configuration (all tuneable via environment variables)
# ---------------------------------------------------------------------------

# Seconds between inference calls per participant track.
ASL_FRAME_INTERVAL = float(os.getenv("ASL_FRAME_INTERVAL", "0.15"))

# Minimum mean absolute pixel delta between consecutive frames to be considered
# "moving" (i.e. signing).  Set to 0 to disable the motion gate entirely.
ASL_MOTION_THRESHOLD = float(os.getenv("ASL_MOTION_THRESHOLD", "4.0"))

# Minimum detection confidence to emit a caption.
ASL_MIN_CONFIDENCE = float(os.getenv("ASL_MIN_CONFIDENCE", "0.55"))


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _mint_worker_token(room_id: str, identity: str) -> Optional[str]:
    api_key = os.getenv("LIVEKIT_API_KEY", "")
    api_secret = os.getenv("LIVEKIT_API_SECRET", "")

    if not api_key or not api_secret:
        return None

    try:
        from livekit.api import AccessToken, VideoGrants

        return (
            AccessToken(api_key, api_secret)
            .with_identity(identity)
            .with_name("ASL Worker")
            .with_grants(VideoGrants(room_join=True, room=room_id))
            .with_ttl(timedelta(minutes=30))
            .to_jwt()
        )
    except Exception as exc:
        logger.warning("[livekit-asl] unable to mint worker token: %s", exc)
        return None


def _frame_to_bgr(frame) -> Optional["np.ndarray"]:  # type: ignore[name-defined]
    """Convert a LiveKit VideoFrame to a BGR numpy array.

    LiveKit delivers frames as ARGB / RGBA / YUV depending on the platform.
    We use ``frame.convert(rtc.VideoBufferType.RGBA)`` which is always
    available, then drop the alpha channel and swap R↔B for OpenCV convention.
    """
    try:
        import numpy as np
        from livekit import rtc

        rgba_frame = frame.convert(rtc.VideoBufferType.RGBA)
        w, h = rgba_frame.width, rgba_frame.height
        arr = np.frombuffer(rgba_frame.data, dtype=np.uint8).reshape((h, w, 4))
        # RGBA → BGR
        bgr = arr[:, :, [2, 1, 0]]
        return bgr
    except Exception as exc:
        logger.debug("[livekit-asl] frame conversion failed: %s", exc)
        return None


def _has_motion(prev_bgr, curr_bgr) -> bool:
    """Return True when mean absolute pixel delta exceeds the threshold."""
    if ASL_MOTION_THRESHOLD <= 0:
        return True
    if prev_bgr is None:
        return True
    try:
        import numpy as np

        delta = float(np.mean(np.abs(curr_bgr.astype(np.int16) - prev_bgr.astype(np.int16))))
        return delta >= ASL_MOTION_THRESHOLD
    except Exception:
        return True


async def _run_detection(frame_bgr) -> dict:
    """Thin async wrapper around the (potentially blocking) ASL detector.

    Runs the detection in a thread-pool executor so it does not block the
    event loop.  Adjust the import path to match your project layout.
    """
    loop = asyncio.get_running_loop()

    def _detect():
        from backend.services import asl_service  # local import keeps startup fast

        return asl_service.detect(frame_bgr)

    return await loop.run_in_executor(None, _detect)


# ---------------------------------------------------------------------------
# Dataclasses (mirror of ASR worker)
# ---------------------------------------------------------------------------


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


# ---------------------------------------------------------------------------
# Manager
# ---------------------------------------------------------------------------


class LiveKitAslManager:
    """Manages one backend ASL participant per active call.

    Public API is intentionally identical to ``LiveKitAsrManager`` so callers
    can start/stop both workers with the same pattern.
    """

    def __init__(self) -> None:
        self._workers: Dict[str, _CallWorker] = {}
        self._lock = asyncio.Lock()

    # ------------------------------------------------------------------
    # Public lifecycle methods
    # ------------------------------------------------------------------

    async def start_call(
        self,
        *,
        call_id: "str | int",
        room_id: str,
        livekit_url: Optional[str],
    ) -> bool:
        call_key = str(call_id)
        if not livekit_url:
            logger.info(
                "[livekit-asl] skipped call %s because LIVEKIT_URL is missing", call_key
            )
            return False

        async with self._lock:
            if call_key in self._workers:
                return True  # already running

            token = _mint_worker_token(room_id, f"asl_agent_{call_key}")
            if not token:
                logger.info(
                    "[livekit-asl] skipped call %s because worker token is unavailable",
                    call_key,
                )
                return False

            try:
                from livekit import rtc
            except ImportError:
                logger.warning(
                    "[livekit-asl] livekit package is not installed; worker not started"
                )
                return False

            room = rtc.Room()
            worker = _CallWorker(call_id=call_key, room_id=room_id, room=room)

            # ---- track subscription callbacks --------------------------------

            @room.on("track_subscribed")
            def _on_track_subscribed(track, publication, participant) -> None:
                try:
                    if track.kind != rtc.TrackKind.KIND_VIDEO:
                        return  # only interested in video tracks
                except Exception:
                    return

                # Skip our own agent tracks
                if str(getattr(participant, "identity", "")).startswith("asl_agent_"):
                    return

                track_sid = str(getattr(publication, "sid", id(track)))
                if track_sid in worker.track_tasks:
                    return  # already consuming

                task = asyncio.create_task(
                    self._consume_video_track(
                        call_id=call_key,
                        track=track,
                        participant_identity=str(
                            getattr(participant, "identity", "unknown")
                        ),
                        participant_name=str(
                            getattr(participant, "name", "")
                            or getattr(participant, "identity", "unknown")
                        ),
                    )
                )
                worker.track_tasks[track_sid] = _TrackState(
                    participant_identity=str(
                        getattr(participant, "identity", "unknown")
                    ),
                    participant_name=str(
                        getattr(participant, "name", "")
                        or getattr(participant, "identity", "unknown")
                    ),
                    task=task,
                )
                logger.info(
                    "[livekit-asl] subscribed call=%s track=%s participant=%s",
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

            # ------------------------------------------------------------------

            try:
                await room.connect(livekit_url, token)
            except Exception as exc:
                logger.exception(
                    "[livekit-asl] failed to connect call %s: %s", call_key, exc
                )
                return False

            self._workers[call_key] = worker
            logger.info(
                "[livekit-asl] worker started for call=%s room=%s", call_key, room_id
            )
            return True

    async def stop_call(self, call_id: "str | int") -> None:
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
            logger.warning(
                "[livekit-asl] disconnect failed for call %s: %s", call_key, exc
            )

        logger.info("[livekit-asl] worker stopped for call=%s", call_key)

    # ------------------------------------------------------------------
    # Internal – video consumption loop
    # ------------------------------------------------------------------

    async def _consume_video_track(
        self,
        *,
        call_id: str,
        track,
        participant_identity: str,
        participant_name: str,
    ) -> None:
        """Read frames from a single video track and run ASL detection.

        Design notes
        ------------
        * ``VideoStream`` is iterated frame-by-frame (each event carries a
          ``VideoFrameEvent`` with a ``.frame`` attribute).
        * Two cheap gates run *before* the detector:
          1. **Time gate** – skip frames that arrive faster than
             ``ASL_FRAME_INTERVAL`` seconds.
          2. **Motion gate** – skip frames where pixel delta is below
             ``ASL_MOTION_THRESHOLD``, meaning the hands are likely still.
        * Detection runs in a thread-pool executor (``_run_detection``) so it
          never blocks the event loop.
        * Results below ``ASL_MIN_CONFIDENCE`` are silently discarded.
        """
        try:
            from livekit import rtc
            from backend.services.transcript_service import broadcast_asl_result

            video_stream = rtc.VideoStream(track)
            last_inference_at: float = 0.0
            prev_bgr = None

            async for frame_event in video_stream:
                now = time.monotonic()

                # ---- time gate -----------------------------------------------
                if now - last_inference_at < ASL_FRAME_INTERVAL:
                    continue

                frame = frame_event.frame
                curr_bgr = _frame_to_bgr(frame)
                if curr_bgr is None:
                    continue

                # ---- motion gate ---------------------------------------------
                if not _has_motion(prev_bgr, curr_bgr):
                    prev_bgr = curr_bgr
                    continue

                prev_bgr = curr_bgr
                last_inference_at = now

                # ---- ASL detection ------------------------------------------
                result = await _run_detection(curr_bgr)

                text = (result.get("text") or "").strip()
                confidence = float(result.get("confidence", 0.0))

                if not text or confidence < ASL_MIN_CONFIDENCE:
                    continue

                logger.debug(
                    "[livekit-asl] call=%s participant=%s text=%r confidence=%.2f",
                    call_id,
                    participant_identity,
                    text,
                    confidence,
                )

                # ---- broadcast ASL result ------------------------------------
                await broadcast_asl_result(
                    call_id=call_id,
                    speaker=participant_identity,
                    letter=text,
                    confidence=confidence,
                    mode="static",
                )

        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.exception(
                "[livekit-asl] video consumer failed call=%s participant=%s: %s",
                call_id,
                participant_identity,
                exc,
            )


# ---------------------------------------------------------------------------
# Module-level singleton (mirrors livekit_asr_manager pattern)
# ---------------------------------------------------------------------------

livekit_asl_manager = LiveKitAslManager()