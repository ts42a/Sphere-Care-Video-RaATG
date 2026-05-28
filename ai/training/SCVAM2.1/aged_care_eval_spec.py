"""
Per-scenario evaluation labels and metrics for aged-care SCVAM2.1 validation.

No labels are produced automatically — use this spec when building a review
tool or training harness. All targets are interval-based (frame ranges in the
2 fps merged timeline unless noted).
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

_SDIR = Path(__file__).resolve().parent
if str(_SDIR) not in sys.path:
    sys.path.insert(0, str(_SDIR))

from aged_care_spec import AGED_CARE_SCENARIOS

# Binary or multi-class interval annotation schema (ground truth from human review).
LABEL_SCHEMA: dict[str, Any] = {
    "clip_id": "stable id for the source video or crop",
    "frame_start": "inclusive merged frame index",
    "frame_end": "inclusive merged frame index",
    "scenario_id": "one of AGED_CARE_SCENARIO_IDS",
    "present": "bool — scenario occurs in this span",
    "severity": "optional int 1–5 for escalation drills",
    "notes": "free text for edge cases (occlusion, multiple residents)",
}

AGED_CARE_SCENARIO_IDS: tuple[str, ...] = tuple(s["id"] for s in AGED_CARE_SCENARIOS)

# Primary metric per scenario family (tune operating point on validation set).
METRICS_BY_SCENARIO: dict[str, dict[str, Any]] = {
    "fall_near_fall": {
        "primary": "recall at fixed false alarms per hour (FA/h) on bedroom/common-room clips",
        "secondary": "time-to-detection (seconds from impact proxy)",
        "calibration": "expected calibration error (ECE) on fall_like / prolonged_immobility channels",
    },
    "mobility_gait": {
        "primary": "precision at fixed recall for unstable_gait intervals",
        "secondary": "mean duration error vs clinician-labeled unstable segments",
        "calibration": "Brier score on event_probs",
    },
    "prolonged_immobility": {
        "primary": "recall at fixed FA/day for sustained immobility (define min duration in labelling)",
        "secondary": "positive predictive value with nurse confirmation",
        "calibration": "ECE on prolonged_immobility channel",
    },
    "wandering_exit": {
        "primary": "precision at fixed recall on wandering_like vs benign pacing",
        "secondary": "false positives when camera FOV changes",
        "calibration": "Brier score on wandering_like",
    },
    "environment_hazard": {
        "primary": "precision for environment_hazard_context vs clutter-only clips",
        "secondary": "reason coverage (% events with object-related reason strings)",
        "calibration": "optional — mostly rule-assisted until spatial features exist",
    },
    "sharp_ingest_risk": {
        "primary": "recall for sharp_object_in_hand with sharp labels in GT",
        "secondary": "precision vs benign kitchen activity",
        "calibration": "ECE on sharp_object_in_hand",
    },
    "nighttime_low_light": {
        "primary": "recall degradation vs daytime on same scenario labels",
        "secondary": "confidence histogram shift on step1/step2 confidences",
        "calibration": "temperature scaling on logits if deployed",
    },
}

AGGREGATE_REPORT: dict[str, str] = {
    "summary_table": "Per scenario_id: TP / FP / FN interval counts; precision; recall; FA/h",
    "confidence_slices": "Metrics stratified by person_max_conf quartiles",
    "latency": "Wall time per Step + temporal_grn on reference hardware",
}
