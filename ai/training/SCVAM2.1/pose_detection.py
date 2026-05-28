"""
Step 3: pose & posture analysis on the same timestamp windows that Step 2
already inspected for held objects.

For every sample where Step 1 detected a person, this script reopens the
*source* video, walks the sub-second window around the timestamp, runs YOLO
pose on the person crop, and from the 17 COCO keypoints derives:

    - posture_scores     : soft probabilities over {standing, sitting, lying, unknown}
    - bend_angle_deg     : torso lean off vertical
    - fall_score         : continuous fall-risk in [0, 1]
    - gait_features      : numeric measurements + gait_instability_score in [0, 1]
                           (knee asymmetry, torso lean, stance width, cross-frame
                            hip drift, torso wobble, ankle motion per side, asym.)
    - hand_near_object   : numeric distances per wrist to nearest Step-2 held object
    - feature_vector     : a fixed-length flat array per frame whose column names
                           are declared once at the top of pose_analysis.json
                           (designed for direct tensor consumption upstream of a
                            GRN / fusion model before the LLM)

Run (from repo root):
    python ai/models/SCVAM2.1/pose_detection.py

Outputs (under ai/models/SCVAM2.1/output/<stem>_<fps>fps/):
    pose_analysis/
        frame_000001_pick1_src000015.png   (annotated pose + label badge)
        ...
        pose_analysis.json                 (machine-readable summary)
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path
from typing import Any

import cv2
import numpy as np

SELECTED_NAME = "SELECTED_VIDEO.txt"

# -------- COCO 17 keypoint indices used by yolov8n-pose --------------------
_KP_NAMES = [
    "nose",
    "l_eye",
    "r_eye",
    "l_ear",
    "r_ear",
    "l_shoulder",
    "r_shoulder",
    "l_elbow",
    "r_elbow",
    "l_wrist",
    "r_wrist",
    "l_hip",
    "r_hip",
    "l_knee",
    "r_knee",
    "l_ankle",
    "r_ankle",
]
KP = {name: idx for idx, name in enumerate(_KP_NAMES)}

# --------------------------------------------------------------------------
# FEATURE_NAMES is the canonical column ordering for the per-frame
# `feature_vector` we emit. Anything you'd like a downstream GRN / fusion
# layer to ingest must appear here. `feature_mask` parallels this list:
# 1.0 = value present, 0.0 = missing (sentinel filled with 0.0 in the vector).
# --------------------------------------------------------------------------
FEATURE_NAMES: list[str] = [
    # raw geometry
    "torso_angle_deg",
    "torso_len_norm",                 # torso length / frame_h
    "knee_angle_l_deg",
    "knee_angle_r_deg",
    "knee_asymmetry_deg",
    "stance_width_norm",              # ankle spread / hip width
    "bbox_aspect_h_over_w",
    "bbox_h_norm",                    # det_box height / frame_h
    "bbox_w_norm",                    # det_box width / frame_w
    "head_below_hip_flag",            # 0 / 1
    "valid_joints_norm",              # count / 17
    # vertical anchor positions (normalized to frame height)
    "head_y_norm",
    "shoulder_y_norm",
    "hip_y_norm",
    "knee_y_norm",
    "ankle_y_norm",
    # cross-frame gait dynamics
    "hip_y_drift_norm",               # (max-min hip_y across window) / frame_h
    "torso_angle_drift_deg",
    "ankle_l_motion_norm",            # ankle-L bbox-diagonal across window / frame_diag
    "ankle_r_motion_norm",
    "ankle_motion_asymmetry",         # |L-R| / (L+R+eps)
    # fused scores
    "fall_score",
    "gait_instability_score",
    "posture_standing_score",
    "posture_sitting_score",
    "posture_lying_score",
    "posture_unknown_score",
    # hand-near-object (from Step 2)
    "l_wrist_obj_dist_norm",          # nearest held-obj distance / frame_diag
    "r_wrist_obj_dist_norm",
    "min_wrist_obj_dist_norm",
    "hand_near_any_flag",             # 0 / 1
]


# (a, b) line segments for drawing the skeleton.
_POSE_EDGES = [
    (KP["l_shoulder"], KP["r_shoulder"]),
    (KP["l_shoulder"], KP["l_elbow"]),
    (KP["l_elbow"], KP["l_wrist"]),
    (KP["r_shoulder"], KP["r_elbow"]),
    (KP["r_elbow"], KP["r_wrist"]),
    (KP["l_shoulder"], KP["l_hip"]),
    (KP["r_shoulder"], KP["r_hip"]),
    (KP["l_hip"], KP["r_hip"]),
    (KP["l_hip"], KP["l_knee"]),
    (KP["l_knee"], KP["l_ankle"]),
    (KP["r_hip"], KP["r_knee"]),
    (KP["r_knee"], KP["r_ankle"]),
    (KP["nose"], KP["l_eye"]),
    (KP["nose"], KP["r_eye"]),
    (KP["l_eye"], KP["l_ear"]),
    (KP["r_eye"], KP["r_ear"]),
]


# =============================================================================
#  filesystem helpers (mirrored from the rest of the SCVAM2.1 pipeline)
# =============================================================================

def _package_dir() -> Path:
    return Path(__file__).resolve().parent


def _read_selected_video() -> Path | None:
    p = _package_dir() / SELECTED_NAME
    if not p.is_file():
        return None
    raw = p.read_text(encoding="utf-8").strip()
    return Path(raw) if raw else None


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


def _load_step1_detections(run_dir: Path) -> dict[str, Any] | None:
    p = run_dir / "detections" / "detections.json"
    if not p.is_file():
        return None
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return None


def _load_active_frames(run_dir: Path) -> set[str] | None:
    """Return the set of sample_frame names produced by reducer.py, or None
    if the reducer hasn't been run / its output is missing."""
    p = run_dir / "reduced" / "active_frames.json"
    if not p.is_file():
        return None
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return None
    names = data.get("active_frames") if isinstance(data, dict) else None
    if not isinstance(names, list):
        return None
    return {str(n) for n in names if isinstance(n, str)}


def _load_step2_evidence(run_dir: Path) -> dict[str, Any] | None:
    p = run_dir / "zoom_evidence" / "evidence.json"
    if not p.is_file():
        return None
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return None


# =============================================================================
#  pose model loading
# =============================================================================

def _load_pose_model(weights: Path | None):
    try:
        from ultralytics import YOLO  # type: ignore
    except Exception as exc:
        print(
            f"[ERROR] ultralytics not installed ({exc}); cannot run pose model.\n"
            "        pip install ultralytics"
        )
        return None
    if weights is not None and weights.is_file():
        try:
            return YOLO(str(weights))
        except Exception as exc:
            print(f"[WARN] could not load pose weights {weights}: {exc}")
    try:
        return YOLO("yolov8n-pose.pt")
    except Exception as exc:
        print(f"[ERROR] could not auto-download yolov8n-pose.pt: {exc}")
        return None


# =============================================================================
#  geometry helpers
# =============================================================================

def _person_bbox_from_dets(dets: list[dict[str, Any]]) -> tuple[float, float, float, float] | None:
    best: tuple[float, float, float, float] | None = None
    best_area = 0.0
    for d in dets:
        if str(d.get("label", "")).strip().lower() != "person":
            continue
        try:
            x1, y1, x2, y2 = (float(v) for v in d["xyxy"])
        except Exception:
            continue
        area = max(0.0, x2 - x1) * max(0.0, y2 - y1)
        if area > best_area:
            best_area = area
            best = (x1, y1, x2, y2)
    return best


def _expand_bbox(bbox, frame_w: int, frame_h: int, pad: float):
    x1, y1, x2, y2 = bbox
    bw, bh = x2 - x1, y2 - y1
    px, py = bw * pad, bh * pad
    return (
        max(0.0, x1 - px),
        max(0.0, y1 - py),
        min(float(frame_w - 1), x2 + px),
        min(float(frame_h - 1), y2 + py),
    )


def _laplacian_var(gray: np.ndarray) -> float:
    return float(cv2.Laplacian(gray, cv2.CV_64F).var())


