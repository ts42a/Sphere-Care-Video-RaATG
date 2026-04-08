from __future__ import annotations

import cv2
import numpy as np

from .types import QualityFrame, RawFrame


class DataQualityGate:
    """
    Layer 2: Computes visibility checks and quality flags.
    """

    def __init__(
        self,
        *,
        dark_threshold: float = 35.0,
        blur_threshold: float = 70.0,
        occlusion_ratio_threshold: float = 0.80,
    ) -> None:
        self.dark_threshold = dark_threshold
        self.blur_threshold = blur_threshold
        self.occlusion_ratio_threshold = occlusion_ratio_threshold

    def evaluate(self, frame: RawFrame) -> QualityFrame:
        gray = cv2.cvtColor(frame.bgr, cv2.COLOR_BGR2GRAY)
        brightness = float(np.mean(gray))
        blur_var = float(cv2.Laplacian(gray, cv2.CV_64F).var())

        black_ratio = float(np.mean(gray < 10))

        flags = {
            "too_dark": brightness < self.dark_threshold,
            "too_blurry": blur_var < self.blur_threshold,
            "occluded": black_ratio > self.occlusion_ratio_threshold,
        }
        flags["low_visibility"] = bool(flags["too_dark"] or flags["too_blurry"] or flags["occluded"])
        scores = {
            "brightness": brightness,
            "blur_var": blur_var,
            "black_ratio": black_ratio,
        }
        return QualityFrame(
            frame=frame,
            low_visibility=flags["low_visibility"],
            quality_flags=flags,
            quality_scores=scores,
        )
