"""
backend/api/routers/ws.py

Message types handled:
  audio_chunk  — legacy fallback only. Phase A ASR should come from LiveKit audio.
  asl_frame    — base64 image from Expo/Web → asl.py → call.asl.result broadcast

All existing handlers (schedule.watch, call_join, call_leave, etc.) unchanged.
"""

import asyncio
import base64
import json
import logging

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect

from backend.core.security import decode_access_token
from backend.ws.ws_manager import ws_manager
from backend.services import asr_service, transcript_service
from backend.api.routers.asl import (
    _get_hand_detector,
    _classify_static,
    _classify_motion,
    _extract_motion_features,
    _STATIC_CONF_THRESHOLD,
    _MOTION_CONF_THRESHOLD,
)

router = APIRouter(tags=["WebSocket"])
logger = logging.getLogger(__name__)


async def _handle_audio_chunk(
    msg_payload: dict,
    call_id: str,
    actor_key: str,
) -> None:
    """
    Legacy fallback: receive a base64 audio chunk, run Whisper, broadcast call.caption.

    New frontend code should no longer send this. Backend ASR should subscribe to
    LiveKit audio via `livekit_asr_service` instead.

    Expected payload:
    {
      "call_id": "123",
      "audio_b64": "<base64 webm/wav bytes>",
      "language": "en"          // optional, omit for auto-detect
    }
    """
    audio_b64 = msg_payload.get("audio_b64", "")
    language = msg_payload.get("language") or None

    if not audio_b64:
        return

    try:
        audio_bytes = base64.b64decode(audio_b64)
    except Exception:
        logger.warning(f"[ws] audio_chunk: invalid base64 from {actor_key}")
        return

    # Run Whisper in executor (non-blocking)
    result = await asr_service.transcribe(audio_bytes, language=language)
    text = result.get("text", "").strip()

    if not text:
        return

    await transcript_service.broadcast_caption(
        call_id=call_id,
        speaker=actor_key,
        text=text,
        language=result.get("language", "en"),
        confidence=1.0,  # Whisper doesn't expose segment-level confidence easily
        is_final=True,
    )


async def _handle_asl_frame(
    msg_payload: dict,
    call_id: str,
    actor_key: str,
) -> None:
    """
    Receive a base64 video frame, run MediaPipe + SVM/GRU, broadcast call.asl.result.

    Expected payload:
    {
      "call_id": "123",
      "image_b64": "<base64 JPEG/PNG/WebM frame>",
      "mode": "static",                         // "static" | "motion"
      "motion_seq": [[...63 floats...], ...]    // optional, for motion mode
    }
    """
    import io
    import numpy as np

    image_b64 = msg_payload.get("image_b64", "")
    mode = msg_payload.get("mode", "static")
    motion_seq_raw = msg_payload.get("motion_seq") or []

    if not image_b64:
        return

    try:
        img_bytes = base64.b64decode(image_b64)
    except Exception:
        logger.warning(f"[ws] asl_frame: invalid base64 from {actor_key}")
        return

    # Decode image
    try:
        import cv2
        arr = np.frombuffer(img_bytes, np.uint8)
        frame = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        if frame is None:
            raise ValueError("cv2 decode returned None")
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    except Exception:
        try:
            from PIL import Image
            rgb = np.array(Image.open(io.BytesIO(img_bytes)).convert("RGB"))
        except Exception as e:
            logger.warning(f"[ws] asl_frame: image decode error: {e}")
            return

    # MediaPipe hand detection (run in executor — blocking C++ call)
    loop = asyncio.get_event_loop()

    def _detect_and_classify():
        try:
            import mediapipe as mp
            detector = _get_hand_detector()
            mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
            result = detector.detect(mp_image)
        except Exception as e:
            logger.warning(f"[ws] asl_frame: MediaPipe error: {e}")
            return None, None, None

        if not result.hand_landmarks:
            return None, None, None

        hand_lm = result.hand_landmarks[0]

        try:
            if mode == "motion":
                prev_seqs = [np.array(f, dtype=np.float32) for f in motion_seq_raw]
                curr_feat = _extract_motion_features(hand_lm)
                full_seq = prev_seqs + [curr_feat]
                letter, confidence = _classify_motion(full_seq)
                conf_threshold = _MOTION_CONF_THRESHOLD
            else:
                letter, confidence = _classify_static(hand_lm)
                conf_threshold = _STATIC_CONF_THRESHOLD

            if confidence < conf_threshold:
                return None, None, None

            return letter, confidence, mode
        except Exception as e:
            logger.warning(f"[ws] asl_frame: classify error: {e}")
            return None, None, None

    letter, confidence, detected_mode = await loop.run_in_executor(None, _detect_and_classify)

    if not letter:
        return

    await transcript_service.broadcast_asl_result(
        call_id=call_id,
        speaker=actor_key,
        letter=letter,
        word=None,           # word assembly happens client-side
        confidence=confidence,
        mode=detected_mode or mode,
    )