def _midpoint(p: tuple[float, float] | None, q: tuple[float, float] | None):
    if p is None or q is None:
        return None
    return ((p[0] + q[0]) / 2.0, (p[1] + q[1]) / 2.0)


def _dist(a: tuple[float, float] | None, b: tuple[float, float] | None) -> float | None:
    if a is None or b is None:
        return None
    dx, dy = a[0] - b[0], a[1] - b[1]
    return math.hypot(dx, dy)


def _angle_at(a, b, c) -> float | None:
    """Interior angle in degrees at vertex `b` formed by points a-b-c.
    Returns None if any point is missing or the segments collapse."""
    if a is None or b is None or c is None:
        return None
    v1 = (a[0] - b[0], a[1] - b[1])
    v2 = (c[0] - b[0], c[1] - b[1])
    n1 = math.hypot(*v1)
    n2 = math.hypot(*v2)
    if n1 < 1e-6 or n2 < 1e-6:
        return None
    cos_t = (v1[0] * v2[0] + v1[1] * v2[1]) / (n1 * n2)
    cos_t = max(-1.0, min(1.0, cos_t))
    return math.degrees(math.acos(cos_t))


def _angle_from_vertical(p_top, p_bottom) -> float | None:
    """Return angle in degrees between vector (top->bottom) and image-vertical
    (downwards y axis). 0 = perfectly upright, 90 = horizontal."""
    if p_top is None or p_bottom is None:
        return None
    dx = p_bottom[0] - p_top[0]
    dy = p_bottom[1] - p_top[1]
    norm = math.hypot(dx, dy)
    if norm < 1e-6:
        return None
    cos_t = dy / norm  # dot with (0,1)
    cos_t = max(-1.0, min(1.0, cos_t))
    return math.degrees(math.acos(cos_t))


# =============================================================================
#  pose extraction
# =============================================================================

def _extract_keypoints(
    model,
    frame_bgr: np.ndarray,
    crop_box: tuple[float, float, float, float] | None,
    *,
    person_conf: float,
    kp_conf: float,
):
    """Run pose on the (cropped) person region, return:
        kpts:    list of 17 dicts {name, x, y, conf} in *full-frame* px;
                 keypoints below `kp_conf` are stored with conf set but the
                 caller should treat them as missing via _kp() below.
        det_box: (x1,y1,x2,y2) the pose model's own person bbox in full-frame
                 coords, or None if nothing found.
        person_conf: confidence of the chosen person."""
    if model is None:
        return None, None, 0.0
    h, w = frame_bgr.shape[:2]
    if crop_box is None:
        view = frame_bgr
        x_off, y_off = 0, 0
    else:
        cx1, cy1, cx2, cy2 = (int(round(v)) for v in crop_box)
        cx2 = max(cx1 + 1, cx2)
        cy2 = max(cy1 + 1, cy2)
        view = frame_bgr[cy1:cy2, cx1:cx2]
        if view.size == 0:
            return None, None, 0.0
        x_off, y_off = cx1, cy1
    try:
        res = model(view, verbose=False, conf=person_conf)[0]
    except Exception:
        return None, None, 0.0
    if res.keypoints is None or len(res.keypoints) == 0:
        return None, None, 0.0
    # Pick the largest detected person inside the crop view.
    best_idx = 0
    best_area = 0.0
    if res.boxes is not None and len(res.boxes) > 0:
        for i in range(len(res.boxes)):
            x1, y1, x2, y2 = res.boxes.xyxy[i].tolist()
            area = max(0.0, x2 - x1) * max(0.0, y2 - y1)
            if area > best_area:
                best_area = area
                best_idx = i
    try:
        kpts_xy = res.keypoints.xy[best_idx].tolist()
    except Exception:
        return None, None, 0.0
    if hasattr(res.keypoints, "conf") and res.keypoints.conf is not None:
        try:
            kp_confs = res.keypoints.conf[best_idx].tolist()
        except Exception:
            kp_confs = [1.0] * len(kpts_xy)
    else:
        kp_confs = [1.0] * len(kpts_xy)

    out: list[dict[str, Any]] = []
    for idx, name in enumerate(_KP_NAMES):
        if idx >= len(kpts_xy):
            out.append({"name": name, "x": None, "y": None, "conf": 0.0})
            continue
        x, y = kpts_xy[idx]
        c = float(kp_confs[idx]) if idx < len(kp_confs) else 1.0
        if (x <= 0 and y <= 0) or c < kp_conf:
            out.append({"name": name, "x": None, "y": None, "conf": c})
            continue
        out.append({"name": name, "x": float(x_off + x), "y": float(y_off + y), "conf": c})

    det_box: tuple[float, float, float, float] | None = None
    chosen_conf = 0.0
    if res.boxes is not None and best_idx < len(res.boxes):
        bx = res.boxes.xyxy[best_idx].tolist()
        det_box = (
            float(x_off + bx[0]),
            float(y_off + bx[1]),
            float(x_off + bx[2]),
            float(y_off + bx[3]),
        )
        try:
            chosen_conf = float(res.boxes.conf[best_idx])
        except Exception:
            chosen_conf = 0.0
    return out, det_box, chosen_conf


def _kp(kpts: list[dict[str, Any]] | None, name: str) -> tuple[float, float] | None:
    if not kpts:
        return None
    idx = KP.get(name)
    if idx is None or idx >= len(kpts):
        return None
    item = kpts[idx]
    if item["x"] is None or item["y"] is None:
        return None
    return (float(item["x"]), float(item["y"]))


# =============================================================================
#  posture / fall / gait classifiers
# =============================================================================

