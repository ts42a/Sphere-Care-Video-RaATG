"""
Aged-care scenario ↔ merge-column mapping and pipeline gaps.

Used by merge_frames (extra tracked classes + cross-frame features),
temporal_grn (rule bindings), and aged_care_eval_spec (validation labels).

RGB-only video cannot support acute medical diagnoses; scenarios below are
safety / behaviour / environment hypotheses.
"""

from __future__ import annotations

from typing import Any

# COCO / detector names — extra flat columns in step1 (beyond the original SCVAM list).
AGED_CARE_EXTRA_TRACKED_CLASSES: tuple[str, ...] = (
    "toilet",
    "sink",
    "refrigerator",
    "microwave",
    "oven",
    "remote",
    "book",
    "clock",
)

# Appended after per-frame fusion; rolling stats at 2 fps (see merge_frames post-pass).
AGED_CARE_CROSS_FRAME_FEATURES: tuple[str, ...] = (
    "ac_immobility_proxy",
    "ac_wandering_proxy",
    "ac_home_hazard_proxy",
)

# Scenario registry: primary signals and known gaps.
AGED_CARE_SCENARIOS: list[dict[str, Any]] = [
    {
        "id": "fall_near_fall",
        "description": "Sudden collapse, lying posture, high fall_score.",
        "primary_columns": (
            "step3_fall_score",
            "step3_head_below_hip_flag",
            "step3_posture_lying_score",
            "step3_torso_angle_deg",
        ),
        "gaps": "Impact audio not available; tune temporal thresholds with labeled falls.",
    },
    {
        "id": "mobility_gait",
        "description": "Shuffling, instability, asymmetry.",
        "primary_columns": (
            "step3_gait_instability_score",
            "step3_ankle_motion_asymmetry",
            "step3_torso_angle_drift_deg",
        ),
        "gaps": "Needs episode labels and calibration on aged cohorts.",
    },
    {
        "id": "prolonged_immobility",
        "description": "Person visible with very low limb motion for an extended interval.",
        "primary_columns": (
            "step1_person_present_flag",
            "step3_ankle_l_motion_norm",
            "step3_ankle_r_motion_norm",
            "step3_posture_lying_score",
            "step3_posture_sitting_score",
            "ac_immobility_proxy",
        ),
        "gaps": "Distinguish sleep vs collapse requires context and longer windows; not diagnostic.",
    },
    {
        "id": "wandering_exit",
        "description": "Large vertical / movement variability vs baseline while present.",
        "primary_columns": (
            "step1_person_present_flag",
            "step3_hip_y_norm",
            "ac_wandering_proxy",
        ),
        "gaps": "Door / exit ROI not in default merge; add ROI or room graph for real wandering.",
    },
    {
        "id": "environment_hazard",
        "description": "Clutter / trip context proxy from object load + gait.",
        "primary_columns": (
            "step1_object_count_norm",
            "step1_bed_present_flag",
            "step1_chair_present_flag",
            "step3_gait_instability_score",
            "ac_home_hazard_proxy",
        ),
        "gaps": "No person–object spatial edges in default tensor; true trip hazards need bbox relations.",
    },
    {
        "id": "sharp_ingest_risk",
        "description": "Sharp or risky handheld objects.",
        "primary_columns": (
            "step2_sharp_any_pick_flag",
            "step2_obj_in_hand_flag",
            "step2_knife_any_pick_max_conf",
        ),
        "gaps": "Hot liquids / medications need extra detectors or manual labels.",
    },
    {
        "id": "nighttime_low_light",
        "description": "Same kinematics with weaker detector confidence.",
        "primary_columns": (
            "step1_person_max_conf",
            "step2_obj_in_hand_max_conf",
            "step3_valid_joints_norm",
        ),
        "gaps": "Add IR / exposure metadata or night-specific calibration.",
    },
]
