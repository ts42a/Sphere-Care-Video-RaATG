from __future__ import annotations

from typing import Optional

import cv2
import numpy as np

from .types import QualityFrame


class FrameSelector:
    """
    Layer 3 (between quality and perception):
    - Maintains a minimum sampling floor (min_interval_sec)
    - Skips near-duplicate frames
    - Triggers short burst selection on scene/motion spikes
    """

    def __init__(
        self,
        *,
        min_interval_sec: float = 0.5,
        dedupe_threshold: float = 2.0,
        burst_motion_threshold: float = 8.0,
        burst_frames: int = 2,
    ) -> None:
        self.min_interval_sec = max(0.01, float(min_interval_sec))
        self.dedupe_threshold = max(0.0, float(dedupe_threshold))
        self.burst_motion_threshold = max(self.dedupe_threshold, float(burst_motion_threshold))
        self.burst_frames = max(0, int(burst_frames))

        self._prev_small_gray: Optional[np.ndarray] = None
        self._last_selected_ts: Optional[float] = None
        self._burst_remaining = 0

    @staticmethod
    def _downsample_gray(frame_bgr: np.ndarray) -> np.ndarray:
        gray = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2GRAY)
        return cv2.resize(gray, (64, 36), interpolation=cv2.INTER_AREA)

    def should_select(self, qf: QualityFrame) -> bool:
        small = self._downsample_gray(qf.frame.bgr)
        ts = float(qf.frame.ts)

        if self._prev_small_gray is None:
            self._prev_small_gray = small
            self._last_selected_ts = ts
            return True

        diff_score = float(np.mean(cv2.absdiff(small, self._prev_small_gray)))
        self._prev_small_gray = small

        force_min_floor = (
            self._last_selected_ts is None
            or (ts - self._last_selected_ts) >= self.min_interval_sec
        )
        if diff_score >= self.burst_motion_threshold:
            self._burst_remaining = self.burst_frames

        select = force_min_floor or diff_score >= self.dedupe_threshold or self._burst_remaining > 0
        if select:
            self._last_selected_ts = ts
            if self._burst_remaining > 0:
                self._burst_remaining -= 1
        return select