def _compute_features(
    kpts: list[dict[str, Any]] | None,
    det_box: tuple[float, float, float, float] | None,
    frame_h: int,
    frame_w: int | None = None,
) -> dict[str, Any]:
    """Pull all numeric features we need from one frame's keypoints.

    Also derives a ``partial_visibility`` flag for the case where the
    person is entering / leaving the scene: the bbox touches a frame edge
    AND lower-body keypoints (knees/ankles) are not visible. Without this
    guard the heuristic posture classifier tends to call cropped figures
    'sitting' because the missing knees + reduced bbox aspect look just
    like a seated upper body.
    """
    feat: dict[str, Any] = {
        "torso_angle_deg": None,
        "torso_len_px": None,
        "knee_angle_l_deg": None,
        "knee_angle_r_deg": None,
        "knee_asymmetry_deg": None,
        "hip_y": None,
        "knee_y": None,
        "ankle_y": None,
        "head_y": None,
        "shoulder_y": None,
        "bbox_aspect_h_over_w": None,
        "bbox_bottom_px_to_image_bottom": None,
        "stance_width_norm": None,
        "head_below_hip": None,
        "valid_joints": 0,
        "lower_body_visible": False,
        "clipped_left": False,
        "clipped_right": False,
        "clipped_top": False,
        "clipped_bottom": False,
        "partial_visibility": False,
    }

    if not kpts:
        # Pose model couldn't lock onto the person at all even though Step 1
        # said one was here. That almost always means they're in the act of
        # entering / leaving the room (partially visible at the frame edge),
        # so flag the frame as partial_visibility and bail out.
        feat["partial_visibility"] = True
        return feat

    feat["valid_joints"] = sum(1 for k in kpts if k["x"] is not None)

    sh_l = _kp(kpts, "l_shoulder")
    sh_r = _kp(kpts, "r_shoulder")
    hp_l = _kp(kpts, "l_hip")
    hp_r = _kp(kpts, "r_hip")
    kn_l = _kp(kpts, "l_knee")
    kn_r = _kp(kpts, "r_knee")
    an_l = _kp(kpts, "l_ankle")
    an_r = _kp(kpts, "r_ankle")
    nose = _kp(kpts, "nose")

    sh_mid = _midpoint(sh_l, sh_r)
    hp_mid = _midpoint(hp_l, hp_r)

    if sh_mid is not None and hp_mid is not None:
        feat["torso_angle_deg"] = _angle_from_vertical(sh_mid, hp_mid)
        feat["torso_len_px"] = _dist(sh_mid, hp_mid)

    feat["knee_angle_l_deg"] = _angle_at(hp_l, kn_l, an_l)
    feat["knee_angle_r_deg"] = _angle_at(hp_r, kn_r, an_r)
    if feat["knee_angle_l_deg"] is not None and feat["knee_angle_r_deg"] is not None:
        feat["knee_asymmetry_deg"] = abs(feat["knee_angle_l_deg"] - feat["knee_angle_r_deg"])

    if hp_mid is not None:
        feat["hip_y"] = hp_mid[1]
    if sh_mid is not None:
        feat["shoulder_y"] = sh_mid[1]
    if nose is not None:
        feat["head_y"] = nose[1]
    if kn_l is not None and kn_r is not None:
        feat["knee_y"] = (kn_l[1] + kn_r[1]) / 2.0
    elif kn_l is not None:
        feat["knee_y"] = kn_l[1]
    elif kn_r is not None:
        feat["knee_y"] = kn_r[1]
    if an_l is not None and an_r is not None:
        feat["ankle_y"] = (an_l[1] + an_r[1]) / 2.0
    elif an_l is not None:
        feat["ankle_y"] = an_l[1]
    elif an_r is not None:
        feat["ankle_y"] = an_r[1]

    if hp_mid is not None and feat["head_y"] is not None:
        feat["head_below_hip"] = bool(feat["head_y"] > hp_mid[1])

    if det_box is not None:
        x1, y1, x2, y2 = det_box
        bw = max(1.0, x2 - x1)
        bh = max(1.0, y2 - y1)
        feat["bbox_aspect_h_over_w"] = bh / bw
        feat["bbox_bottom_px_to_image_bottom"] = max(0.0, frame_h - y2)

        # Frame-edge clipping. A bbox edge within ~2 % of the frame is
        # treated as clipped — that's the signature of a person entering
        # or leaving the scene, where the lower body or a side gets cut
        # off and the posture classifier can't see knees/ankles cleanly.
        if frame_w and frame_w > 0:
            edge_x = max(2.0, 0.02 * float(frame_w))
            feat["clipped_left"] = bool(x1 <= edge_x)
            feat["clipped_right"] = bool(x2 >= float(frame_w) - edge_x)
        if frame_h and frame_h > 0:
            edge_y = max(2.0, 0.02 * float(frame_h))
            feat["clipped_top"] = bool(y1 <= edge_y)
            feat["clipped_bottom"] = bool(y2 >= float(frame_h) - edge_y)

    knees_visible = kn_l is not None or kn_r is not None
    ankles_visible = an_l is not None or an_r is not None
    feat["lower_body_visible"] = bool(knees_visible and ankles_visible)

    edge_clipped = bool(
        feat["clipped_left"]
        or feat["clipped_right"]
        or feat["clipped_top"]
        or feat["clipped_bottom"]
    )
    short_box = (
        feat.get("bbox_aspect_h_over_w") is not None
        and float(feat["bbox_aspect_h_over_w"]) < 1.6
    )
    too_few_joints = int(feat["valid_joints"]) < 10
    feat["partial_visibility"] = bool(
        (edge_clipped and not feat["lower_body_visible"])
        or (short_box and not feat["lower_body_visible"])
        or (too_few_joints and not feat["lower_body_visible"])
    )

    if an_l is not None and an_r is not None and hp_l is not None and hp_r is not None:
        hip_w = abs(hp_l[0] - hp_r[0]) or 1.0
        ankle_spread = abs(an_l[0] - an_r[0])
        feat["stance_width_norm"] = ankle_spread / hip_w

    return feat


def _clip01(v: float) -> float:
    return 0.0 if v < 0.0 else (1.0 if v > 1.0 else v)


def _compute_posture_scores(feat: dict[str, Any]) -> dict[str, float]:
    """Soft probabilities over {standing, sitting, lying, unknown}.
    Built from heuristic 'logits' that are then normalized to sum to 1.
    All scores live in [0, 1] so they can flow straight into a tensor."""
    angle = feat.get("torso_angle_deg")
    aspect = feat.get("bbox_aspect_h_over_w")
    hip_y = feat.get("hip_y")
    knee_y = feat.get("knee_y")
    ankle_y = feat.get("ankle_y")
    knee_l = feat.get("knee_angle_l_deg")
    knee_r = feat.get("knee_angle_r_deg")
    knees_avail = [k for k in (knee_l, knee_r) if k is not None]
    knee_min = min(knees_avail) if knees_avail else None

    # ---- standing logit ---------------------------------------------------
    standing_parts: list[float] = []
    if angle is not None:
        standing_parts.append(_clip01(1.0 - angle / 30.0))
    if aspect is not None:
        standing_parts.append(_clip01((aspect - 1.0) / 0.8))
    if knee_min is not None:
        standing_parts.append(_clip01((knee_min - 130.0) / 50.0))
    if hip_y is not None and ankle_y is not None:
        standing_parts.append(1.0 if ankle_y > hip_y + 30 else 0.0)
    standing_logit = sum(standing_parts) / max(1, len(standing_parts))

    # ---- sitting logit ----------------------------------------------------
    sitting_parts: list[float] = []
    if angle is not None:
        sitting_parts.append(_clip01(1.0 - angle / 40.0))
    if knee_min is not None:
        sitting_parts.append(_clip01((140.0 - knee_min) / 50.0))
    if hip_y is not None and knee_y is not None:
        gap = abs(knee_y - hip_y)
        sitting_parts.append(_clip01(1.0 - max(0.0, gap - 40.0) / 80.0))
    if aspect is not None:
        sitting_parts.append(_clip01(1.0 - max(0.0, 1.4 - aspect) / 0.8))
    sitting_logit = sum(sitting_parts) / max(1, len(sitting_parts))

    # ---- lying logit ------------------------------------------------------
    lying_parts: list[float] = []
    if angle is not None:
        lying_parts.append(_clip01((angle - 30.0) / 60.0))
    if aspect is not None:
        lying_parts.append(_clip01((1.2 - aspect) / 0.7))
    if feat.get("head_below_hip") is True:
        lying_parts.append(1.0)
    lying_logit = sum(lying_parts) / max(1, len(lying_parts)) if lying_parts else 0.0

    # ---- unknown ----------------------------------------------------------
    valid = feat.get("valid_joints") or 0
    unknown_logit = max(0.0, 1.0 - valid / 17.0) * 0.5
    if max(standing_logit, sitting_logit, lying_logit) < 0.25:
        unknown_logit = max(unknown_logit, 0.5)

    # Scene-entry / scene-exit guard. When the bbox is clipped against a
    # frame edge (or simply too short / too few joints) and we never see
    # the lower body, suppress the 'sitting' signal — almost every false
    # 'sitting' in aged-care clips comes from someone walking into / out
    # of the room with their knees off-frame, which makes the classifier
    # think the legs are tucked.
    if feat.get("partial_visibility"):
        sitting_logit *= 0.25
        unknown_logit = max(unknown_logit, 0.6)

    total = standing_logit + sitting_logit + lying_logit + unknown_logit
    if total < 1e-6:
        return {"standing": 0.0, "sitting": 0.0, "lying": 0.0, "unknown": 1.0}
    return {
        "standing": standing_logit / total,
        "sitting": sitting_logit / total,
        "lying": lying_logit / total,
        "unknown": unknown_logit / total,
    }


def _compute_fall_score(feat: dict[str, Any], frame_h: int) -> float:
    """Continuous fall risk in [0, 1]. Each individual signal is mapped to
    [0, 1] and averaged - missing signals are simply skipped (no penalty)."""
    parts: list[float] = []
    angle = feat.get("torso_angle_deg")
    aspect = feat.get("bbox_aspect_h_over_w")
    head_below_hip = feat.get("head_below_hip")
    bottom = feat.get("bbox_bottom_px_to_image_bottom")

    if angle is not None:
        parts.append(_clip01((angle - 30.0) / 60.0))
    if aspect is not None:
        parts.append(_clip01((1.2 - aspect) / 1.0))
    if head_below_hip is not None:
        parts.append(1.0 if head_below_hip else 0.0)
    if bottom is not None and frame_h > 0:
        ratio = bottom / float(frame_h)
        parts.append(1.0 if ratio < 0.05 else _clip01(1.0 - ratio / 0.15))
    if not parts:
        return 0.0
    return sum(parts) / len(parts)


