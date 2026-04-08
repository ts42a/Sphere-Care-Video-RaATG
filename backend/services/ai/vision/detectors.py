from __future__ import annotations

import random
from abc import ABC, abstractmethod
from typing import List, Optional

from backend.core import config as app_config

from backend.services.ai.vision.event_schema import BoundingBox, Detection, FrameAnalysis


class Detector(ABC):
    @property
    def detector_name(self) -> str:
        return self.__class__.__name__.replace("Detector", "").lower() or "unknown"

    @property
    def fallback_reason(self) -> Optional[str]:
        return None

    @abstractmethod
    def analyze(self, frame_bgr, fa: FrameAnalysis) -> FrameAnalysis:
        ...


class MockDetector(Detector):
    def analyze(self, frame_bgr, fa: FrameAnalysis) -> FrameAnalysis:
        t = fa.timestamp_sec
        r = random.Random(int(t * 10) % 10000)
        dets: List[Detection] = []

        if int(t * 2) % 9 == 0 or fa.motion_score > app_config.AI_MOTION_THRESHOLD:
            dets.append(
                Detection(
                    label="person",
                    confidence=0.55 + r.random() * 0.4,
                    bbox=BoundingBox(x=0.2 + r.random() * 0.2, y=0.25, w=0.15, h=0.45),
                )
            )

        if 4.0 <= t <= 6.5:
            dets.append(
                Detection(
                    label="person",
                    confidence=0.88,
                    bbox=BoundingBox(x=0.3, y=0.62, w=0.35, h=0.22),
                )
            )

        if 8.0 <= t <= 9.5:
            dets.append(
                Detection(
                    label="knife",
                    confidence=0.62,
                    bbox=BoundingBox(x=0.45, y=0.5, w=0.06, h=0.12),
                )
            )

        if 12.0 <= t <= 13.5:
            dets.append(
                Detection(
                    label="spill",
                    confidence=0.58,
                    bbox=BoundingBox(x=0.1, y=0.75, w=0.25, h=0.08),
                )
            )

        fa.detections = dets
        return fa


class YoloDetector(Detector):
    _model = None
    _load_error: Optional[str] = None

    def __init__(self) -> None:
        if YoloDetector._model is None:
            try:
                from ultralytics import YOLO  # type: ignore

                YoloDetector._model = YOLO(app_config.AI_YOLO_MODEL)
                YoloDetector._load_error = None
            except Exception as exc:
                YoloDetector._model = False
                YoloDetector._load_error = str(exc)

    @property
    def available(self) -> bool:
        return YoloDetector._model not in (None, False)

    @property
    def fallback_reason(self) -> Optional[str]:
        return YoloDetector._load_error

    def analyze(self, frame_bgr, fa: FrameAnalysis) -> FrameAnalysis:
        if not self.available:
            return MockDetector().analyze(frame_bgr, fa)

        model = YoloDetector._model
        results = model(frame_bgr, verbose=False)[0]
        names = getattr(results, "names", {}) or {}
        dets: List[Detection] = []
        h, w = frame_bgr.shape[:2]
        if w <= 0 or h <= 0:
            fa.detections = dets
            return fa

        for box in results.boxes or []:
            conf = float(box.conf[0])
            if conf < app_config.AI_MIN_CONFIDENCE:
                continue
            cls_id = int(box.cls[0])
            label = str(names.get(cls_id, f"class_{cls_id}")).lower()
            xyxy = box.xyxy[0].tolist()
            x1, y1, x2, y2 = xyxy
            bx = BoundingBox(
                x=max(0, x1 / w),
                y=max(0, y1 / h),
                w=max(0, (x2 - x1) / w),
                h=max(0, (y2 - y1) / h),
            )
            dets.append(Detection(label=label, confidence=conf, bbox=bx))

        fa.detections = dets
        return fa


def build_detector(kind: str, *, strict: bool = False) -> Detector:
    k = (kind or "mock").strip().lower()
    if k == "yolo":
        y = YoloDetector()
        if y.available:
            return y
        if strict:
            detail = y.fallback_reason or "YOLO backend unavailable."
            raise RuntimeError(
                "Requested detector 'yolo' is unavailable. "
                f"Reason: {detail}. Install/enable ultralytics and YOLO weights."
            )
    return MockDetector()
