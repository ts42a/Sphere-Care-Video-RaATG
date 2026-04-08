from __future__ import annotations

from typing import Dict, List, Sequence

from .types import CandidateEvent, FrameFact


class CandidateLayer:
    """
    Layer 7: Converts frame facts to possible event candidates.
    """

    def __init__(self, *, motion_threshold: float = 12.0) -> None:
        self.motion_threshold = motion_threshold
        self._unsafe_zone_streak: Dict[str, int] = {}

    @staticmethod
    def _find_label_conf(dets: Sequence[Dict[str, object]], label: str) -> float:
        confs = [float(d.get("conf", 0.0)) for d in dets if str(d.get("label", "")).lower() == label]
        return max(confs, default=0.0)

    @staticmethod
    def _specialist_vals(fact: FrameFact) -> Dict[str, float]:
        sp = fact.specialist or {}
        return {
            "hand_conf": float(sp.get("hand_conf", 0.0)),
            "interaction_conf": float(sp.get("interaction_conf", 0.0)),
            "proximity_score": float(sp.get("proximity_score", 0.0)),
            "hand_object_distance": float(sp.get("hand_object_distance", 1.0)),
            "agreement": float(sp.get("agreement", 0.0)),
        }

    @staticmethod
    def _normalized_evidence(
        *,
        fact: FrameFact,
        zone: str,
        person_conf: float,
        knife_conf: float,
        specialist: Dict[str, float],
        event_fields: Dict[str, object],
    ) -> Dict[str, object]:
        low_visibility = bool(fact.quality_flags.get("low_visibility", False))
        quality_flags = {k: bool(v) for k, v in (fact.quality_flags or {}).items()}
        agreement = float(event_fields.get("agreement", specialist.get("agreement", 0.0)))

        normalized = {
            "quality": {
                "low_visibility": low_visibility,
                "flags": quality_flags,
            },
            "detections": {
                "person_conf": max(0.0, min(person_conf, 1.0)),
                "knife_conf": max(0.0, min(knife_conf, 1.0)),
            },
            "specialist": {
                "enabled": bool(fact.specialist.get("enabled", False)),
                "backend": str(fact.specialist.get("backend_used", fact.specialist.get("backend", "none"))),
                "hand_conf": max(0.0, min(float(specialist.get("hand_conf", 0.0)), 1.0)),
                "interaction_conf": max(0.0, min(float(specialist.get("interaction_conf", 0.0)), 1.0)),
                "proximity_score": max(0.0, min(float(specialist.get("proximity_score", 0.0)), 1.0)),
                "hand_object_distance": max(0.0, min(float(specialist.get("hand_object_distance", 1.0)), 1.0)),
                "agreement": max(0.0, min(agreement, 1.0)),
            },
            "context": {
                "zone": zone,
                "motion_score": float(fact.motion_score),
                "ts": float(fact.ts),
            },
        }

        # Keep flat keys to avoid breaking existing downstream code.
        return {
            **event_fields,
            "person_conf": normalized["detections"]["person_conf"],
            "knife_conf": normalized["detections"]["knife_conf"],
            "hand_conf": normalized["specialist"]["hand_conf"],
            "interaction_conf": normalized["specialist"]["interaction_conf"],
            "proximity_score": normalized["specialist"]["proximity_score"],
            "hand_object_distance": normalized["specialist"]["hand_object_distance"],
            "agreement": normalized["specialist"]["agreement"],
            "motion_score": normalized["context"]["motion_score"],
            "low_visibility": normalized["quality"]["low_visibility"],
            "normalized": normalized,
        }

    def process(self, fact: FrameFact) -> List[CandidateEvent]:
        out: List[CandidateEvent] = []
        dets = fact.detections
        zones = fact.zone_hits or ["unknown"]
        specialist = self._specialist_vals(fact)

        person_conf = self._find_label_conf(dets, "person")
        knife_conf = self._find_label_conf(dets, "knife")
        interaction_conf = specialist["interaction_conf"]
        hand_conf = specialist["hand_conf"]
        proximity_score = specialist["proximity_score"]

        if person_conf > 0.35 and fact.motion_score < 3.0:
            # Specialist helps lift confidence when close-up behavior agrees.
            fused_fall_conf = min(0.99, (0.70 * person_conf) + (0.20 * hand_conf) + (0.10 * interaction_conf))
            event_evidence = self._normalized_evidence(
                fact=fact,
                zone=zones[0],
                person_conf=person_conf,
                knife_conf=knife_conf,
                specialist=specialist,
                event_fields={},
            )
            out.append(
                CandidateEvent(
                    event_type="possible_fall",
                    ts=fact.ts,
                    evidence=event_evidence,
                    raw_confidence=max(0.2, fused_fall_conf),
                    zone=zones[0],
                )
            )

        if person_conf > 0.2 and knife_conf > 0.2:
            agreement = 1.0 if interaction_conf >= 0.40 else 0.0
            fused_sharp_conf = min(
                0.99,
                (0.45 * person_conf)
                + (0.35 * knife_conf)
                + (0.15 * interaction_conf)
                + (0.05 * proximity_score),
            )
            event_evidence = self._normalized_evidence(
                fact=fact,
                zone=zones[0],
                person_conf=person_conf,
                knife_conf=knife_conf,
                specialist=specialist,
                event_fields={"agreement": agreement},
            )
            out.append(
                CandidateEvent(
                    event_type="sharp_object",
                    ts=fact.ts,
                    evidence=event_evidence,
                    raw_confidence=fused_sharp_conf,
                    zone=zones[0],
                )
            )

        unsafe_hits = [z for z in zones if "unsafe" in z.lower()]
        for z in unsafe_hits:
            streak = self._unsafe_zone_streak.get(z, 0) + 1
            self._unsafe_zone_streak[z] = streak
            if streak >= 3 and fact.motion_score >= self.motion_threshold:
                event_evidence = self._normalized_evidence(
                    fact=fact,
                    zone=z,
                    person_conf=person_conf,
                    knife_conf=knife_conf,
                    specialist=specialist,
                    event_fields={
                        "zone": z,
                        "streak": streak,
                    },
                )
                out.append(
                    CandidateEvent(
                        event_type="unsafe_zone_entry",
                        ts=fact.ts,
                        evidence=event_evidence,
                        raw_confidence=min(0.99, 0.4 + (0.1 * min(streak, 5))),
                        zone=z,
                    )
                )
        return out