def _should_flag_fall_like(
    fall_score: float,
    fall_threshold: float,
    posture: str,
    posture_scores: dict[str, float],
    bend_angle_deg: float | None,
    *,
    partial_visibility: bool = False,
) -> bool:
    """True when continuous fall_score crosses the threshold, or when the
    pose is strongly *lying* with a large torso bend — typical of someone
    on the floor after a collapse, even if the blended fall_score is just
    below threshold (e.g. 0.45 vs 0.55).

    When ``partial_visibility`` is true (person entering / leaving the
    scene with their lower body cropped) we never fire fall_like: those
    frames produce spurious fall_score because the bbox aspect ratio
    looks short and the bbox bottom touches the frame edge.
    """
    if partial_visibility:
        return False
    if fall_score >= fall_threshold:
        return True
    lying_s = float(posture_scores.get("lying") or 0.0)
    try:
        bend = float(bend_angle_deg) if bend_angle_deg is not None else 0.0
    except Exception:
        bend = 0.0
    if (
        posture == "lying"
        and lying_s >= 0.55
        and bend >= 50.0
    ):
        return True
    return False


def _ankle_motion_norm(rows_sorted: list[dict[str, Any]], side_letter: str, frame_diag: float) -> float | None:
    """Diagonal extent of one ankle keypoint across the temporal window,
    normalized to the image diagonal so it stays in roughly [0, 1]."""
    pts: list[tuple[float, float]] = []
    for r in rows_sorted:
        kp = _kp(r.get("kpts"), f"{side_letter}_ankle")
        if kp is not None:
            pts.append(kp)
    if len(pts) < 2 or frame_diag <= 0:
        return None
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    span = math.hypot(max(xs) - min(xs), max(ys) - min(ys))
    return _clip01(span / frame_diag)


def _compute_gait_features(
    feat: dict[str, Any],
    rows_sorted_by_time: list[dict[str, Any]],
    frame_w: int,
    frame_h: int,
) -> dict[str, Any]:
    """Numeric measurement vector + an aggregate `gait_instability_score`.
    Designed so a fusion model (GRN -> LLM) can consume the whole dict
    rather than a single yes/no flag."""
    frame_diag = math.hypot(frame_w, frame_h) or 1.0

    knee_asym = feat.get("knee_asymmetry_deg")
    torso_lean_abs = (
        abs(feat["torso_angle_deg"]) if feat.get("torso_angle_deg") is not None else None
    )
    stance_w = feat.get("stance_width_norm")

    hips = [
        r["features"]["hip_y"]
        for r in rows_sorted_by_time
        if r["features"].get("hip_y") is not None
    ]
    angles = [
        r["features"]["torso_angle_deg"]
        for r in rows_sorted_by_time
        if r["features"].get("torso_angle_deg") is not None
    ]
    hip_drift_px = (max(hips) - min(hips)) if len(hips) >= 3 else None
    angle_drift_deg = (max(angles) - min(angles)) if len(angles) >= 3 else None

    ankle_l_norm = _ankle_motion_norm(rows_sorted_by_time, "l", frame_diag)
    ankle_r_norm = _ankle_motion_norm(rows_sorted_by_time, "r", frame_diag)
    if ankle_l_norm is not None and ankle_r_norm is not None:
        eps = 1e-6
        ankle_asym = abs(ankle_l_norm - ankle_r_norm) / (ankle_l_norm + ankle_r_norm + eps)
    else:
        ankle_asym = None

    # ---- aggregate score (averaged so individual missing signals don't drag) -
    score_parts: list[float] = []
    if knee_asym is not None:
        score_parts.append(_clip01(knee_asym / 60.0))
    if torso_lean_abs is not None:
        score_parts.append(_clip01(max(0.0, torso_lean_abs - 10.0) / 35.0))
    if stance_w is not None:
        score_parts.append(_clip01(max(0.0, stance_w - 1.0) / 1.5))
    if hip_drift_px is not None and frame_h > 0:
        score_parts.append(_clip01(hip_drift_px / (frame_h * 0.10)))
    if angle_drift_deg is not None:
        score_parts.append(_clip01(angle_drift_deg / 40.0))
    if ankle_asym is not None:
        score_parts.append(_clip01(ankle_asym))
    instability_score = (
        sum(score_parts) / len(score_parts) if score_parts else 0.0
    )

    return {
        "knee_asymmetry_deg": knee_asym,
        "torso_lean_abs_deg": torso_lean_abs,
        "stance_width_norm": stance_w,
        "hip_y_drift_px": hip_drift_px,
        "torso_angle_drift_deg": angle_drift_deg,
        "ankle_l_motion_norm": ankle_l_norm,
        "ankle_r_motion_norm": ankle_r_norm,
        "ankle_motion_asymmetry": ankle_asym,
        "gait_instability_score": instability_score,
    }


# =============================================================================
#  hand-near-object lookup against Step 2 evidence
# =============================================================================

def _build_evidence_index(evidence: dict[str, Any] | None) -> dict[int, dict[str, Any]]:
    """Return src_index -> evidence row, for fast lookup per frame."""
    out: dict[int, dict[str, Any]] = {}
    if not evidence:
        return out
    for row in evidence.get("frames") or []:
        try:
            fi = int(row["source_frame_index"])
        except Exception:
            continue
        out[fi] = row
        # WebM time seeking can shift the decoded start by ~1 frame; this
        # fallback enables approximate matching when `fi` doesn't exist.
        try:
            ts_sec = float(row.get("source_ts_sec") or 0.0)
        except Exception:
            ts_sec = 0.0
        if ts_sec > 0.0:
            ts_key = int(round(ts_sec * 1000.0))  # ms rounding
            out[ts_key] = row
    return out


def _hand_near_object(
    kpts: list[dict[str, Any]] | None,
    evidence_row: dict[str, Any] | None,
    *,
    thresh_px: float,
) -> dict[str, Any]:
    """For each wrist keypoint, find the closest held-object center and
    decide if it falls within `thresh_px`."""
    result = {
        "left": None,
        "right": None,
        "any_near": False,
    }
    if not evidence_row:
        return result

    # Gather every object the previous step produced for this frame.
    candidates: list[dict[str, Any]] = []
    for key in (
        "held_objects_full_frame",
        "held_objects_in_frame",  # legacy field name
        "held_objects_from_person_zoom",
        "held_objects_from_hand_zoom",
    ):
        for d in evidence_row.get(key) or []:
            try:
                x1, y1, x2, y2 = (float(v) for v in d["xyxy"])
            except Exception:
                continue
            candidates.append(
                {
                    "label": d.get("label"),
                    "confidence": d.get("confidence"),
                    "xyxy": [x1, y1, x2, y2],
                    "center": ((x1 + x2) / 2.0, (y1 + y2) / 2.0),
                    "source": key,
                }
            )

    for side, kp_name in (("left", "l_wrist"), ("right", "r_wrist")):
        wrist = _kp(kpts, kp_name)
        if wrist is None or not candidates:
            continue
        best = None
        best_d = None
        for c in candidates:
            d = _dist(wrist, c["center"])
            if d is None:
                continue
            if best_d is None or d < best_d:
                best_d = d
                best = c
        if best is None or best_d is None:
            continue
        if best_d <= thresh_px:
            result[side] = {
                "label": best["label"],
                "confidence": best["confidence"],
                "distance_px": round(best_d, 1),
                "source": best["source"],
            }
            result["any_near"] = True
    return result


# =============================================================================
#  drawing
# =============================================================================

