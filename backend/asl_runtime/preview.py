"""Throttled JPEG preview for UI (same camera as inference — no second client)."""
from __future__ import annotations

import base64
import time
from typing import Any

import cv2


def encode_preview_b64(
    frame_bgr,
    state: dict[str, Any],
    *,
    interval_s: float = 0.1,
    max_width: int = 960,
    quality: int = 82,
) -> str | None:
    now = time.time()
    if now - float(state.get("last", 0.0)) < interval_s:
        return None
    state["last"] = now
    h, w = frame_bgr.shape[:2]
    out = frame_bgr
    if w > max_width:
        nh = max(1, int(h * (max_width / w)))
        out = cv2.resize(frame_bgr, (max_width, nh))
    ok, buf = cv2.imencode(".jpg", out, [int(cv2.IMWRITE_JPEG_QUALITY), int(quality)])
    if not ok:
        return None
    return base64.b64encode(buf.tobytes()).decode("ascii")
