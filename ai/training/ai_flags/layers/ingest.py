from __future__ import annotations

from pathlib import Path
from typing import Iterator

import cv2

from .types import RawFrame


class IngestLayer:
    """
    Layer 1: Reads stream/file input and emits ordered frames.
    """

    def __init__(self, source: str, *, max_fps: float = 2.0, max_width: int = 960) -> None:
        self.source = source
        self.max_fps = max(max_fps, 0.05)
        self.max_width = max(max_width, 64)

    def iter_frames(self) -> Iterator[RawFrame]:
        cap = cv2.VideoCapture(self.source)
        if not cap.isOpened():
            return

        native_fps = float(cap.get(cv2.CAP_PROP_FPS) or 0.0)
        native_fps = native_fps if native_fps > 0 else self.max_fps
        frame_step = max(1, int(round(native_fps / self.max_fps)))

        idx = 0
        emitted = 0
        source_id = Path(self.source).name or "stream"
        try:
            while True:
                ok, frame = cap.read()
                if not ok:
                    break
                if idx % frame_step != 0:
                    idx += 1
                    continue

                h, w = frame.shape[:2]
                if w > self.max_width:
                    scale = self.max_width / float(w)
                    frame = cv2.resize(frame, (self.max_width, int(h * scale)), interpolation=cv2.INTER_AREA)

                ts_msec = float(cap.get(cv2.CAP_PROP_POS_MSEC) or 0.0)
                ts = ts_msec / 1000.0 if ts_msec > 0 else (emitted / self.max_fps)
                metadata = {
                    "source": self.source,
                    "native_fps": native_fps,
                    "max_fps": self.max_fps,
                    "width": int(frame.shape[1]),
                    "height": int(frame.shape[0]),
                }
                yield RawFrame(index=emitted, ts=ts, bgr=frame, source_id=source_id, metadata=metadata)
                emitted += 1
                idx += 1
        finally:
            cap.release()