def _assemble_feature_vector(
    feat: dict[str, Any],
    gait: dict[str, Any],
    fall_score: float,
    posture_scores: dict[str, float],
    hand_near: dict[str, Any],
    *,
    det_box: tuple[float, float, float, float] | None,
    frame_w: int,
    frame_h: int,
) -> tuple[list[float], list[float]]:
    """Flatten everything we computed into the canonical `FEATURE_NAMES` order.
    Missing values become 0.0 in the vector and 0.0 in the mask; present
    values get 1.0 in the mask. Stack vectors -> tensor (N, F) directly."""
    frame_diag = math.hypot(frame_w, frame_h) or 1.0

    bbox_h_norm: float | None = None
    bbox_w_norm: float | None = None
    if det_box is not None and frame_w > 0 and frame_h > 0:
        x1, y1, x2, y2 = det_box
        bbox_h_norm = max(0.0, (y2 - y1) / float(frame_h))
        bbox_w_norm = max(0.0, (x2 - x1) / float(frame_w))

    def y_norm(v: Any) -> float | None:
        if v is None or frame_h <= 0:
            return None
        return float(v) / float(frame_h)

    def hip_drift_norm() -> float | None:
        v = gait.get("hip_y_drift_px")
        if v is None or frame_h <= 0:
            return None
        return float(v) / float(frame_h)

    def torso_len_norm() -> float | None:
        v = feat.get("torso_len_px")
        if v is None or frame_h <= 0:
            return None
        return float(v) / float(frame_h)

    def head_below_hip_flag() -> float | None:
        v = feat.get("head_below_hip")
        if v is None:
            return None
        return 1.0 if v else 0.0

    def valid_joints_norm() -> float | None:
        v = feat.get("valid_joints")
        if v is None:
            return None
        return float(v) / 17.0

    def wrist_dist_norm(side: str) -> float | None:
        sub = (hand_near or {}).get(side)
        if not sub:
            return None
        d = sub.get("distance_px")
        if d is None:
            return None
        return _clip01(float(d) / frame_diag)

    raw: dict[str, Any] = {
        "torso_angle_deg": feat.get("torso_angle_deg"),
        "torso_len_norm": torso_len_norm(),
        "knee_angle_l_deg": feat.get("knee_angle_l_deg"),
        "knee_angle_r_deg": feat.get("knee_angle_r_deg"),
        "knee_asymmetry_deg": feat.get("knee_asymmetry_deg"),
        "stance_width_norm": feat.get("stance_width_norm"),
        "bbox_aspect_h_over_w": feat.get("bbox_aspect_h_over_w"),
        "bbox_h_norm": bbox_h_norm,
        "bbox_w_norm": bbox_w_norm,
        "head_below_hip_flag": head_below_hip_flag(),
        "valid_joints_norm": valid_joints_norm(),
        "head_y_norm": y_norm(feat.get("head_y")),
        "shoulder_y_norm": y_norm(feat.get("shoulder_y")),
        "hip_y_norm": y_norm(feat.get("hip_y")),
        "knee_y_norm": y_norm(feat.get("knee_y")),
        "ankle_y_norm": y_norm(feat.get("ankle_y")),
        "hip_y_drift_norm": hip_drift_norm(),
        "torso_angle_drift_deg": gait.get("torso_angle_drift_deg"),
        "ankle_l_motion_norm": gait.get("ankle_l_motion_norm"),
        "ankle_r_motion_norm": gait.get("ankle_r_motion_norm"),
        "ankle_motion_asymmetry": gait.get("ankle_motion_asymmetry"),
        "fall_score": fall_score,
        "gait_instability_score": gait.get("gait_instability_score"),
        "posture_standing_score": posture_scores.get("standing", 0.0),
        "posture_sitting_score": posture_scores.get("sitting", 0.0),
        "posture_lying_score": posture_scores.get("lying", 0.0),
        "posture_unknown_score": posture_scores.get("unknown", 1.0),
        "l_wrist_obj_dist_norm": wrist_dist_norm("left"),
        "r_wrist_obj_dist_norm": wrist_dist_norm("right"),
        "min_wrist_obj_dist_norm": (
            min(
                v for v in (wrist_dist_norm("left"), wrist_dist_norm("right"))
                if v is not None
            )
            if any(
                v is not None for v in (wrist_dist_norm("left"), wrist_dist_norm("right"))
            )
            else None
        ),
        "hand_near_any_flag": (1.0 if (hand_near or {}).get("any_near") else 0.0),
    }

    vec: list[float] = []
    mask: list[float] = []
    for name in FEATURE_NAMES:
        v = raw.get(name)
        if v is None:
            vec.append(0.0)
            mask.append(0.0)
        else:
            vec.append(float(v))
            mask.append(1.0)
    return vec, mask


def _color_for_posture(posture: str) -> tuple[int, int, int]:
    return {
        "standing": (60, 220, 60),
        "sitting": (60, 200, 220),
        "lying": (40, 90, 230),
        "unknown": (180, 180, 180),
    }.get(posture, (180, 180, 180))


def _draw_pose(
    img: np.ndarray,
    kpts: list[dict[str, Any]] | None,
    det_box: tuple[float, float, float, float] | None,
    *,
    posture: str,
    posture_scores: dict[str, float],
    bend_angle: float | None,
    fall_score: float,
    gait: dict[str, Any],
    hand_near: dict[str, Any] | None,
):
    color = _color_for_posture(posture)
    if det_box is not None:
        x1, y1, x2, y2 = (int(round(v)) for v in det_box)
        cv2.rectangle(img, (x1, y1), (x2, y2), color, 2)

    if kpts:
        pts = []
        for k in kpts:
            if k["x"] is None or k["y"] is None:
                pts.append(None)
            else:
                pts.append((int(round(k["x"])), int(round(k["y"]))))
        for a, b in _POSE_EDGES:
            if a < len(pts) and b < len(pts) and pts[a] and pts[b]:
                cv2.line(img, pts[a], pts[b], color, 2, cv2.LINE_AA)
        for p in pts:
            if p is not None:
                cv2.circle(img, p, 3, (0, 255, 0), -1)

    top_score = posture_scores.get(posture, 0.0)
    badge_lines: list[str] = [f"posture: {posture} ({top_score:.2f})"]
    if bend_angle is not None:
        badge_lines.append(f"bend: {bend_angle:.1f} deg")
    badge_lines.append(f"fall_score: {fall_score:.2f}")
    instability = gait.get("gait_instability_score")
    if instability is not None:
        badge_lines.append(f"gait_instab: {instability:.2f}")
    asym = gait.get("ankle_motion_asymmetry")
    if asym is not None:
        badge_lines.append(f"ankle_asym: {asym:.2f}")
    if hand_near and hand_near.get("any_near"):
        for side in ("left", "right"):
            sub = hand_near.get(side)
            if sub:
                badge_lines.append(
                    f"{side[0].upper()}.hand <-> {sub['label']} {sub['distance_px']:.0f}px"
                )

    bx0 = 10
    by0 = 50
    pad = 6
    line_h = 22
    panel_w = 380
    panel_h = pad * 2 + line_h * len(badge_lines)
    overlay = img.copy()
    cv2.rectangle(overlay, (bx0 - pad, by0 - line_h), (bx0 + panel_w, by0 + panel_h - line_h), (0, 0, 0), -1)
    cv2.addWeighted(overlay, 0.55, img, 0.45, 0, img)
    for i, line in enumerate(badge_lines):
        cv2.putText(
            img,
            line,
            (bx0, by0 + i * line_h),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.6,
            color if i == 0 else (255, 255, 255),
            2,
            cv2.LINE_AA,
        )


# =============================================================================
#  per-sample analysis
# =============================================================================

def _gather_window_pose(
    cap,
    pose_model,
    anchor_idx: int,
    half_window: int,
    crop_box: tuple[float, float, float, float] | None,
    *,
    person_conf: float,
    kp_conf: float,
):
    """Walk every source frame in [anchor +/- half_window], run pose, return
    candidates sorted by (valid_joints, sharpness)."""
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    lo = max(0, anchor_idx - half_window)
    hi = min(total - 1, anchor_idx + half_window) if total > 0 else anchor_idx + half_window
    rows: list[dict[str, Any]] = []
    cap.set(cv2.CAP_PROP_POS_FRAMES, lo)
    for fi in range(lo, hi + 1):
        ok, frame = cap.read()
        if not ok:
            break
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        sharpness = _laplacian_var(gray)
        kpts, det_box, p_conf = _extract_keypoints(
            pose_model,
            frame,
            crop_box,
            person_conf=person_conf,
            kp_conf=kp_conf,
        )
        feat = _compute_features(
            kpts,
            det_box,
            frame.shape[0],
            frame.shape[1],
        )
        rows.append(
            {
                "fi": fi,
                "sharpness": sharpness,
                "frame": frame,
                "kpts": kpts,
                "det_box": det_box,
                "person_conf": p_conf,
                "features": feat,
            }
        )
    rows.sort(key=lambda r: (r["features"]["valid_joints"], r["sharpness"]), reverse=True)
    return rows


