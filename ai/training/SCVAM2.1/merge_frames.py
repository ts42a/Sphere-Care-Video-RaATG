"""
Step 4: per-sample fusion. Joins everything Steps 1-3 produced into one
record per 2-fps sample frame and emits a unified tensor row designed for a
downstream GRN / fusion layer before the LLM.

Inputs (auto-discovered from the same run dir):
  detections/detections.json          (Step 1 -- dectator.py)
  detections/scan_summary.json        (Step 1 aggregate)
  zoom_evidence/evidence.json         (Step 2 -- zoom_evidence.py)
  pose_analysis/pose_analysis.json    (Step 3 -- pose_detection.py)

Output:
  merged/merged_frames.json
    feature_vector_names: list[str]      # canonical column ordering
    feature_vector_dim:   int            # F
    frames: [
      {
        sample_frame, sample_ts_sec, src_index,
        step1: {...},   # raw object detections at this 2-fps anchor
        step2: [...],   # one entry per zoom_evidence pick
        step3: [...],   # one entry per pose_analysis pick
        merged_signals: {...},  # human-readable cross-step view
        feature_vector: [float, ...],  # length F (sentinel-filled with 0.0)
        feature_mask:   [0/1, ...]     # length F
      },
      ...
    ]

    Aged-care (see aged_care_spec.py): extra step1 columns for bathroom/kitchen
    props; appended cross-frame scalars ac_immobility_proxy, ac_wandering_proxy,
    ac_home_hazard_proxy (rolling windows over the merged timeline).

Run (from repo root):
  python ai/models/SCVAM2.1/merge_frames.py
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

import numpy as np

_SCVAM_DIR = Path(__file__).resolve().parent
if str(_SCVAM_DIR) not in sys.path:
    sys.path.insert(0, str(_SCVAM_DIR))

from aged_care_spec import AGED_CARE_CROSS_FRAME_FEATURES, AGED_CARE_EXTRA_TRACKED_CLASSES
from pose_detection import FEATURE_NAMES as CANONICAL_STEP3_FEATURE_NAMES

# --------------------------------------------------------------------------
# Step 1 object classes we want flat columns for. These are the "safety"
# classes the rest of the pipeline cares about. Anything detected outside
# this list is still kept inside step1.detections, just not given a
# dedicated feature column. Aged-care extras (toilet, sink, ...) add context
# columns for bathroom/kitchen explainers — see aged_care_spec.py.
# --------------------------------------------------------------------------
DEFAULT_TRACKED_CLASSES: list[str] = [
    "person",
    "knife",
    "scissors",
    "fork",
    "bottle",
    "cup",
    "wine glass",
    "cell phone",
    "chair",
    "couch",
    "bed",
    "dining table",
] + list(AGED_CARE_EXTRA_TRACKED_CLASSES)

# Held-object detection sources we'll union from Step 2 evidence rows.
_HELD_KEYS_NEW = (
    "held_objects_full_frame",
    "held_objects_from_person_zoom",
    "held_objects_from_hand_zoom",
)
_HELD_KEYS_LEGACY = ("held_objects_in_frame",)  # older evidence.json field


# =============================================================================
#  filesystem
# =============================================================================

def _package_dir() -> Path:
    return Path(__file__).resolve().parent


def _newest_run_dir() -> Path | None:
    out_root = _package_dir() / "output"
    if not out_root.is_dir():
        return None
    candidates = [
        d for d in out_root.iterdir()
        if d.is_dir() and (d / "frames").is_dir()
    ]
    if not candidates:
        return None
    candidates.sort(key=lambda d: d.stat().st_mtime, reverse=True)
    return candidates[0]


def _load_json(p: Path) -> dict[str, Any] | None:
    if not p.is_file():
        return None
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception as exc:
        print(f"[WARN] could not parse {p}: {exc}")
        return None


# =============================================================================
#  feature column schema
# =============================================================================

def _step1_feature_names(tracked_classes: list[str]) -> list[str]:
    out: list[str] = [
        "step1_object_count",
        "step1_object_count_norm",
        "step1_person_present_flag",
        "step1_person_max_conf",
    ]
    for cls in tracked_classes:
        if cls == "person":
            continue  # already covered by person flag/conf
        slug = cls.replace(" ", "_")
        out.append(f"step1_{slug}_present_flag")
        out.append(f"step1_{slug}_max_conf")
    return out


_STEP2_FEATURE_NAMES: list[str] = [
    "step2_picks_emitted",
    "step2_hands_found_max",
    "step2_hands_found_mean",
    "step2_synth_hand_count",
    "step2_obj_in_hand_flag",
    "step2_obj_in_hand_max_conf",
    "step2_held_full_count_max",
    "step2_held_person_zoom_count_max",
    "step2_held_hand_zoom_count_max",
    "step2_pose_fb_used_flag",
    # any-pick aggregates: capture every object_in_hand candidate across
    # all picks, not only the canonical max-confidence winner. This keeps
    # rare-but-relevant labels (knife in one pick, bottle in another)
    # visible to the downstream temporal model.
    "step2_knife_any_pick_flag",
    "step2_knife_any_pick_max_conf",
    "step2_sharp_any_pick_flag",
    "step2_sharp_any_pick_max_conf",
    "step2_obj_in_hand_candidate_count",
]


# Labels we'll bucket as "sharp_object" when scanning per-pick candidates.
# Mirrors the categorization in zoom_evidence.py.
_SHARP_LABELS: set[str] = {"knife", "scissors", "fork"}


def _build_feature_schema(
    tracked_classes: list[str],
    pose_feature_names: list[str],
) -> list[str]:
    """Final ordering: step1 columns + step2 columns + step3 (pose) columns.
    The step3 columns keep their original names from pose_detection.py
    prefixed with `step3_` so the downstream GRN never confuses them with
    the bespoke columns from Steps 1-2."""
    cols = list(_step1_feature_names(tracked_classes))
    cols += list(_STEP2_FEATURE_NAMES)
    cols += [f"step3_{n}" for n in pose_feature_names]
    return cols


# =============================================================================
#  per-step feature builders
# =============================================================================

def _step1_features(
    step1_row: dict[str, Any] | None,
    tracked_classes: list[str],
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Return (numeric_dict, structured_dict). numeric_dict feeds the tensor;
    structured_dict is what we save inside merged_frames.json under `step1`."""
    numeric: dict[str, Any] = {n: None for n in _step1_feature_names(tracked_classes)}
    structured: dict[str, Any] = {
        "labels": [],
        "detections": [],
        "object_counts": {},
        "max_confidences": {},
    }

    if not step1_row:
        return numeric, structured

    dets = list(step1_row.get("detections") or [])
    structured["labels"] = list(step1_row.get("labels") or [])
    structured["detections"] = dets

    counts: dict[str, int] = {}
    max_confs: dict[str, float] = {}
    for d in dets:
        lab = str(d.get("label", "")).strip().lower()
        if not lab:
            continue
        counts[lab] = counts.get(lab, 0) + 1
        try:
            c = float(d.get("confidence") or 0.0)
        except Exception:
            c = 0.0
        if c > max_confs.get(lab, 0.0):
            max_confs[lab] = c
    structured["object_counts"] = counts
    structured["max_confidences"] = {k: round(v, 4) for k, v in max_confs.items()}

    total = sum(counts.values())
    numeric["step1_object_count"] = float(total)
    numeric["step1_object_count_norm"] = min(1.0, total / 10.0)
    numeric["step1_person_present_flag"] = 1.0 if counts.get("person", 0) else 0.0
    numeric["step1_person_max_conf"] = max_confs.get("person", 0.0)

    for cls in tracked_classes:
        if cls == "person":
            continue
        slug = cls.replace(" ", "_")
        cls_low = cls.lower()
        numeric[f"step1_{slug}_present_flag"] = 1.0 if counts.get(cls_low, 0) else 0.0
        numeric[f"step1_{slug}_max_conf"] = max_confs.get(cls_low, 0.0)

    return numeric, structured