@router.websocket("/ws")
async def websocket_endpoint(
    websocket: WebSocket,
    token: str = Query(...),
):
    payload = decode_access_token(token)
    if not payload:
        await websocket.close(code=4001)
        return

    admin_id, actor_key = await ws_manager.connect(websocket, payload)

    try:
        while True:
            raw = await websocket.receive_text()

            try:
                message = json.loads(raw)
            except Exception:
                continue

            msg_type = message.get("type")
            msg_payload = message.get("payload", {})

            # ── Schedule watchers ─────────────────────────────────
            if msg_type == "schedule.watch":
                doctor_id = msg_payload.get("doctorId")
                date = msg_payload.get("date")
                if doctor_id and date:
                    await ws_manager.watch_schedule(admin_id, doctor_id, date, websocket)

            elif msg_type == "schedule.unwatch":
                doctor_id = msg_payload.get("doctorId")
                date = msg_payload.get("date")
                if doctor_id and date:
                    ws_manager.unwatch_schedule(admin_id, doctor_id, date, websocket)

            # ── Call signaling ────────────────────────────────────
            elif msg_type == "call_join":
                call_id = str(msg_payload.get("call_id") or "")
                mode = msg_payload.get("mode") or "audio"
                local_user_id = msg_payload.get("local_user_id")
                remote_user_id = msg_payload.get("remote_user_id")

                if not call_id:
                    continue

                await ws_manager.join_call(call_id, websocket)

                await ws_manager.broadcast_call(
                    call_id,
                    {
                        "type": "call_joined",
                        "payload": {
                            "call_id": call_id,
                            "mode": mode,
                            "local_user_id": local_user_id,
                            "remote_user_id": remote_user_id,
                        },
                    },
                )
                await ws_manager.broadcast_call(
                    call_id,
                    {
                        "type": "call_connection_state",
                        "payload": {"call_id": call_id, "state": "connected"},
                    },
                )

            elif msg_type == "call_leave":
                call_id = str(msg_payload.get("call_id") or "")
                local_user_id = msg_payload.get("local_user_id")

                if not call_id:
                    continue

                await ws_manager.broadcast_call_except(
                    call_id,
                    {
                        "type": "call_ended",
                        "payload": {"call_id": call_id, "local_user_id": local_user_id},
                    },
                    exclude=websocket,
                )
                ws_manager.leave_call(call_id, websocket)

            elif msg_type == "call_local_media_updated":
                call_id = str(msg_payload.get("call_id") or "")
                local_user_id = msg_payload.get("local_user_id")

                if not call_id:
                    continue

                await ws_manager.broadcast_call_except(
                    call_id,
                    {
                        "type": "call_remote_media_updated",
                        "payload": {
                            "call_id": call_id,
                            "local_user_id": local_user_id,
                            "audio_enabled": msg_payload.get("audio_enabled", True),
                            "video_enabled": msg_payload.get("video_enabled", True),
                            "camera_facing": msg_payload.get("camera_facing", "front"),
                        },
                    },
                    exclude=websocket,
                )

            elif msg_type == "call_connection_state":
                call_id = str(msg_payload.get("call_id") or "")
                state = msg_payload.get("state")

                if not call_id or not state:
                    continue

                await ws_manager.broadcast_call(
                    call_id,
                    {
                        "type": "call_connection_state",
                        "payload": {"call_id": call_id, "state": state},
                    },
                )

            # ── NEW: ASR audio chunk ───────────────────────────────
            elif msg_type == "audio_chunk":
                call_id = str(msg_payload.get("call_id") or "")
                if not call_id or not actor_key:
                    continue
                # Fire-and-forget so WS loop stays responsive
                asyncio.create_task(
                    _handle_audio_chunk(msg_payload, call_id, actor_key)
                )

            # ── NEW: ASL video frame ──────────────────────────────
            elif msg_type == "asl_frame":
                call_id = str(msg_payload.get("call_id") or "")
                if not call_id or not actor_key:
                    continue
                asyncio.create_task(
                    _handle_asl_frame(msg_payload, call_id, actor_key)
                )

    except WebSocketDisconnect:
        ws_manager.disconnect(websocket, admin_id, actor_key)