def _gather_window_pose_webm_time_based(
    cap,
    pose_model,
    *,
    anchor_ts_sec: float,
    window_sec: float,
    src_fps_for_fi: float,
    crop_box: tuple[float, float, float, float] | None,
    person_conf: float,
    kp_conf: float,
):
    """WebM-safe candidate gathering for pose.

    We seek by time and assign deterministic `fi` indices based on
    `src_fps_for_fi` so Step-3 evidence lookup keys match Step-2 evidence."""
    start_ts = max(0.0, float(anchor_ts_sec) - float(window_sec))
    end_ts = float(anchor_ts_sec) + float(window_sec)
    start_fi = int(round(start_ts * src_fps_for_fi))
    max_frames = int(max(1, round((window_sec * 2.0) * src_fps_for_fi * 1.2)))

    cap.set(cv2.CAP_PROP_POS_MSEC, start_ts * 1000.0)
    rows: list[dict[str, Any]] = []
    local_i = 0

    while True:
        ok, frame = cap.read()
        if not ok or frame is None:
            break

        fi = start_fi + local_i
        local_i += 1

        pos_msec = float(cap.get(cv2.CAP_PROP_POS_MSEC) or 0.0)
        cur_ts = pos_msec / 1000.0 if pos_msec > 0 else (fi / src_fps_for_fi)
        if cur_ts > end_ts + 0.05:
            break
        if local_i >= max_frames:
            break

        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        sharpness = _laplacian_var(gray)
        kpts, det_box, p_conf = _extract_keypoints(
            pose_model,
            frame,
            crop_box,
            person_conf=person_conf,
            kp_conf=kp_conf,
        )
        feat = _compute_features(
            kpts,
            det_box,
            frame.shape[0],
            frame.shape[1],
        )
        rows.append(
            {
                "fi": fi,
                "sharpness": sharpness,
                "frame": frame,
                "kpts": kpts,
                "det_box": det_box,
                "person_conf": p_conf,
                "features": feat,
            }
        )

    rows.sort(key=lambda r: (r["features"]["valid_joints"], r["sharpness"]), reverse=True)
    return rows


def _gather_window_pose_from_cache(
    frames_by_idx: dict[int, Any],
    pose_model,
    anchor_idx: int,
    half_window: int,
    crop_box: tuple[float, float, float, float] | None,
    *,
    person_conf: float,
    kp_conf: float,
):
    """WebM: gather pose candidates from a pre-decoded frame cache (no seek)."""
    lo = max(0, anchor_idx - half_window)
    hi = anchor_idx + half_window
    rows: list[dict[str, Any]] = []
    for fi in range(lo, hi + 1):
        frame = frames_by_idx.get(fi)
        if frame is None:
            continue
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        sharpness = _laplacian_var(gray)
        kpts, det_box, p_conf = _extract_keypoints(
            pose_model,
            frame,
            crop_box,
            person_conf=person_conf,
            kp_conf=kp_conf,
        )
        feat = _compute_features(
            kpts,
            det_box,
            frame.shape[0],
            frame.shape[1],
        )
        rows.append(
            {
                "fi": fi,
                "sharpness": sharpness,
                "frame": frame,
                "kpts": kpts,
                "det_box": det_box,
                "person_conf": p_conf,
                "features": feat,
            }
        )
    rows.sort(key=lambda r: (r["features"]["valid_joints"], r["sharpness"]), reverse=True)
    return rows


