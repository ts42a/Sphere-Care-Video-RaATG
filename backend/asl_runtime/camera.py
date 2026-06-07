"""Webcam open/read helpers — native resolution, fast reads."""
from __future__ import annotations

import sys
import time

import cv2

# Fast defaults (good speed + accuracy on most webcams).
FAST_WIDTH = 1280
FAST_HEIGHT = 720
FAST_DETECT_WIDTH = 960
# HD fallback when the driver ignores a low resolution request.
PREFERRED_WIDTH = 1920
PREFERRED_HEIGHT = 1080
QUALITY_DETECT_WIDTH = 1280


def _actual_size(cap: cv2.VideoCapture) -> tuple[int, int]:
    return int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))


def open_webcam(
    index: int = 0,
    *,
    width: int = PREFERRED_WIDTH,
    height: int = PREFERRED_HEIGHT,
    fps: int = 30,
    warmup_frames: int = 2,
) -> cv2.VideoCapture:
    backends: list[int] = [cv2.CAP_DSHOW, cv2.CAP_MSMF, cv2.CAP_ANY] if sys.platform == "win32" else [cv2.CAP_ANY]

    cap: cv2.VideoCapture | None = None
    for api in backends:
        try:
            c = cv2.VideoCapture(index, api)
        except Exception:
            continue
        if c.isOpened():
            cap = c
            break
        c.release()

    if cap is None or not cap.isOpened():
        cap = cv2.VideoCapture(index)
    if not cap.isOpened():
        raise RuntimeError(f"Could not open webcam index {index}.")

    cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, float(width))
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, float(height))
    cap.set(cv2.CAP_PROP_FPS, float(fps))

    aw, ah = _actual_size(cap)
    # If the driver ignored our request, try the preferred HD mode once.
    if aw < 960 and (width, height) != (PREFERRED_WIDTH, PREFERRED_HEIGHT):
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, float(PREFERRED_WIDTH))
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, float(PREFERRED_HEIGHT))
        aw, ah = _actual_size(cap)

    for _ in range(max(0, warmup_frames)):
        cap.read()

    return cap


def read_frame(cap: cv2.VideoCapture, *, flush: bool = False) -> tuple[bool, any]:
    """
    Read one frame. flush=True drops stale buffered frames (smoother but slower).
    Default False keeps the old fast path.
    """
    if flush:
        cap.grab()
        return cap.retrieve()
    return cap.read()


def detect_rgb(frame_bgr, max_width: int = 1280):
    """Downscale for MediaPipe only; display stays full resolution."""
    import numpy as np

    h, w = frame_bgr.shape[:2]
    if w <= max_width:
        return np.ascontiguousarray(cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB))
    nh = max(1, int(h * (max_width / w)))
    small = cv2.resize(frame_bgr, (max_width, nh), interpolation=cv2.INTER_AREA)
    return np.ascontiguousarray(cv2.cvtColor(small, cv2.COLOR_BGR2RGB))
