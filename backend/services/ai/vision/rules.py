from __future__ import annotations

from typing import List

from backend.core import config as app_config

from backend.services.ai.vision.event_schema import FrameAnalysis, RuleHit


def _fmt_ts(sec: float) -> str:
    t = int(sec)
    hh, mm, ss = t // 3600, (t % 3600) // 60, t % 60
    return f"{hh:02d}:{mm:02d}:{ss:02d}"


def evaluate_frames(analyses: List[FrameAnalysis]) -> List[RuleHit]:
    hits: List[RuleHit] = []
    min_conf = app_config.AI_MIN_CONFIDENCE

    fall_streak = 0
    knife_streak = 0
    water_streak = 0

    for fa in analyses:
        ts = _fmt_ts(fa.timestamp_sec)
        labels = {d.label.lower(): d for d in fa.detections if d.confidence >= min_conf}

        if "person" in labels and labels["person"].confidence >= min_conf:
            cy = labels["person"].bbox.y + labels["person"].bbox.h / 2
            if cy > 0.72:
                fall_streak += 1
            else:
                fall_streak = 0
            if fall_streak >= 4:
                hits.append(
                    RuleHit(
                        event_type="Possible fall",
                        severity="High",
                        description="Person detected low in frame for several samples — possible fall or crawl.",
                        video_timestamp=ts,
                        ai_confidence=min(0.99, labels["person"].confidence + 0.1),
                        transcript_hint="Vision: sustained low posture in monitored area.",
                        insight_category="safety",
                        insight_priority="high",
                    )
                )
                fall_streak = 0

        if "knife" in labels:
            knife_streak += 1
            if knife_streak >= 2:
                in_bed = "bedroom" in fa.zone_hits or "bed" in fa.zone_hits
                sev = "High" if in_bed else "Medium"
                hits.append(
                    RuleHit(
                        event_type="Sharp object",
                        severity=sev,
                        description="Knife-like object detected near person"
                        + (" in private area." if in_bed else " (context: common area)."),
                        video_timestamp=ts,
                        ai_confidence=labels["knife"].confidence,
                        transcript_hint="Object class: knife-like; verify with staff.",
                        insight_category="safety",
                        insight_priority="high" if in_bed else "mid",
                    )
                )
                knife_streak = 0
        else:
            knife_streak = 0

        spill_det = labels.get("spill") or labels.get("puddle")
        if spill_det:
            water_streak += 1
            if water_streak >= 2:
                hits.append(
                    RuleHit(
                        event_type="Floor hazard",
                        severity="Medium",
                        description="Possible liquid / reflective floor patch — slip risk.",
                        video_timestamp=ts,
                        ai_confidence=max(spill_det.confidence, min_conf),
                        transcript_hint="Vision: floor anomaly; housekeeping check suggested.",
                        insight_category="environment",
                        insight_priority="mid",
                    )
                )
                water_streak = 0
        else:
            water_streak = 0

    return hits
