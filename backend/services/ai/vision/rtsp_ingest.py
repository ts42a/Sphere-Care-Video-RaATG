from __future__ import annotations

from typing import Generator, Optional

import cv2

from backend.core import config as app_config

from backend.services.ai.vision.video_ingest import VideoFrame, resize_frame


def iter_rtsp_frames(
    url: str,
    max_fps: Optional[float] = None,
    max_width: Optional[int] = None,
) -> Generator[VideoFrame, None, None]:
    cap = cv2.VideoCapture(url, cv2.CAP_FFMPEG)
    if not cap.isOpened():
        return

    max_fps = max_fps if max_fps is not None else app_config.RTSP_MAX_FPS
    max_w = max_width if max_width is not None else app_config.RTSP_FRAME_WIDTH
    interval = 1.0 / max(max_fps, 0.05)

    import time

    idx = 0
    next_t = time.monotonic()
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        now = time.monotonic()
        if now < next_t:
            continue
        next_t = now + interval
        small, _ = resize_frame(frame, max_w=max_w)
        yield VideoFrame(index=idx, timestamp_sec=now, bgr=small)
        idx += 1

    cap.release()
