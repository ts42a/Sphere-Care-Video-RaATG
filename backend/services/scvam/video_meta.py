from __future__ import annotations

from pathlib import Path


def probe_video_duration_sec(video_path: Path) -> float | None:
    """Return duration in seconds via OpenCV, or None if unavailable."""
    try:
        import cv2
    except ImportError:
        return None

    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        return None
    try:
        fps = float(cap.get(cv2.CAP_PROP_FPS) or 0.0)
        frames = float(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0.0)
        if fps > 1e-3 and frames > 0:
            return frames / fps
    finally:
        cap.release()
    return None
