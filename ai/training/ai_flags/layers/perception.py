from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple
from urllib.request import urlretrieve

import cv2
import numpy as np

from backend.core import config
from backend.services.ai.vision.detectors import Detector, build_detector
from backend.services.ai.vision.event_schema import Detection, FrameAnalysis
from backend.services.ai.vision.zones import load_zone_defs, zones_for_bbox

from .types import FrameFact, QualityFrame


class PerceptionLayer:
    """
    Layer 4: Runs detection + motion + zone tagging and emits FrameFact.
    """

    def __init__(
        self,
        *,
        detector_kind: str = "mock",
        camera_id: int = 0,
        strict_detector: bool = False,
        specialist_enabled: bool = False,
        specialist_backend: str = "heuristic",
        specialist_crop_margin: float = 0.12,
        specialist_min_crop_size: int = 24,
    ) -> None:
        self.requested_detector_kind = detector_kind
        self.detector: Detector = build_detector(detector_kind, strict=strict_detector)
        self.actual_detector_kind = getattr(self.detector, "detector_name", detector_kind)
        self.camera_id = camera_id
        self.specialist_enabled = specialist_enabled
        self.specialist_backend = (specialist_backend or "heuristic").strip().lower()
        self.specialist_backend_used = self.specialist_backend
        self.specialist_fallback_reason: Optional[str] = None
        self.specialist_crop_margin = max(0.0, min(float(specialist_crop_margin), 0.5))
        self.specialist_min_crop_size = max(8, int(specialist_min_crop_size))
        self._prev_gray: Optional[np.ndarray] = None
        self._zone_data = load_zone_defs()
        self._mp_hands: Optional[Any] = None
        self._mp_image_cls: Optional[Any] = None
        self._mp_image_format: Optional[Any] = None

        if self.specialist_enabled and self.specialist_backend in {"mediapipe", "auto"}:
            try:
                import mediapipe as mp  # type: ignore

                if hasattr(mp, "solutions"):
                    self._mp_hands = mp.solutions.hands.Hands(
                        static_image_mode=True,
                        max_num_hands=2,
                        min_detection_confidence=0.5,
                        min_tracking_confidence=0.5,
                    )
                else:
                    from mediapipe.tasks import python as mp_python  # type: ignore
                    from mediapipe.tasks.python import vision as mp_vision  # type: ignore

                    model_path = Path(config.AI_MEDIAPIPE_HAND_MODEL)
                    if not model_path.exists():
                        model_path.parent.mkdir(parents=True, exist_ok=True)
                        urlretrieve(config.AI_MEDIAPIPE_HAND_MODEL_URL, str(model_path))

                    options = mp_vision.HandLandmarkerOptions(
                        base_options=mp_python.BaseOptions(model_asset_path=str(model_path)),
                        running_mode=mp_vision.RunningMode.IMAGE,
                        num_hands=2,
                        min_hand_detection_confidence=0.5,
                        min_hand_presence_confidence=0.5,
                        min_tracking_confidence=0.5,
                    )
                    self._mp_hands = mp_vision.HandLandmarker.create_from_options(options)
                    self._mp_image_cls = mp.Image
                    self._mp_image_format = mp.ImageFormat.SRGB
                self.specialist_backend_used = "mediapipe"
            except Exception as exc:
                self.specialist_backend_used = "heuristic"
                self.specialist_fallback_reason = f"mediapipe unavailable: {exc}"
        elif self.specialist_enabled:
            self.specialist_backend_used = "heuristic"

    def _calc_motion(self, frame_bgr: np.ndarray) -> float:
        gray = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2GRAY)
        if self._prev_gray is None:
            self._prev_gray = gray
            return 0.0
        motion = float(np.mean(cv2.absdiff(gray, self._prev_gray)))
        self._prev_gray = gray
        return motion

    def _to_fact_detections(self, dets: Sequence[Detection]) -> List[Dict[str, object]]:
        out: List[Dict[str, object]] = []
        for d in dets:
            # Preferred schema (event_schema.Detection): confidence + bbox(x, y, w, h).
            if hasattr(d, "confidence") and hasattr(d, "bbox"):
                x1 = float(d.bbox.x)
                y1 = float(d.bbox.y)
                x2 = min(1.0, x1 + float(d.bbox.w))
                y2 = min(1.0, y1 + float(d.bbox.h))
                out.append({"label": d.label, "conf": float(d.confidence), "bbox": [x1, y1, x2, y2]})
                continue

            # Backward-compat fallback shape: conf/x1/y1/x2/y2.
            out.append(
                {
                    "label": getattr(d, "label", "unknown"),
                    "conf": float(getattr(d, "conf", 0.0)),
                    "bbox": [
                        float(getattr(d, "x1", 0.0)),
                        float(getattr(d, "y1", 0.0)),
                        float(getattr(d, "x2", 0.0)),
                        float(getattr(d, "y2", 0.0)),
                    ],
                }
            )
        return out

    @staticmethod
    def _bbox_center(bbox: Sequence[float]) -> Tuple[float, float]:
        x1, y1, x2, y2 = [float(v) for v in bbox]
        return ((x1 + x2) / 2.0, (y1 + y2) / 2.0)

    @staticmethod
    def _bbox_iou(a: Sequence[float], b: Sequence[float]) -> float:
        ax1, ay1, ax2, ay2 = [float(v) for v in a]
        bx1, by1, bx2, by2 = [float(v) for v in b]
        ix1, iy1 = max(ax1, bx1), max(ay1, by1)
        ix2, iy2 = min(ax2, bx2), min(ay2, by2)
        iw, ih = max(0.0, ix2 - ix1), max(0.0, iy2 - iy1)
        inter = iw * ih
        if inter <= 0:
            return 0.0
        area_a = max(0.0, ax2 - ax1) * max(0.0, ay2 - ay1)
        area_b = max(0.0, bx2 - bx1) * max(0.0, by2 - by1)
        denom = max(1e-6, area_a + area_b - inter)
        return float(inter / denom)

    @staticmethod
    def _bbox_distance_score(a: Sequence[float], b: Sequence[float]) -> float:
        ax, ay = PerceptionLayer._bbox_center(a)
        bx, by = PerceptionLayer._bbox_center(b)
        dist = float(np.hypot(ax - bx, ay - by))
        # Higher is better (closer). Dist in normalized frame coords, clipped to [0, 1].
        return max(0.0, 1.0 - min(dist, 1.0))

    def _crop_from_bbox(self, frame_bgr: np.ndarray, bbox: Sequence[float]) -> Optional[np.ndarray]:
        crop, _ = self._crop_with_bounds(frame_bgr, bbox)
        return crop

    def _crop_with_bounds(
        self,
        frame_bgr: np.ndarray,
        bbox: Sequence[float],
    ) -> Tuple[Optional[np.ndarray], Optional[Tuple[float, float, float, float]]]:
        h, w = frame_bgr.shape[:2]
        if h <= 0 or w <= 0:
            return None, None
        x1, y1, x2, y2 = [float(v) for v in bbox]
        bw = max(0.0, x2 - x1)
        bh = max(0.0, y2 - y1)
        if bw <= 0.0 or bh <= 0.0:
            return None, None

        pad_x = bw * self.specialist_crop_margin
        pad_y = bh * self.specialist_crop_margin
        nx1 = max(0.0, x1 - pad_x)
        ny1 = max(0.0, y1 - pad_y)
        nx2 = min(1.0, x2 + pad_x)
        ny2 = min(1.0, y2 + pad_y)
        px1 = int(nx1 * w)
        py1 = int(ny1 * h)
        px2 = int(nx2 * w)
        py2 = int(ny2 * h)
        if (px2 - px1) < self.specialist_min_crop_size or (py2 - py1) < self.specialist_min_crop_size:
            return None, None
        return frame_bgr[py1:py2, px1:px2], (nx1, ny1, nx2, ny2)

    @staticmethod
    def _crop_hand_activity_score(crop_bgr: np.ndarray) -> float:
        gray = cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2GRAY)
        edges = cv2.Canny(gray, 80, 160)
        edge_ratio = float(np.mean(edges > 0))
        # Normalize edge ratio to confidence-ish range.
        return max(0.0, min(edge_ratio * 4.0, 1.0))

    def _run_closeup_specialist(
        self,
        frame_bgr: np.ndarray,
        detections: Sequence[Dict[str, object]],
        motion_score: float,
    ) -> Dict[str, object]:
        persons = [d for d in detections if str(d.get("label", "")).lower() == "person"]
        knives = [d for d in detections if str(d.get("label", "")).lower() in {"knife", "scissors"}]

        hand_scores: List[float] = []
        for p in persons:
            bbox = p.get("bbox", [])
            if not isinstance(bbox, list) or len(bbox) != 4:
                continue
            crop = self._crop_from_bbox(frame_bgr, bbox)
            if crop is None:
                continue
            hand_scores.append(self._crop_hand_activity_score(crop))

        hand_conf = max(hand_scores, default=0.0)
        proximity_score = 0.0
        overlap_score = 0.0
        for p in persons:
            pb = p.get("bbox", [])
            if not isinstance(pb, list) or len(pb) != 4:
                continue
            for k in knives:
                kb = k.get("bbox", [])
                if not isinstance(kb, list) or len(kb) != 4:
                    continue
                proximity_score = max(proximity_score, self._bbox_distance_score(pb, kb))
                overlap_score = max(overlap_score, self._bbox_iou(pb, kb))

        person_object_presence = 1.0 if (persons and knives) else 0.0
        interaction_conf = max(
            0.0,
            min(
                (0.45 * proximity_score)
                + (0.20 * overlap_score)
                + (0.20 * hand_conf)
                + (0.15 * person_object_presence),
                1.0,
            ),
        )
        if knives and interaction_conf >= 0.45:
            action_label = "possible_hand_object_interaction"
        elif persons and hand_conf >= 0.45:
            action_label = "possible_hand_activity"
        else:
            action_label = "none"

        return {
            "enabled": True,
            "backend": "heuristic",
            "person_count": len(persons),
            "object_count": len(knives),
            "hand_present": hand_conf > 0.0,
            "hand_keypoint_conf": round(hand_conf, 4),
            "hand_object_distance": round(1.0 - proximity_score, 4),
            "hand_conf": round(hand_conf, 4),
            "interaction_conf": round(interaction_conf, 4),
            "proximity_score": round(proximity_score, 4),
            "overlap_score": round(overlap_score, 4),
            "motion_score": round(float(motion_score), 4),
            "action_label": action_label,
            "model": "closeup_heuristic_v1",
        }

    def _run_mediapipe_specialist(
        self,
        frame_bgr: np.ndarray,
        detections: Sequence[Dict[str, object]],
        motion_score: float,
    ) -> Dict[str, object]:
        persons = [d for d in detections if str(d.get("label", "")).lower() == "person"]
        knives = [d for d in detections if str(d.get("label", "")).lower() in {"knife", "scissors"}]
        if self._mp_hands is None:
            return self._run_closeup_specialist(frame_bgr, detections, motion_score)

        hand_count = 0
        hand_keypoint_conf = 0.0
        hand_points_global: List[Tuple[float, float]] = []

        for p in persons:
            bbox = p.get("bbox", [])
            if not isinstance(bbox, list) or len(bbox) != 4:
                continue
            crop, bounds = self._crop_with_bounds(frame_bgr, bbox)
            if crop is None or bounds is None:
                continue
            nx1, ny1, nx2, ny2 = bounds
            crop_h, crop_w = crop.shape[:2]
            if crop_w <= 0 or crop_h <= 0:
                continue

            rgb = cv2.cvtColor(crop, cv2.COLOR_BGR2RGB)
            hand_landmarks: List[Any] = []
            handedness_data: List[Any] = []
            if self._mp_image_cls is not None and self._mp_image_format is not None:
                mp_image = self._mp_image_cls(image_format=self._mp_image_format, data=rgb)
                result = self._mp_hands.detect(mp_image)
                hand_landmarks = list(getattr(result, "hand_landmarks", []) or [])
                handedness_data = list(getattr(result, "handedness", []) or [])
            else:
                result = self._mp_hands.process(rgb)
                hand_landmarks = list(getattr(result, "multi_hand_landmarks", []) or [])
                handedness_data = list(getattr(result, "multi_handedness", []) or [])

            if not hand_landmarks:
                continue

            hand_count += len(hand_landmarks)
            for handedness in handedness_data:
                for cls in getattr(handedness, "classification", handedness):
                    hand_keypoint_conf = max(hand_keypoint_conf, float(getattr(cls, "score", 0.0)))

            for hand_lms in hand_landmarks:
                for lm in getattr(hand_lms, "landmark", hand_lms):
                    gx = nx1 + (float(lm.x) * (nx2 - nx1))
                    gy = ny1 + (float(lm.y) * (ny2 - ny1))
                    hand_points_global.append((gx, gy))

        if hand_count > 0 and hand_keypoint_conf == 0.0:
            hand_keypoint_conf = 0.60

        hand_object_distance = 1.0
        proximity_score = 0.0
        if hand_points_global and knives:
            for k in knives:
                kb = k.get("bbox", [])
                if not isinstance(kb, list) or len(kb) != 4:
                    continue
                kx, ky = self._bbox_center(kb)
                for hx, hy in hand_points_global:
                    d = float(np.hypot(hx - kx, hy - ky))
                    if d < hand_object_distance:
                        hand_object_distance = d
            hand_object_distance = max(0.0, min(hand_object_distance, 1.0))
            proximity_score = max(0.0, 1.0 - hand_object_distance)

        person_object_presence = 1.0 if (persons and knives) else 0.0
        interaction_conf = max(
            0.0,
            min(
                (0.55 * proximity_score)
                + (0.30 * hand_keypoint_conf)
                + (0.15 * person_object_presence),
                1.0,
            ),
        )

        if knives and interaction_conf >= 0.45:
            action_label = "possible_hand_object_interaction"
        elif hand_count > 0:
            action_label = "possible_hand_activity"
        else:
            action_label = "none"

        return {
            "enabled": True,
            "backend": "mediapipe",
            "person_count": len(persons),
            "object_count": len(knives),
            "hand_present": hand_count > 0,
            "hand_count": hand_count,
            "hand_keypoint_conf": round(hand_keypoint_conf, 4),
            "hand_object_distance": round(hand_object_distance, 4),
            "hand_conf": round(hand_keypoint_conf, 4),
            "interaction_conf": round(interaction_conf, 4),
            "proximity_score": round(proximity_score, 4),
            "overlap_score": 0.0,
            "motion_score": round(float(motion_score), 4),
            "action_label": action_label,
            "model": "mediapipe_hands_v1",
        }

    def process(self, qf: QualityFrame) -> FrameFact:
        motion = self._calc_motion(qf.frame.bgr)
        fa = FrameAnalysis(
            frame_index=int(qf.frame.index),
            timestamp_sec=float(qf.frame.ts),
            camera_id=self.camera_id,
            motion_score=motion,
            detections=[],
            zone_hits=[],
        )
        fa = self.detector.analyze(qf.frame.bgr, fa)

        zone_hits = set()
        for det in fa.detections:
            for zone in zones_for_bbox(self.camera_id, det, self._zone_data):
                zone_hits.add(zone)

        fact_detections = self._to_fact_detections(fa.detections)
        specialist: Dict[str, object] = {"enabled": False}
        if self.specialist_enabled:
            if self.specialist_backend_used == "mediapipe":
                specialist = self._run_mediapipe_specialist(qf.frame.bgr, fact_detections, motion)
            else:
                specialist = self._run_closeup_specialist(qf.frame.bgr, fact_detections, motion)
            specialist["backend_requested"] = self.specialist_backend
            specialist["backend_used"] = self.specialist_backend_used
            if self.specialist_fallback_reason:
                specialist["fallback_reason"] = self.specialist_fallback_reason

        return FrameFact(
            ts=qf.frame.ts,
            detections=fact_detections,
            motion_score=motion,
            zone_hits=sorted(zone_hits),
            quality_flags=qf.quality_flags,
            specialist=specialist,
        )