def _infer_src_fps_for_fi_from_step1(step1: dict[str, Any] | None) -> float:
    if not step1:
        return 30.0
    src_fps_candidates: list[float] = []
    for f in step1.get("frames") or []:
        try:
            fi = int(f.get("src_index"))
            ts = float(f.get("ts_sec") or 0.0)
        except Exception:
            continue
        if fi > 0 and ts > 0.0:
            src_fps_candidates.append(fi / ts)
    if not src_fps_candidates:
        return 30.0
    src_fps_candidates.sort()
    return float(src_fps_candidates[len(src_fps_candidates) // 2])


# =============================================================================
#  main
# =============================================================================

def analyze(
    run_dir: Path,
    *,
    video_path: Path,
    pose_weights: Path | None,
    window_sec: float,
    picks: int,
    person_conf: float,
    kp_conf: float,
    person_pad: float,
    hand_near_thresh_px: float | None,
    hand_near_diag_frac: float,
    fall_threshold: float,
    gait_threshold: float,
    use_step2: bool,
    show: bool,
    delay_ms: int,
    use_reducer: bool = True,
) -> int:
    if not video_path.is_file():
        print(f"[ERROR] source video not found: {video_path}")
        return 1

    step1 = _load_step1_detections(run_dir)
    if not step1 or not step1.get("frames"):
        print(f"[ERROR] Step 1 detections.json not found in {run_dir / 'detections'}.")
        print("Run first: python ai/models/SCVAM2.1/dectator.py")
        return 1

    person_frames = [f for f in step1["frames"] if "person" in (f.get("labels") or [])]
    if not person_frames:
        print("[INFO] No 'person' frames in Step 1 - nothing to analyze.")
        return 0

    if use_reducer:
        active = _load_active_frames(run_dir)
        if active is not None:
            before = len(person_frames)
            person_frames = [
                f for f in person_frames if str(f.get("frame", "")) in active
            ]
            after = len(person_frames)
            print(
                f"[REDUCER] active_frames.json found: {before} -> {after} "
                f"person samples after reducer filter."
            )
            if not person_frames:
                print(
                    "[REDUCER] All person samples were dropped by the reducer; "
                    "rerun with --no-reducer if you want to process them anyway."
                )
                return 0
        else:
            print(
                "[REDUCER] No reduced/active_frames.json in run dir - "
                "processing all person samples (run reducer.py to enable filtering)."
            )

    pose_model = _load_pose_model(pose_weights)
    if pose_model is None:
        return 1

    evidence = _load_step2_evidence(run_dir) if use_step2 else None
    evidence_index = _build_evidence_index(evidence)
    if use_step2 and not evidence_index:
        print(
            "[INFO] zoom_evidence/evidence.json not found; "
            "hand_near_object will always be empty."
        )

    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        print(f"[ERROR] could not open video: {video_path}")
        return 1

    video_is_webm = video_path.suffix.lower() == ".webm"
    # For WebM, use the same src_fps mapping as Step 2 so `source_frame_index`
    # keys match for hand-near lookup (OpenCV CAP_PROP_FPS is often bogus).
    if video_is_webm:
        ev_src_fps = 0.0
        if isinstance(evidence, dict):
            try:
                ev_src_fps = float(evidence.get("src_fps") or 0.0)
            except Exception:
                ev_src_fps = 0.0
        src_fps = (
            ev_src_fps
            if ev_src_fps > 0.0
            else _infer_src_fps_for_fi_from_step1(step1)
        )
    else:
        src_fps = float(cap.get(cv2.CAP_PROP_FPS) or 0.0) or 30.0
    half_window = max(1, int(round(window_sec * src_fps)))

    out_dir = run_dir / "pose_analysis"
    out_dir.mkdir(parents=True, exist_ok=True)
    win_name = "SCVAM2.1 Step 3 Pose"
    if show:
        cv2.namedWindow(win_name, cv2.WINDOW_NORMAL)
        cv2.resizeWindow(win_name, 960, 540)

    print(
        f"Step 3 pose on {len(person_frames)} person samples\n"
        f"  video:           {video_path}\n"
        f"  src_fps:         {src_fps:.3f}\n"
        f"  window:          +/-{half_window} src frames (~{window_sec:.2f}s)\n"
        f"  picks/sample:    {picks}\n"
        f"  person_pad:      {person_pad}\n"
        f"  pose_conf:       person={person_conf} kp={kp_conf}\n"
        f"  fall_threshold:  {fall_threshold}  (>=  -> fall_like=True)\n"
        f"  gait_threshold:  {gait_threshold}  (>=  -> unstable_gait=True)\n"
        f"  hand_near_obj:   "
        f"{'fixed_px=' + str(hand_near_thresh_px) if hand_near_thresh_px is not None else 'diag_frac=' + str(hand_near_diag_frac)}  "
        f"step2={'on' if evidence_index else 'off'}\n"
        f"  feature_vector:  {len(FEATURE_NAMES)} columns -> tensor (N, F) ready\n"
        f"  out_dir:         {out_dir}"
    )

    frames_by_idx: dict[int, Any] | None = None
    frame_w: int | None = None
    frame_h: int | None = None

    if video_is_webm:
        half_window_frames = int(half_window)
        needed: set[int] = set()
        for fmeta in person_frames:
            sample_ts = float(fmeta.get("ts_sec", 0.0))
            aidx = int(fmeta.get("src_index") or int(round(sample_ts * src_fps)))
            lo = max(0, aidx - half_window_frames)
            hi = aidx + half_window_frames
            for fi in range(lo, hi + 1):
                needed.add(fi)

        max_needed = max(needed) if needed else 0
        frames_by_idx = {}
        src_idx = 0
        while src_idx <= max_needed:
            ok, frame = cap.read()
            if not ok or frame is None:
                break
            if src_idx in needed:
                frames_by_idx[src_idx] = frame
                if frame_w is None or frame_h is None:
                    frame_h, frame_w = frame.shape[:2]
                if len(frames_by_idx) >= len(needed):
                    break
            src_idx += 1
        cap.release()
        if frame_w is None or frame_h is None:
            print("[INFO] WebM pre-decode failed; no pose samples emitted.")
            return 0
        print(
            f"[WEBM] Pre-decoded {len(frames_by_idx)}/{len(needed)} frames "
            f"for pose windows (no seek)."
        )

    summary: list[dict[str, Any]] = []
    posture_counts: dict[str, int] = {}
    fall_count = 0
    unstable_count = 0
    hand_near_count = 0
    quit_early = False
    log_every = max(1, len(person_frames) // 20)
    emitted_src: set[int] = set()

    for i, fmeta in enumerate(person_frames, start=1):
        sample_name = str(fmeta.get("frame", ""))
        sample_ts = float(fmeta.get("ts_sec", 0.0))
        anchor_idx = int(fmeta.get("src_index", int(round(sample_ts * src_fps))))

        person_box_raw = _person_bbox_from_dets(fmeta.get("detections") or [])
        crop_box: tuple[float, float, float, float] | None = None
        if person_box_raw is not None:
            if video_is_webm:
                assert frame_w is not None and frame_h is not None
                crop_box = _expand_bbox(person_box_raw, frame_w, frame_h, pad=person_pad)
            else:
                cap.set(cv2.CAP_PROP_POS_FRAMES, anchor_idx)
                ok, probe = cap.read()
                if ok and probe is not None:
                    ph, pw = probe.shape[:2]
                    crop_box = _expand_bbox(person_box_raw, pw, ph, pad=person_pad)

        if video_is_webm:
            assert frames_by_idx is not None
            candidates = _gather_window_pose_from_cache(
                frames_by_idx,
                pose_model,
                anchor_idx,
                int(half_window),
                crop_box,
                person_conf=person_conf,
                kp_conf=kp_conf,
            )
        else:
            candidates = _gather_window_pose(
                cap,
                pose_model,
                anchor_idx,
                half_window,
                crop_box,
                person_conf=person_conf,
                kp_conf=kp_conf,
            )
        if not candidates:
            continue

        chosen = []
        for c in candidates:
            if c["fi"] in emitted_src:
                continue
            chosen.append(c)
            if len(chosen) >= picks:
                break
        if not chosen:
            continue

        rows_sorted_by_time = sorted(candidates, key=lambda r: r["fi"])

        for rank, c in enumerate(chosen, start=1):
            fi = c["fi"]
            frame = c["frame"]
            kpts = c["kpts"]
            det_box = c["det_box"]
            feat = c["features"]
            sharpness = c["sharpness"]
            h, w = frame.shape[:2]
            emitted_src.add(fi)

            near_thresh = (
                float(hand_near_thresh_px)
                if hand_near_thresh_px is not None
                else float(hand_near_diag_frac) * max(1.0, math.hypot(float(w), float(h)))
            )

            posture_scores = _compute_posture_scores(feat) if kpts else {
                "standing": 0.0, "sitting": 0.0, "lying": 0.0, "unknown": 1.0,
            }
            posture = max(posture_scores, key=posture_scores.get)
            bend_angle = feat.get("torso_angle_deg")
            fall_score = _compute_fall_score(feat, h) if kpts else 0.0
            if feat.get("partial_visibility"):
                # Cropped / entering / leaving figures yield a spurious
                # fall_score because the bbox is short and its bottom edge
                # often touches the frame boundary. Zero it out so the
                # downstream "fall evidence" timestamps stay clean.
                fall_score = 0.0
            gait = (
                _compute_gait_features(feat, rows_sorted_by_time, w, h)
                if kpts
                else {
                    "knee_asymmetry_deg": None,
                    "torso_lean_abs_deg": None,
                    "stance_width_norm": None,
                    "hip_y_drift_px": None,
                    "torso_angle_drift_deg": None,
                    "ankle_l_motion_norm": None,
                    "ankle_r_motion_norm": None,
                    "ankle_motion_asymmetry": None,
                    "gait_instability_score": 0.0,
                }
            )

            fall_like = _should_flag_fall_like(
                fall_score,
                fall_threshold,
                posture,
                posture_scores,
                bend_angle,
                partial_visibility=bool(feat.get("partial_visibility")),
            )
            if feat.get("partial_visibility"):
                # Gait dynamics need a stable, fully-visible figure across
                # the window. Partial visibility produces wild drift values
                # (the bbox itself flips between cropped and uncropped),
                # so we suppress the instability score for those frames.
                gait["gait_instability_score"] = 0.0
            unstable_gait = (gait.get("gait_instability_score") or 0.0) >= gait_threshold

            hand_near = _hand_near_object(
                kpts,
                evidence_index.get(fi)
                or evidence_index.get(int(round((float(fi) / float(src_fps)) * 1000.0))),
                thresh_px=near_thresh,
            )

            feature_vec, feature_mask = _assemble_feature_vector(
                feat,
                gait,
                fall_score,
                posture_scores,
                hand_near,
                det_box=det_box,
                frame_w=w,
                frame_h=h,
            )

            _draw_pose(
                frame,
                kpts,
                det_box,
                posture=posture,
                posture_scores=posture_scores,
                bend_angle=bend_angle,
                fall_score=fall_score,
                gait=gait,
                hand_near=hand_near,
            )

            cv2.putText(
                frame,
                f"src#{fi}  t={fi / src_fps:.2f}s  sharp={sharpness:.0f}  "
                f"valid_joints={feat['valid_joints']}",
                (10, 24),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.6,
                (255, 255, 255),
                2,
                cv2.LINE_AA,
            )

            stem_name = Path(sample_name).stem if sample_name else f"s{i:06d}"
            out_name = f"{stem_name}_pick{rank}_src{fi:06d}.png"
            cv2.imwrite(str(out_dir / out_name), frame)

            def _round(v: Any, n: int = 3) -> Any:
                if isinstance(v, float):
                    return round(v, n)
                return v

            row = {
                "sample_frame": sample_name,
                "sample_ts_sec": sample_ts,
                "source_frame_index": fi,
                "source_ts_sec": round(fi / src_fps, 3),
                "sharpness": round(sharpness, 1),
                "person_bbox": list(person_box_raw) if person_box_raw is not None else None,
                "crop_bbox": list(crop_box) if crop_box is not None else None,
                "pose_det_bbox": list(det_box) if det_box is not None else None,
                "pose_det_conf": round(c.get("person_conf") or 0.0, 3),
                "keypoints": [
                    {
                        "name": k["name"],
                        "x": (round(k["x"], 1) if k["x"] is not None else None),
                        "y": (round(k["y"], 1) if k["y"] is not None else None),
                        "conf": round(float(k["conf"]), 3),
                    }
                    for k in (kpts or [])
                ],
                "features": {key: _round(val) for key, val in feat.items()},
                "gait_features": {key: _round(val) for key, val in gait.items()},
                "posture": posture,
                "posture_scores": {k: round(v, 3) for k, v in posture_scores.items()},
                "bend_angle_deg": (round(bend_angle, 2) if bend_angle is not None else None),
                "fall_score": round(fall_score, 3),
                "fall_like": bool(fall_like),
                "gait_instability_score": round(gait.get("gait_instability_score") or 0.0, 3),
                "unstable_gait": bool(unstable_gait),
                "hand_near_object": hand_near,
                "feature_vector": [round(v, 4) for v in feature_vec],
                "feature_mask": feature_mask,
                "output": out_name,
            }
            summary.append(row)

            posture_counts[posture] = posture_counts.get(posture, 0) + 1
            if fall_like:
                fall_count += 1
            if unstable_gait:
                unstable_count += 1
            if hand_near.get("any_near"):
                hand_near_count += 1

            if i == 1 or i == len(person_frames) or i % log_every == 0 or fall_like or unstable_gait:
                tags: list[str] = [
                    f"{posture}({posture_scores[posture]:.2f})",
                ]
                if bend_angle is not None:
                    tags.append(f"bend={bend_angle:.0f}")
                tags.append(f"fall={fall_score:.2f}")
                tags.append(f"gait={gait.get('gait_instability_score') or 0.0:.2f}")
                if fall_like:
                    tags.append("FALL-LIKE")
                if unstable_gait:
                    tags.append("UNSTABLE")
                if hand_near.get("any_near"):
                    sides = [s for s in ("left", "right") if hand_near.get(s)]
                    tags.append(f"hand-near[{','.join(sides)}]")
                print(
                    f"  [{i}/{len(person_frames)}] {sample_name} pick{rank} "
                    f"src#{fi} t={fi / src_fps:.2f}s sharp={sharpness:.0f} "
                    f"joints={feat['valid_joints']}: {', '.join(tags)}"
                )

            if show:
                cv2.imshow(win_name, frame)
                key = cv2.waitKey(delay_ms) & 0xFF
                if key in (ord("q"), ord("Q"), 27):
                    quit_early = True
                    break

        if quit_early:
            break

    if show:
        cv2.destroyAllWindows()
    if not video_is_webm:
        cap.release()

    out_json = out_dir / "pose_analysis.json"
    out_json.write_text(
        json.dumps(
            {
                "run_dir": run_dir.as_posix(),
                "video": video_path.as_posix(),
                "src_fps": src_fps,
                "window_sec": window_sec,
                "picks_per_sample": picks,
                "person_conf": person_conf,
                "kp_conf": kp_conf,
                "person_pad": person_pad,
                "hand_near_thresh_px": hand_near_thresh_px,
                "hand_near_diag_frac": hand_near_diag_frac,
                "fall_threshold": fall_threshold,
                "gait_threshold": gait_threshold,
                "step2_evidence_used": bool(evidence_index),
                "feature_vector_names": FEATURE_NAMES,
                "feature_vector_dim": len(FEATURE_NAMES),
                "person_samples": len(person_frames),
                "frames_emitted": len(summary),
                "posture_counts": posture_counts,
                "fall_like_frames": fall_count,
                "unstable_gait_frames": unstable_count,
                "hand_near_object_frames": hand_near_count,
                "frames": summary,
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    print(
        f"\nDone{' (stopped early)' if quit_early else ''}. "
        f"emitted={len(summary)}\n"
        f"  postures: {posture_counts}\n"
        f"  fall_like={fall_count}  unstable_gait={unstable_count}  "
        f"hand_near_object={hand_near_count}"
    )
    print(f"Annotated frames: {out_dir}")
    print(f"Pose JSON:        {out_json}")
    return 0


# =============================================================================
#  CLI
# =============================================================================

def main() -> int:
    parser = argparse.ArgumentParser(description="Step 3: pose / posture analysis.")
    parser.add_argument(
        "--run",
        default="",
        help="Step 1 run dir (default: newest under ai/models/SCVAM2.1/output).",
    )
    parser.add_argument(
        "--video",
        default="",
        help="Source video path (default: SELECTED_VIDEO.txt from test.py).",
    )
    parser.add_argument(
        "--weights",
        default="",
        help="YOLO pose weights (.pt). If empty, ultralytics auto-downloads "
        "yolov8n-pose.pt.",
    )
    parser.add_argument(
        "--window-sec",
        type=float,
        default=0.4,
        help="Half-window of source frames around each person sample (default 0.4s).",
    )
    parser.add_argument(
        "--picks",
        type=int,
        default=1,
        help="How many frames to emit per person sample (default 1).",
    )
    parser.add_argument(
        "--person-conf",
        type=float,
        default=0.20,
        help="YOLO pose person-detection confidence (default 0.20).",
    )
    parser.add_argument(
        "--kp-conf",
        type=float,
        default=0.20,
        help="Min confidence to accept an individual keypoint (default 0.20).",
    )
    parser.add_argument(
        "--person-pad",
        type=float,
        default=0.25,
        help="Padding fraction added to YOLO person bbox before cropping (default 0.25).",
    )
    parser.add_argument(
        "--hand-near-thresh-px",
        type=float,
        default=-1.0,
        help="Fixed wrist-to-object distance threshold in pixels. "
        "Use -1 or omit behavior: use --hand-near-diag-frac instead (default).",
    )
    parser.add_argument(
        "--hand-near-diag-frac",
        type=float,
        default=0.055,
        help="When --hand-near-thresh-px is negative: threshold = this fraction "
        "times the image diagonal (~80 px at 1280x720 when 0.055).",
    )
    parser.add_argument(
        "--fall-threshold",
        type=float,
        default=0.42,
        help="Score >= this -> fall_like=True. Lying posture + high torso bend "
        "can also set fall_like even slightly below this. fall_score in JSON "
        "is unchanged (default 0.42; was 0.55).",
    )
    parser.add_argument(
        "--gait-threshold",
        type=float,
        default=0.45,
        help="Score >= this -> unstable_gait=True. Score itself stays in "
        "gait_features.gait_instability_score (default 0.45).",
    )
    parser.add_argument(
        "--no-step2",
        action="store_true",
        help="Don't read zoom_evidence/evidence.json for held objects "
        "(hand_near_object will be empty).",
    )
    parser.add_argument(
        "--no-reducer",
        action="store_true",
        help="Ignore reduced/active_frames.json even if reducer.py was run "
        "(default: filter person samples by the reducer's active set when present).",
    )
    parser.add_argument("--no-show", action="store_true", help="Skip preview window.")
    parser.add_argument(
        "--delay-ms",
        type=int,
        default=200,
        help="Per-frame display delay when previewing (default 200).",
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

    if args.video:
        video_path = Path(args.video).expanduser().resolve()
    else:
        sel = _read_selected_video()
        if sel is None:
            print(
                "No --video and no SELECTED_VIDEO.txt.\n"
                "Run first: python ai/models/SCVAM2.1/test.py"
            )
            return 1
        video_path = sel

    weights = (
        Path(args.weights).expanduser().resolve() if args.weights else None
    )

    hn_px = args.hand_near_thresh_px
    hand_near_fixed: float | None = None
    if hn_px is not None and hn_px > 0:
        hand_near_fixed = hn_px

    return analyze(
        run_dir,
        video_path=video_path,
        pose_weights=weights,
        window_sec=max(0.05, args.window_sec),
        picks=max(1, args.picks),
        person_conf=max(0.01, args.person_conf),
        kp_conf=max(0.01, args.kp_conf),
        person_pad=max(0.0, args.person_pad),
        hand_near_thresh_px=hand_near_fixed,
        hand_near_diag_frac=max(1e-4, min(0.5, args.hand_near_diag_frac)),
        fall_threshold=max(0.0, min(1.0, args.fall_threshold)),
        gait_threshold=max(0.0, min(1.0, args.gait_threshold)),
        use_step2=not args.no_step2,
        show=not args.no_show,
        delay_ms=max(1, args.delay_ms),
        use_reducer=not args.no_reducer,
    )


if __name__ == "__main__":
    sys.exit(main())
