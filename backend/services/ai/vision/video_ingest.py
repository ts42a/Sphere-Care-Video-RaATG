from __future__ import annotations

from dataclasses import dataclass
from typing import Generator, Optional, Tuple

import cv2
import numpy as np

from backend.core import config as app_config


@dataclass
class VideoFrame:
    index: int
    timestamp_sec: float
    bgr: np.ndarray


def iter_video_frames(
    path: str,
    max_fps: Optional[float] = None,
) -> Generator[VideoFrame, None, None]:
    cap = cv2.VideoCapture(path)
    if not cap.isOpened():
        return

    fps_native = cap.get(cv2.CAP_PROP_FPS) or 25.0
    max_fps = max_fps if max_fps is not None else app_config.AI_MAX_SAMPLE_FPS
    min_interval = max(1.0 / max(fps_native, 0.01), 1.0 / max(max_fps, 0.1))

    prev_gray: Optional[np.ndarray] = None
    last_emit_t = -1.0
    idx = 0
    motion_thr = app_config.AI_MOTION_THRESHOLD

    while True:
        ok, frame = cap.read()
        if not ok:
            break
        t = cap.get(cv2.CAP_PROP_POS_MSEC) / 1000.0
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        gray = cv2.GaussianBlur(gray, (7, 7), 0)

        motion = 0.0
        if prev_gray is not None:
            motion = float(np.mean(cv2.absdiff(gray, prev_gray)))
        prev_gray = gray

        should_emit = False
        if last_emit_t < 0:
            should_emit = True
        elif t - last_emit_t >= min_interval:
            should_emit = motion >= motion_thr or (t - last_emit_t) >= min_interval * 3

        if should_emit:
            last_emit_t = t
            yield VideoFrame(index=idx, timestamp_sec=t, bgr=frame)
        idx += 1

    cap.release()


def resize_frame(bgr: np.ndarray, max_w: int = 640) -> Tuple[np.ndarray, float]:
    h, w = bgr.shape[:2]
    if w <= max_w:
        return bgr, 1.0
    scale = max_w / w
    small = cv2.resize(bgr, (max_w, int(h * scale)), interpolation=cv2.INTER_AREA)
    return small, scale
