from __future__ import annotations

from collections import defaultdict
from typing import DefaultDict, List, Sequence

from .types import BetaFlag, TriagedEvent


class ConfidenceCalibration:
    """
    Layer 9: Maps raw confidence to stable bands.
    """

    @staticmethod
    def calibrate(confidence: float) -> float:
        c = max(0.0, min(1.0, confidence))
        if c < 0.25:
            return 0.20
        if c < 0.5:
            return 0.40
        if c < 0.75:
            return 0.65
        return 0.85


class RiskTriage:
    """
    Layer 10: Promotes Beta to Alpha only when thresholds/rules pass.
    """

    def __init__(
        self,
        *,
        alpha_threshold: float = 0.65,
        repetition_window_sec: float = 20.0,
        min_repeat_count: int = 2,
        min_duration_sec: float = 5.0,
    ) -> None:
        self.alpha_threshold = alpha_threshold
        self.repetition_window_sec = repetition_window_sec
        self.min_repeat_count = min_repeat_count
        self.min_duration_sec = min_duration_sec
        self.calibration = ConfidenceCalibration()

    @staticmethod
    def _safe_float(value: object, default: float = 0.0) -> float:
        try:
            return float(value)
        except (TypeError, ValueError):
            return default

    @staticmethod
    def _safe_bool(value: object, default: bool = False) -> bool:
        if isinstance(value, bool):
            return value
        if isinstance(value, (int, float)):
            return bool(value)
        if isinstance(value, str):
            return value.strip().lower() in {"1", "true", "yes", "y"}
        return default

    def _extract_triage_inputs(self, b: BetaFlag) -> dict:
        ev = b.evidence if isinstance(b.evidence, dict) else {}
        normalized = ev.get("normalized", {}) if isinstance(ev.get("normalized", {}), dict) else {}
        quality = normalized.get("quality", {}) if isinstance(normalized.get("quality", {}), dict) else {}
        specialist = (
            normalized.get("specialist", {})
            if isinstance(normalized.get("specialist", {}), dict)
            else {}
        )

        low_visibility = self._safe_bool(
            quality.get("low_visibility", ev.get("low_visibility", False)),
            False,
        )
        agreement = self._safe_float(
            specialist.get("agreement", ev.get("agreement", 0.0)),
            0.0,
        )
        interaction_conf = self._safe_float(
            specialist.get("interaction_conf", ev.get("interaction_conf", 0.0)),
            0.0,
        )
        hand_conf = self._safe_float(
            specialist.get("hand_conf", ev.get("hand_conf", 0.0)),
            0.0,
        )
        proximity_score = self._safe_float(
            specialist.get("proximity_score", ev.get("proximity_score", 0.0)),
            0.0,
        )
        return {
            "low_visibility": low_visibility,
            "agreement": max(0.0, min(agreement, 1.0)),
            "interaction_conf": max(0.0, min(interaction_conf, 1.0)),
            "hand_conf": max(0.0, min(hand_conf, 1.0)),
            "proximity_score": max(0.0, min(proximity_score, 1.0)),
        }

    def process(self, betas: Sequence[BetaFlag]) -> List[TriagedEvent]:
        history: DefaultDict[str, List[BetaFlag]] = defaultdict(list)
        out: List[TriagedEvent] = []
        for b in sorted(betas, key=lambda x: x.ts):
            key = f"{b.event_type}:{b.zone}"
            history[key] = [x for x in history[key] if (b.ts - x.ts) <= self.repetition_window_sec]
            history[key].append(b)

            repeated = len(history[key]) >= self.min_repeat_count
            duration_ok = (history[key][-1].ts - history[key][0].ts) >= self.min_duration_sec
            ti = self._extract_triage_inputs(b)
            low_visibility = ti["low_visibility"]
            agreement = ti["agreement"]
            interaction_conf = ti["interaction_conf"]
            hand_conf = ti["hand_conf"]
            proximity_score = ti["proximity_score"]

            calibrated = self.calibration.calibrate(b.confidence)
            adjusted = calibrated + (0.08 if repeated else 0.0) + (0.08 if duration_ok else 0.0)
            if agreement >= 1.0:
                adjusted += 0.06
            if hand_conf >= 0.45:
                adjusted += 0.04
            if proximity_score >= 0.50:
                adjusted += 0.03
            elif interaction_conf > 0.0 and interaction_conf < 0.20:
                adjusted -= 0.05
            if low_visibility:
                adjusted -= 0.15
            adjusted = max(0.0, min(1.0, adjusted))

            strong_evidence = repeated or duration_ok
            level = "alpha" if (adjusted >= self.alpha_threshold and strong_evidence) else "beta"
            out.append(
                TriagedEvent(
                    event_id=f"{level}_{b.event_type}_{int(b.ts)}",
                    event_type=b.event_type,
                    level=level,
                    confidence=adjusted,
                    zone=b.zone,
                    ts=b.ts,
                    evidence={
                        **b.evidence,
                        "triage": {
                            "beta_id": b.beta_id,
                            "repeated": repeated,
                            "duration_ok": duration_ok,
                            "quality_ok": not low_visibility,
                            "agreement": agreement,
                            "interaction_conf": interaction_conf,
                            "hand_conf": hand_conf,
                            "proximity_score": proximity_score,
                            "calibrated_confidence": calibrated,
                            "adjusted_confidence": adjusted,
                        },
                    },
                )
            )
        return out
