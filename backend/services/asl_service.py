"""
backend/services/asl_service.py

Single-frame ASL detection for the livekit_asl_service worker.
Reuses the lazy singletons from api/routers/asl.py so models load only once.

This service should return the raw detected letter and confidence.
The final confidence threshold is handled by livekit_asl_service.py.
"""

from __future__ import annotations

import logging

import numpy as np

logger = logging.getLogger(__name__)


def detect(frame_bgr: np.ndarray) -> dict:
    """Run static ASL classification on a single BGR frame.

    Returns:
        {
            "text": str,
            "confidence": float,
            "language": "asl"
        }

    text is empty only when no hand is detected or detection fails.
    Low-confidence letters are still returned so the LiveKit worker can decide
    whether to emit the result.
    """
    try:
        import cv2
        import mediapipe as mp
        from backend.api.routers.asl import (
            _get_hand_detector,
            _classify_static,
        )

        rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
        detector = _get_hand_detector()
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        result = detector.detect(mp_image)

        if not result.hand_landmarks:
            return {
                "text": "",
                "confidence": 0.0,
                "language": "asl",
                "reason": "no_hand",
            }

        hand_lm = result.hand_landmarks[0]
        letter, confidence = _classify_static(hand_lm)

        return {
            "text": str(letter or ""),
            "confidence": round(float(confidence), 3),
            "language": "asl",
            "reason": "classified",
        }

    except Exception as exc:
        logger.debug("[asl_service] detect failed: %s", exc)
        return {
            "text": "",
            "confidence": 0.0,
            "language": "asl",
            "reason": "error",
            "error": str(exc),
        }