def _collect_object_in_hand_candidates(
    step2_picks: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Walk every pick.hands[].object_in_hand and keep them all,
    not just the canonical max-confidence winner. Returned list is sorted
    by confidence descending so downstream code can take top-K easily."""
    out: list[dict[str, Any]] = []
    for pick in step2_picks:
        for hand in pick.get("hands") or []:
            obj = hand.get("object_in_hand")
            if not obj:
                continue
            try:
                conf = float(obj.get("confidence") or 0.0)
            except Exception:
                conf = 0.0
            out.append(
                {
                    "pick_rank": pick.get("rank"),
                    "src_index": pick.get("source_frame_index"),
                    "src_ts_sec": pick.get("source_ts_sec"),
                    "side": hand.get("side"),
                    "synthetic_hand": bool(hand.get("synthetic")),
                    "label": obj.get("label"),
                    "raw_label": obj.get("raw_label") or obj.get("label"),
                    "category": obj.get("category"),
                    "confidence": conf,
                    "confidence_grade": obj.get("confidence_grade") or "confirmed",
                    "supporting_variations": obj.get("supporting_variations") or [],
                    "n_supporters": obj.get("n_supporters"),
                    "from_hand_zoom": bool(obj.get("from_hand_zoom")),
                    "from_low_conf_retry": bool(obj.get("from_low_conf_retry")),
                    "xyxy": obj.get("xyxy"),
                    "iou_with_hand": obj.get("iou_with_hand"),
                    "containment": obj.get("containment"),
                }
            )
    out.sort(key=lambda r: r["confidence"], reverse=True)
    return out


def _step2_features(
    step2_picks: list[dict[str, Any]],
) -> tuple[dict[str, Any], list[dict[str, Any]], list[dict[str, Any]]]:
    """Aggregate across all picks belonging to one sample_frame.
    Returns (numeric, structured_picks, obj_in_hand_candidates)."""
    numeric: dict[str, Any] = {n: None for n in _STEP2_FEATURE_NAMES}
    structured: list[dict[str, Any]] = []

    if not step2_picks:
        return numeric, structured, []

    hands_found_list: list[int] = []
    synth_count = 0
    obj_in_hand_present = False
    obj_in_hand_max_conf = 0.0
    obj_in_hand_max_conf_grade: str | None = None
    obj_in_hand_grades_seen: set[str] = set()
    held_full_max = 0
    held_pz_max = 0
    held_hz_max = 0
    pose_fb_any = False

    for r in step2_picks:
        rank_row = {
            "rank": r.get("rank"),
            "src_index": r.get("source_frame_index"),
            "src_ts_sec": r.get("source_ts_sec"),
            "sharpness": r.get("sharpness"),
            "enhance_input": r.get("enhance_input"),
            "person_bbox": r.get("person_bbox"),
            "crop_bbox": r.get("crop_bbox"),
            "pose_fallback_used": r.get("pose_fallback_used"),
            "hands_found": r.get("hands_found"),
            "hands": r.get("hands"),
            "held_categories": r.get("held_categories"),
            "held_objects_full_frame": r.get("held_objects_full_frame")
            or r.get("held_objects_in_frame", []),
            "held_objects_from_person_zoom": r.get("held_objects_from_person_zoom", []),
            "held_objects_from_hand_zoom": r.get("held_objects_from_hand_zoom", []),
            "output": r.get("output"),
        }
        structured.append(rank_row)

        try:
            hands_found_list.append(int(r.get("hands_found") or 0))
        except Exception:
            pass

        for h in r.get("hands") or []:
            if h.get("synthetic"):
                synth_count += 1
            obj = h.get("object_in_hand")
            if obj:
                obj_in_hand_present = True
                grade = (obj.get("confidence_grade") or "confirmed").strip().lower()
                obj_in_hand_grades_seen.add(grade)
                try:
                    cur_conf = float(obj.get("confidence") or 0.0)
                except Exception:
                    cur_conf = 0.0
                if cur_conf > obj_in_hand_max_conf:
                    obj_in_hand_max_conf = cur_conf
                    obj_in_hand_max_conf_grade = grade
                elif obj_in_hand_max_conf_grade is None:
                    obj_in_hand_max_conf_grade = grade

        held_full_max = max(held_full_max, len(rank_row["held_objects_full_frame"]))
        held_pz_max = max(held_pz_max, len(rank_row["held_objects_from_person_zoom"]))
        held_hz_max = max(held_hz_max, len(rank_row["held_objects_from_hand_zoom"]))
        if r.get("pose_fallback_used"):
            pose_fb_any = True

    candidates = _collect_object_in_hand_candidates(step2_picks)

    knife_max_conf = 0.0
    sharp_max_conf = 0.0
    for c in candidates:
        lab = (c.get("label") or "").strip().lower()
        cat = (c.get("category") or "").strip().lower()
        conf = float(c.get("confidence") or 0.0)
        if lab == "knife" and conf > knife_max_conf:
            knife_max_conf = conf
        if (lab in _SHARP_LABELS or cat == "sharp_object") and conf > sharp_max_conf:
            sharp_max_conf = conf

    numeric["step2_picks_emitted"] = float(len(step2_picks))
    numeric["step2_hands_found_max"] = float(max(hands_found_list)) if hands_found_list else 0.0
    numeric["step2_hands_found_mean"] = (
        float(sum(hands_found_list) / len(hands_found_list)) if hands_found_list else 0.0
    )
    numeric["step2_synth_hand_count"] = float(synth_count)
    numeric["step2_obj_in_hand_flag"] = 1.0 if obj_in_hand_present else 0.0
    numeric["step2_obj_in_hand_max_conf"] = float(obj_in_hand_max_conf)
    numeric["step2_held_full_count_max"] = float(held_full_max)
    numeric["step2_held_person_zoom_count_max"] = float(held_pz_max)
    numeric["step2_held_hand_zoom_count_max"] = float(held_hz_max)
    numeric["step2_pose_fb_used_flag"] = 1.0 if pose_fb_any else 0.0
    numeric["step2_knife_any_pick_flag"] = 1.0 if knife_max_conf > 0.0 else 0.0
    numeric["step2_knife_any_pick_max_conf"] = knife_max_conf
    numeric["step2_sharp_any_pick_flag"] = 1.0 if sharp_max_conf > 0.0 else 0.0
    numeric["step2_sharp_any_pick_max_conf"] = sharp_max_conf
    numeric["step2_obj_in_hand_candidate_count"] = float(len(candidates))

    return numeric, structured, candidates


def _step3_features(
    step3_picks: list[dict[str, Any]],
    pose_feature_names: list[str],
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """For Step 3 we have a per-frame feature_vector already aligned to
    pose_feature_names. We pick the most-confident pick (highest valid_joints,
    then highest pose_det_conf) as the canonical row for the tensor and keep
    every pick inside the structured field."""
    numeric: dict[str, Any] = {f"step3_{n}": None for n in pose_feature_names}
    structured: list[dict[str, Any]] = []

    if not step3_picks:
        return numeric, structured

    for r in step3_picks:
        structured.append(
            {
                "rank": r.get("rank"),
                "src_index": r.get("source_frame_index"),
                "src_ts_sec": r.get("source_ts_sec"),
                "sharpness": r.get("sharpness"),
                "person_bbox": r.get("person_bbox"),
                "pose_det_bbox": r.get("pose_det_bbox"),
                "pose_det_conf": r.get("pose_det_conf"),
                "posture": r.get("posture"),
                "posture_scores": r.get("posture_scores"),
                "bend_angle_deg": r.get("bend_angle_deg"),
                "fall_score": r.get("fall_score"),
                "fall_like": r.get("fall_like"),
                "gait_features": r.get("gait_features"),
                "gait_instability_score": r.get("gait_instability_score"),
                "unstable_gait": r.get("unstable_gait"),
                "hand_near_object": r.get("hand_near_object"),
                "feature_vector": r.get("feature_vector"),
                "feature_mask": r.get("feature_mask"),
                "output": r.get("output"),
            }
        )

    def _key(r: dict[str, Any]) -> tuple[float, float]:
        feat = r.get("features") or {}
        valid = feat.get("valid_joints") or 0
        try:
            conf = float(r.get("pose_det_conf") or 0.0)
        except Exception:
            conf = 0.0
        return (float(valid), conf)

    canonical = max(step3_picks, key=_key)
    canon_vec = canonical.get("feature_vector") or []
    canon_mask = canonical.get("feature_mask") or []

    if len(canon_vec) != len(pose_feature_names):
        # schema drift safeguard - bail out gracefully
        return numeric, structured

    for i, name in enumerate(pose_feature_names):
        v = canon_vec[i]
        m = canon_mask[i] if i < len(canon_mask) else 0.0
        if m and v is not None:
            numeric[f"step3_{name}"] = float(v)
        else:
            numeric[f"step3_{name}"] = None

    return numeric, structured


# =============================================================================
#  cross-step summary
# =============================================================================

# Labels from zoom step-2b that count as "sharp" for audit purposes when
# step-2c later clears the detection (evidence still carries pass1 + held_verify).
_PASS1_SHARP_LABELS: frozenset[str] = frozenset({"knife", "scissors", "fork"})


def _collect_unconfirmed_sharp_pass1(
    step2_struct: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Hands where step-2b saw a sharp tool but step-2c rejected the
    detection (``cleared_false_positive``). Downstream (LLM) can say
    'possible knife' without claiming verification."""
    out: list[dict[str, Any]] = []
    seen: set[tuple[str, str, str]] = set()
    for r in step2_struct:
        for h in r.get("hands") or []:
            hv = h.get("held_verify") or {}
            if hv.get("skipped"):
                continue
            if str(hv.get("agreement") or "") != "cleared_false_positive":
                continue
            p1 = str(hv.get("pass1_top_label") or "").strip().lower()
            if p1 not in _PASS1_SHARP_LABELS:
                continue
            side = str(h.get("side") or "?")
            pick_tag = str(r.get("output") or "")
            key = (p1, side, pick_tag)
            if key in seen:
                continue
            seen.add(key)
            out.append(
                {
                    "pass1_label": p1,
                    "side": side,
                    "verify_agreement": "cleared_false_positive",
                }
            )
    return out


def _merged_signals(
    step1_struct: dict[str, Any],
    step2_struct: list[dict[str, Any]],
    step3_canonical: dict[str, Any] | None,
    step3_all_picks: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    counts = step1_struct.get("object_counts") or {}
    max_confs = step1_struct.get("max_confidences") or {}

    person_present = bool(counts.get("person", 0))
    person_conf = float(max_confs.get("person", 0.0))

    hands_visible = any((r.get("hands_found") or 0) > 0 for r in step2_struct)
    obj_in_hand = False
    obj_in_hand_label = None
    obj_in_hand_raw_label = None
    obj_in_hand_conf = 0.0
    obj_in_hand_category = None
    obj_in_hand_grade: str | None = None
    obj_in_hand_grades: set[str] = set()
    for r in step2_struct:
        for h in r.get("hands") or []:
            obj = h.get("object_in_hand")
            if obj:
                obj_in_hand = True
                grade = (obj.get("confidence_grade") or "confirmed").strip().lower()
                obj_in_hand_grades.add(grade)
                c = float(obj.get("confidence") or 0.0)
                if c > obj_in_hand_conf:
                    obj_in_hand_conf = c
                    obj_in_hand_label = obj.get("label")
                    obj_in_hand_raw_label = obj.get("raw_label") or obj.get("label")
                    obj_in_hand_category = obj.get("category")
                    obj_in_hand_grade = grade
                elif obj_in_hand_grade is None:
                    obj_in_hand_grade = grade

    posture = None
    posture_top_score = None
    fall_score_max = 0.0
    fall_like_any = False
    gait_score_max = 0.0
    unstable_any = False
    bend_angle = None
    motion_score = 0.0
    partial_visibility = False
    lower_body_visible = False
    if step3_canonical:
        posture = step3_canonical.get("posture")
        scores = step3_canonical.get("posture_scores") or {}
        if scores:
            posture_top_score = max(scores.values())
        fall_score_max = float(step3_canonical.get("fall_score") or 0.0)
        fall_like_any = bool(step3_canonical.get("fall_like"))
        gait_score_max = float(step3_canonical.get("gait_instability_score") or 0.0)
        unstable_any = bool(step3_canonical.get("unstable_gait"))
        bend_angle = step3_canonical.get("bend_angle_deg")
        gf = step3_canonical.get("gait_features") or {}
        canon_feats = step3_canonical.get("features") or {}
        partial_visibility = bool(canon_feats.get("partial_visibility"))
        lower_body_visible = bool(canon_feats.get("lower_body_visible"))

        def _f(v: Any) -> float:
            try:
                return float(v) if v is not None else 0.0
            except Exception:
                return 0.0

        a_l = _f(gf.get("ankle_l_motion_norm"))
        a_r = _f(gf.get("ankle_r_motion_norm"))
        ankle_motion = max(a_l, a_r)
        # hip_y_drift_px is in pixels relative to crop diagonal; scale roughly
        # so a 30 px drift counts as ~1.0.
        hip_drift = min(1.0, _f(gf.get("hip_y_drift_px")) / 30.0)
        # Blend ankle motion (best signal when keypoints are visible) and hip
        # drift (fallback when feet are off-frame).
        motion_score = max(0.0, min(1.0, 0.7 * ankle_motion + 0.3 * hip_drift))

    if step3_all_picks:
        for r in step3_all_picks:
            if r.get("fall_like"):
                fall_like_any = True
            try:
                fs = float(r.get("fall_score") or 0.0)
                fall_score_max = max(fall_score_max, fs)
            except Exception:
                pass

    safety_flag = bool(
        fall_like_any
        or unstable_any
        or (
            obj_in_hand
            and obj_in_hand_category in ("sharp_object",)
            and obj_in_hand_grade == "confirmed"
        )
    )

    unconfirmed_sharp_pass1 = _collect_unconfirmed_sharp_pass1(step2_struct)

    return {
        "person_present": person_present,
        "person_max_conf": round(person_conf, 4),
        "objects_present": sorted(counts.keys()),
        "object_count": int(sum(counts.values())),
        "hands_visible": hands_visible,
        "obj_in_hand": obj_in_hand,
        "obj_in_hand_label": obj_in_hand_label,
        "obj_in_hand_raw_label": obj_in_hand_raw_label,
        "obj_in_hand_category": obj_in_hand_category,
        "obj_in_hand_max_conf": round(obj_in_hand_conf, 4),
        "obj_in_hand_max_conf_grade": obj_in_hand_grade,
        "obj_in_hand_grades": sorted(obj_in_hand_grades),
        "posture": posture,
        "posture_top_score": (round(posture_top_score, 4) if posture_top_score is not None else None),
        "bend_angle_deg": bend_angle,
        "fall_score": round(fall_score_max, 4),
        "fall_like": fall_like_any,
        "gait_instability_score": round(gait_score_max, 4),
        "unstable_gait": unstable_any,
        "motion_score": round(motion_score, 4),
        # Threshold tuned from typical aged-care clips: standing in place reads
        # well below 0.10, slow walking around 0.12-0.25, brisk gait > 0.3.
        "is_moving": bool(motion_score >= 0.12),
        # `partial_visibility` is true when the person is at the frame edge
        # with their lower body cropped — the typical 'walking into / out of
        # the room' moment that downstream steps should ignore for posture.
        "partial_visibility": partial_visibility,
        "lower_body_visible": lower_body_visible,
        "any_safety_flag": safety_flag,
        "unconfirmed_sharp_pass1": unconfirmed_sharp_pass1,
    }


# =============================================================================
#  vector assembly
# =============================================================================

def _flatten_to_vector(
    numeric_step1: dict[str, Any],
    numeric_step2: dict[str, Any],
    numeric_step3: dict[str, Any],
    schema: list[str],
) -> tuple[list[float], list[float]]:
    combined: dict[str, Any] = {}
    combined.update(numeric_step1)
    combined.update(numeric_step2)
    combined.update(numeric_step3)

    vec: list[float] = []
    mask: list[float] = []
    for name in schema:
        v = combined.get(name)
        if v is None:
            vec.append(0.0)
            mask.append(0.0)
        else:
            vec.append(float(v))
            mask.append(1.0)
    return vec, mask


def _schema_index(schema: list[str]) -> dict[str, int]:
    return {n: i for i, n in enumerate(schema)}


def _append_aged_care_cross_frame_features(
    merged_frames: list[dict[str, Any]],
    schema: list[str],
    *,
    window: int = 5,
) -> None:
    """Append rolling proxies for immobility / wandering / clutter+hazard.

    Mutates each frame's feature_vector / feature_mask and extends schema in-place.
    """
    idx = _schema_index(schema)
    T = len(merged_frames)
    if T == 0:
        schema.extend(list(AGED_CARE_CROSS_FRAME_FEATURES))
        return

    def col(name: str) -> np.ndarray:
        j = idx.get(name)
        if j is None:
            return np.zeros(T, dtype=np.float64)
        out = np.zeros(T, dtype=np.float64)
        for t in range(T):
            row = merged_frames[t]
            vec = row.get("feature_vector") or []
            m = row.get("feature_mask") or []
            if j < len(vec) and j < len(m) and float(m[j]) > 0.5:
                out[t] = float(vec[j])
        return out

    person = col("step1_person_present_flag")
    obj_norm = col("step1_object_count_norm")
    hip_y = col("step3_hip_y_norm")
    a_l = col("step3_ankle_l_motion_norm")
    a_r = col("step3_ankle_r_motion_norm")
    ly = col("step3_posture_lying_score")
    sit = col("step3_posture_sitting_score")
    gait = col("step3_gait_instability_score")

    bed_k = "step1_bed_present_flag"
    chair_k = "step1_chair_present_flag"
    bed = col(bed_k) if bed_k in idx else np.zeros(T, dtype=np.float64)
    chair = col(chair_k) if chair_k in idx else np.zeros(T, dtype=np.float64)

    ankle_mean = np.clip((a_l + a_r) * 0.5, 0.0, None)
    immobile = np.zeros(T, dtype=np.float64)
    wander = np.zeros(T, dtype=np.float64)
    hazard = np.zeros(T, dtype=np.float64)
    w = max(1, int(window))
    for t in range(T):
        s = max(0, t - w + 1)
        mean_ankle = float(np.mean(ankle_mean[s : t + 1]))
        win_hip = hip_y[s : t + 1]
        std_hip = float(np.std(win_hip)) if win_hip.size > 1 else 0.0

        sit_like = max(float(ly[t]), float(sit[t]))
        immobile[t] = float(person[t]) * (1.0 - min(1.0, mean_ankle)) * sit_like
        wander[t] = float(person[t]) * float(np.tanh(std_hip * 6.0))
        clutter = min(1.0, float(obj_norm[t]) + 0.25 * bed[t] + 0.25 * chair[t])
        hazard[t] = clutter * (0.5 + 0.5 * min(1.0, float(gait[t])))

    for t, row in enumerate(merged_frames):
        vec = list(row["feature_vector"])
        m = list(row["feature_mask"])
        vec.append(round(float(immobile[t]), 5))
        vec.append(round(float(wander[t]), 5))
        vec.append(round(float(hazard[t]), 5))
        m.append(1.0)
        m.append(1.0)
        m.append(1.0)
        row["feature_vector"] = vec
        row["feature_mask"] = m

    schema.extend(list(AGED_CARE_CROSS_FRAME_FEATURES))


# =============================================================================
#  main fusion
# =============================================================================

def merge(
    run_dir: Path,
    *,
    tracked_classes: list[str],
    out_dir_name: str = "merged",
    output_filename: str = "merged_frames.json",
) -> int:
    step1 = _load_json(run_dir / "detections" / "detections.json")
    step1_summary = _load_json(run_dir / "detections" / "scan_summary.json")
    step2 = _load_json(run_dir / "zoom_evidence" / "evidence.json")
    step3 = _load_json(run_dir / "pose_analysis" / "pose_analysis.json")
    reducer_summary = _load_json(run_dir / "reduced" / "reduction_summary.json")

    if not step1:
        print(f"[ERROR] Step 1 detections.json not found under {run_dir / 'detections'}.")
        print("Run first: python ai/models/SCVAM2.1/dectator.py")
        return 1

    reducer_by_sample: dict[str, dict[str, Any]] = {}
    if reducer_summary and isinstance(reducer_summary.get("decisions"), list):
        for d in reducer_summary["decisions"]:
            sf = str(d.get("sample_frame") or "").strip()
            if sf:
                reducer_by_sample[sf] = d

    # Pin Step 3 column names to pose_detection.FEATURE_NAMES so tensor width
    # is stable even when pose_analysis.json is missing or schema drifted.
    canon_pose = list(CANONICAL_STEP3_FEATURE_NAMES)
    pose_feature_names: list[str] = canon_pose
    if step3 and step3.get("feature_vector_names"):
        parsed = list(step3["feature_vector_names"])
        if parsed != canon_pose:
            print(
                "[WARN] pose_analysis.json feature_vector_names differ from "
                "pose_detection.FEATURE_NAMES; merged tensor uses the canonical list."
            )
    schema = _build_feature_schema(tracked_classes, pose_feature_names)

    # Index Step 2 / Step 3 picks by sample_frame.
    step2_by_sample: dict[str, list[dict[str, Any]]] = {}
    if step2:
        for row in step2.get("frames") or []:
            sf = str(row.get("sample_frame") or "").strip()
            if not sf:
                continue
            step2_by_sample.setdefault(sf, []).append(row)

    step3_by_sample: dict[str, list[dict[str, Any]]] = {}
    if step3:
        for row in step3.get("frames") or []:
            sf = str(row.get("sample_frame") or "").strip()
            if not sf:
                continue
            step3_by_sample.setdefault(sf, []).append(row)

    # Re-rank picks within each sample by source_frame_index ascending so the
    # `rank` field in the merged output is deterministic.
    def _annotate_ranks(rows: list[dict[str, Any]]) -> None:
        rows.sort(key=lambda r: int(r.get("source_frame_index") or 0))
        for i, r in enumerate(rows, start=1):
            r["rank"] = i

    for rows in step2_by_sample.values():
        _annotate_ranks(rows)
    for rows in step3_by_sample.values():
        _annotate_ranks(rows)

    src_fps = float(
        (step3 or {}).get("src_fps")
        or (step2 or {}).get("src_fps")
        or 0.0
    ) or 30.0
    video_path = (
        (step3 or {}).get("video")
        or (step2 or {}).get("video")
        or ""
    )

    merged_frames: list[dict[str, Any]] = []
    samples_with_step2 = 0
    samples_with_step3 = 0
    flagged_safety = 0
    obj_in_hand_total = 0
    samples_reducer_kept = 0
    samples_reducer_dropped = 0

    for fmeta in step1.get("frames") or []:
        sample_name = str(fmeta.get("frame") or "").strip()
        if not sample_name:
            continue
        sample_ts = float(fmeta.get("ts_sec") or 0.0)
        src_index = int(fmeta.get("src_index") or round(sample_ts * src_fps))

        s1_num, s1_struct = _step1_features(fmeta, tracked_classes)

        s2_picks = step2_by_sample.get(sample_name, [])
        s2_num, s2_struct, s2_candidates = _step2_features(s2_picks)
        if s2_picks:
            samples_with_step2 += 1

        s3_picks = step3_by_sample.get(sample_name, [])
        s3_num, s3_struct = _step3_features(s3_picks, pose_feature_names)
        if s3_picks:
            samples_with_step3 += 1

        # Pick the canonical step3 row again (same logic) for merged_signals.
        canonical_s3 = None
        if s3_picks:
            def _key(r: dict[str, Any]) -> tuple[float, float]:
                feat = r.get("features") or {}
                valid = feat.get("valid_joints") or 0
                try:
                    conf = float(r.get("pose_det_conf") or 0.0)
                except Exception:
                    conf = 0.0
                return (float(valid), conf)
            canonical_s3 = max(s3_picks, key=_key)

        merged = _merged_signals(s1_struct, s2_struct, canonical_s3, s3_picks)
        if merged.get("any_safety_flag"):
            flagged_safety += 1
        if merged.get("obj_in_hand"):
            obj_in_hand_total += 1

        feature_vec, feature_mask = _flatten_to_vector(
            s1_num, s2_num, s3_num, schema
        )

        label_set = sorted({
            c["label"] for c in s2_candidates if c.get("label")
        })
        category_set = sorted({
            c["category"] for c in s2_candidates if c.get("category")
        })

        reducer_info: dict[str, Any] | None = None
        if reducer_by_sample:
            d = reducer_by_sample.get(sample_name)
            if d is not None:
                kept = bool(d.get("kept"))
                reducer_info = {
                    "kept": kept,
                    "motion": float(d.get("motion") or 0.0),
                    "reasons": list(d.get("reasons") or []),
                }
                if kept:
                    samples_reducer_kept += 1
                else:
                    samples_reducer_dropped += 1

        merged_frames.append(
            {
                "sample_frame": sample_name,
                "sample_ts_sec": round(sample_ts, 4),
                "src_index": src_index,
                "src_ts_sec": round(src_index / src_fps, 4),
                "reducer": reducer_info,
                "step1": s1_struct,
                "step2": s2_struct,
                "step3": s3_struct,
                "merged_signals": merged,
                "obj_in_hand_candidates": s2_candidates,
                "obj_in_hand_label_set": label_set,
                "obj_in_hand_category_set": category_set,
                "feature_vector": [round(v, 5) for v in feature_vec],
                "feature_mask": feature_mask,
            }
        )

    _append_aged_care_cross_frame_features(merged_frames, schema)

    out_dir = run_dir / out_dir_name
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / output_filename

    reducer_block: dict[str, Any] | None = None
    if reducer_summary:
        reducer_block = {
            "ran": True,
            "n_total": int(reducer_summary.get("n_total") or len(merged_frames)),
            "n_kept": int(reducer_summary.get("n_kept") or samples_reducer_kept),
            "n_dropped": int(reducer_summary.get("n_dropped") or samples_reducer_dropped),
            "compute_saved_pct_step2_step3": reducer_summary.get(
                "compute_saved_pct_step2_step3"
            ),
            "motion_threshold": reducer_summary.get("motion_threshold"),
            "keepalive_sec": reducer_summary.get("keepalive_sec"),
            "tracked_classes": reducer_summary.get("tracked_classes"),
            "state_counts": reducer_summary.get("state_counts") or {},
            "idle_intervals": reducer_summary.get("idle_intervals") or [],
            "n_idle_intervals": int(reducer_summary.get("n_idle_intervals") or 0),
            "n_frames_idle_collapsed": int(
                reducer_summary.get("n_frames_idle_collapsed") or 0
            ),
        }
    elif reducer_by_sample:
        reducer_block = {
            "ran": True,
            "n_kept": samples_reducer_kept,
            "n_dropped": samples_reducer_dropped,
        }
    else:
        reducer_block = {"ran": False}

    payload = {
        "run_dir": run_dir.as_posix(),
        "video": video_path,
        "src_fps": src_fps,
        "tracked_classes": tracked_classes,
        "step1_classes_seen": [c.get("label") for c in (step1_summary or {}).get("classes") or []],
        "step1_classes_never_seen": list((step1_summary or {}).get("classes_never_seen") or []),
        "feature_vector_names": schema,
        "feature_vector_dim": len(schema),
        "samples_total": len(merged_frames),
        "samples_with_step2": samples_with_step2,
        "samples_with_step3": samples_with_step3,
        "samples_obj_in_hand": obj_in_hand_total,
        "samples_safety_flagged": flagged_safety,
        "reducer": reducer_block,
        "frames": merged_frames,
    }
    out_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")

    print(
        f"Merged {len(merged_frames)} samples "
        f"(step2={samples_with_step2}/{len(merged_frames)}, "
        f"step3={samples_with_step3}/{len(merged_frames)}).\n"
        f"  feature_vector_dim: {len(schema)}\n"
        f"  obj_in_hand samples: {obj_in_hand_total}\n"
        f"  safety_flagged samples: {flagged_safety}"
    )
    if reducer_block and reducer_block.get("ran"):
        print(
            f"  reducer: kept={reducer_block.get('n_kept')} "
            f"dropped={reducer_block.get('n_dropped')} "
            f"saved={reducer_block.get('compute_saved_pct_step2_step3')}%"
        )
    else:
        print("  reducer: not run (run reducer.py before merge to surface decisions)")
    print(f"Wrote: {out_path}")
    return 0


# =============================================================================
#  CLI
# =============================================================================

def _parse_classes(raw: str) -> list[str]:
    return [c.strip() for c in raw.split(",") if c.strip()]


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Step 4: merge per-frame detections from Steps 1-3 into a unified record."
    )
    parser.add_argument(
        "--run",
        default="",
        help="Run dir (default: newest under ai/models/SCVAM2.1/output).",
    )
    parser.add_argument(
        "--tracked-classes",
        default=",".join(DEFAULT_TRACKED_CLASSES),
        help="Comma-separated COCO class names that get a dedicated "
        "presence-flag + max-confidence column in the feature vector. "
        "Other detected classes are still kept in step1.detections.",
    )
    parser.add_argument(
        "--out-dir",
        default="merged",
        help="Subfolder name inside the run dir to drop the JSON in (default 'merged').",
    )
    parser.add_argument(
        "--filename",
        default="merged_frames.json",
        help="Output filename (default 'merged_frames.json').",
    )
    args = parser.parse_args()

    if args.run:
        run_dir = Path(args.run).expanduser().resolve()
    else:
        latest = _newest_run_dir()
        if latest is None:
            print(
                "No --run given and nothing under ai/models/SCVAM2.1/output/*/frames.\n"
                "Run preprocess.py and dectator.py first."
            )
            return 1
        run_dir = latest

    return merge(
        run_dir,
        tracked_classes=_parse_classes(args.tracked_classes),
        out_dir_name=args.out_dir,
        output_filename=args.filename,
    )


if __name__ == "__main__":
    sys.exit(main())
