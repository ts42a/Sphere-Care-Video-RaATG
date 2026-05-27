"""
Step 2: pose-driven Left/Right hand crops on each Step-1 person sample.

Per person sample (a 2-fps anchor with a YOLO 'person' detection):

  1. Reopen the ORIGINAL source video and read +/- window-sec input frames
     around the sample timestamp at full source FPS / resolution.
  2. Score each input frame by Laplacian sharpness; keep the top --picks.
  3. For each pick, run YOLOv8-pose on the (padded) person crop and extract
     wrist + elbow keypoints for Left and Right.
  4. Build a forearm-aware bounding box around each detected wrist
     (anchor pushed beyond the wrist along elbow->wrist; side scales with
     forearm length).  This is the "Left" / "Right" crop.
  5. Save the annotated frame and write evidence.json.

NO held-object detection runs here.  NO MediaPipe Hands.  NO finger
landmark drawing.  Object detection is done by zoom_evidence_dectator.py,
which reads evidence.json and runs YOLO on each Left/Right crop.

Inputs (auto):
  ai/models/SCVAM2.1/output/<stem>_<fps>fps/detections/detections.json
  ai/models/SCVAM2.1/output/<stem>_<fps>fps/reduced/active_frames.json (optional)
  ai/models/SCVAM2.1/SELECTED_VIDEO.txt

Outputs (under <run_dir>/zoom_evidence/):
  frame_NNNNNN_pickK_srcSSSSSS.png    annotated source frame
  evidence.json                        per emitted frame:
    {sample_frame, source_frame_index, person_bbox, crop_bbox,
     hands: [{side, bbox, wrist, elbow, anchor, kp_conf, ...}]}
    plus empty held_objects_* placeholders that
    zoom_evidence_dectator.py later fills in.

Run:
  python ai/models/SCVAM2.1/zoom_evidence.py
  python ai/models/SCVAM2.1/zoom_evidence.py --window-sec 0.5 --picks 4
  python ai/models/SCVAM2.1/zoom_evidence.py --forearm-crop-ratio 1.6
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

REPO_ROOT = Path(__file__).resolve().parents[3]
SELECTED_NAME = "SELECTED_VIDEO.txt"


# =============================================================================
#  filesystem / loading
# =============================================================================

def _package_dir() -> Path:
    return Path(__file__).resolve().parent


def _newest_run_dir() -> Path | None:
    out_root = _package_dir() / "output"
    if not out_root.is_dir():
        return None
    candidates = [d for d in out_root.iterdir() if d.is_dir() and (d / "frames").is_dir()]
    if not candidates:
        return None
    candidates.sort(key=lambda d: d.stat().st_mtime, reverse=True)
    return candidates[0]


def _read_selected_video() -> Path | None:
    p = _package_dir() / SELECTED_NAME
    if not p.is_file():
        return None
    text = p.read_text(encoding="utf-8").strip()
    return Path(text) if text else None


def _load_step1_detections(run_dir: Path) -> dict[str, Any] | None:
    p = run_dir / "detections" / "detections.json"
    if not p.is_file():
        return None
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return None


def _load_active_frames(run_dir: Path) -> set[str] | None:
    """Return the reducer's active sample-frame set, or None if not run."""
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


# =============================================================================
#  enhancement (backlight / silhouette rescue)
# =============================================================================

def _laplacian_var(gray: np.ndarray) -> float:
    return float(cv2.Laplacian(gray, cv2.CV_64F).var())


def _decide_enhance(view: np.ndarray, mode: str, dark_threshold: float) -> bool:
    if mode == "off":
        return False
    if mode == "on":
        return True
    if view is None or view.size == 0:
        return False
    gray = cv2.cvtColor(view, cv2.COLOR_BGR2GRAY) if view.ndim == 3 else view
    return float(gray.mean()) < dark_threshold


def _enhance_for_inference(bgr: np.ndarray, *, gamma: float = 0.6) -> np.ndarray:
    """Gamma-brighten + CLAHE on L channel.  Used only when the crop is dark
    (auto), so we don't degrade well-lit scenes."""
    if bgr is None or bgr.size == 0:
        return bgr
    inv = max(1e-3, 1.0 / max(gamma, 1e-3))
    table = np.array([((i / 255.0) ** inv) * 255 for i in range(256)]).astype(np.uint8)
    bright = cv2.LUT(bgr, table)
    lab = cv2.cvtColor(bright, cv2.COLOR_BGR2LAB)
    l_chan, a_chan, b_chan = cv2.split(lab)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    l_chan = clahe.apply(l_chan)
    return cv2.cvtColor(cv2.merge((l_chan, a_chan, b_chan)), cv2.COLOR_LAB2BGR)


# =============================================================================
#  person bbox from Step 1
# =============================================================================

def _person_bbox_from_dets(
    dets: list[dict[str, Any]],
    *,
    static_clusters: list[tuple[float, float]] | None = None,
    static_radius: float = 30.0,
) -> tuple[float, float, float, float] | None:
    """Pick the largest-area non-static 'person' bbox from Step 1 (matches
    pose_detection.py so Step 2 and Step 3 track the same subject in
    multi-person shots).

    static_clusters: list of (cx, cy) centroids of stationary 'person'
    detections (typically wall art / printed photos) - any detection whose
    center falls within static_radius of one of these is ignored.
    """
    best: tuple[float, float, float, float] | None = None
    best_area = 0.0
    for d in dets:
        if str(d.get("label", "")).lower() != "person":
            continue
        x1, y1, x2, y2 = d.get("xyxy") or [None, None, None, None]
        if None in (x1, y1, x2, y2):
            continue
        if static_clusters:
            cx = 0.5 * (float(x1) + float(x2))
            cy = 0.5 * (float(y1) + float(y2))
            if any(
                math.hypot(cx - sx, cy - sy) <= static_radius
                for sx, sy in static_clusters
            ):
                continue
        area = max(0.0, float(x2) - float(x1)) * max(0.0, float(y2) - float(y1))
        if area > best_area:
            best_area = area
            best = (float(x1), float(y1), float(x2), float(y2))
    return best


def _expand_bbox(
    bbox: tuple[float, float, float, float],
    frame_w: int,
    frame_h: int,
    *,
    pad: float = 0.25,
) -> tuple[float, float, float, float]:
    x1, y1, x2, y2 = bbox
    bw = max(1.0, x2 - x1)
    bh = max(1.0, y2 - y1)
    px = bw * pad
    py = bh * pad
    return (
        max(0.0, x1 - px),
        max(0.0, y1 - py),
        min(float(frame_w - 1), x2 + px),
        min(float(frame_h - 1), y2 + py),
    )


def _detect_static_person_clusters(
    person_frames: list[dict[str, Any]],
    *,
    min_share: float = 0.85,
    cluster_radius: float = 25.0,
    min_frames: int = 4,
) -> list[tuple[float, float]]:
    """Find centroids of 'person' detections that appear in nearly every frame
    at the same location - those are wall-art / printed photos, not real
    people, and we filter them out before zooming."""
    if len(person_frames) < min_frames:
        return []
    centroids: list[tuple[float, float]] = []
    for fmeta in person_frames:
        for d in fmeta.get("detections") or []:
            if str(d.get("label", "")).lower() != "person":
                continue
            x1, y1, x2, y2 = d.get("xyxy") or [None, None, None, None]
            if None in (x1, y1, x2, y2):
                continue
            centroids.append(
                (
                    0.5 * (float(x1) + float(x2)),
                    0.5 * (float(y1) + float(y2)),
                )
            )
    if not centroids:
        return []
    clusters: list[list[tuple[float, float]]] = []
    for cx, cy in centroids:
        placed = False
        for cluster in clusters:
            mx = sum(p[0] for p in cluster) / len(cluster)
            my = sum(p[1] for p in cluster) / len(cluster)
            if math.hypot(cx - mx, cy - my) <= cluster_radius:
                cluster.append((cx, cy))
                placed = True
                break
        if not placed:
            clusters.append([(cx, cy)])
    threshold = max(min_frames, int(round(min_share * len(person_frames))))
    static: list[tuple[float, float]] = []
    for cluster in clusters:
        if len(cluster) >= threshold:
            mx = sum(p[0] for p in cluster) / len(cluster)
            my = sum(p[1] for p in cluster) / len(cluster)
            static.append((mx, my))
    return static


# =============================================================================
#  YOLO pose
# =============================================================================

# COCO pose keypoint indices used by YOLOv8-pose
_KP_LEFT_SHOULDER = 5
_KP_RIGHT_SHOULDER = 6
_KP_LEFT_ELBOW = 7
_KP_RIGHT_ELBOW = 8
_KP_LEFT_WRIST = 9
_KP_RIGHT_WRIST = 10
_KP_LEFT_HIP = 11
_KP_RIGHT_HIP = 12
_KP_LEFT_ANKLE = 15
_KP_RIGHT_ANKLE = 16


def _load_yolo_pose(weights: Path | None):
    """Load a YOLOv8-pose model.  Pass weights=None to let ultralytics
    auto-download yolov8n-pose.pt."""
    try:
        from ultralytics import YOLO
    except Exception as exc:
        print(f"[ERROR] ultralytics not installed: {exc}")
        return None
    try:
        if weights is not None:
            return YOLO(str(weights))
        return YOLO("yolov8n-pose.pt")
    except Exception as exc:
        print(f"[ERROR] could not load pose model: {exc}")
        return None


def _pose_wrists(
    model,
    frame_bgr: np.ndarray,
    crop_box: tuple[float, float, float, float] | None,
    *,
    person_conf: float = 0.20,
    kp_conf: float = 0.20,
) -> list[dict[str, Any]]:
    """Run YOLO-pose on the (cropped) person region and return wrist + elbow
    keypoints in full-frame coordinates: list of
    {'side', 'wrist': (x, y), 'elbow': (x,y) or None, 'kp_conf': float}."""
    if model is None:
        return []
    h, w = frame_bgr.shape[:2]
    if crop_box is None:
        view = frame_bgr
        x_off, y_off = 0, 0
    else:
        cx1, cy1, cx2, cy2 = (int(round(v)) for v in crop_box)
        cx2 = max(cx2, cx1 + 1)
        cy2 = max(cy2, cy1 + 1)
        view = frame_bgr[cy1:cy2, cx1:cx2]
        if view.size == 0:
            return []
        x_off, y_off = cx1, cy1
    try:
        res = model(view, verbose=False, conf=person_conf)[0]
    except Exception:
        return []
    if res.keypoints is None or len(res.keypoints) == 0:
        return []
    # Pick the largest detected person box inside the crop view.
    best_idx = 0
    if res.boxes is not None and len(res.boxes) > 1:
        best_area = 0.0
        for i in range(len(res.boxes)):
            x1, y1, x2, y2 = res.boxes.xyxy[i].tolist()
            area = max(0.0, x2 - x1) * max(0.0, y2 - y1)
            if area > best_area:
                best_area = area
                best_idx = i
    try:
        kpts_xy = res.keypoints.xy[best_idx].tolist()
    except Exception:
        return []
    if hasattr(res.keypoints, "conf") and res.keypoints.conf is not None:
        try:
            kp_confs = res.keypoints.conf[best_idx].tolist()
        except Exception:
            kp_confs = [1.0] * len(kpts_xy)
    else:
        kp_confs = [1.0] * len(kpts_xy)

    def _kp(idx: int, *, conf_floor: float = kp_conf) -> tuple[tuple[float, float], float] | None:
        if idx >= len(kpts_xy):
            return None
        x, y = kpts_xy[idx]
        if x <= 0.0 and y <= 0.0:
            return None
        c = float(kp_confs[idx]) if idx < len(kp_confs) else 1.0
        if c < conf_floor:
            return None
        return ((x_off + float(x), y_off + float(y)), c)

    # Reference torso scale = max(shoulder->hip) using confident torso joints
    # only (conf_floor=kp_conf). Low-confidence shoulder/hip hallucinations
    # must not shrink torso_scale and disable reach checks.
    l_shoulder = _kp(_KP_LEFT_SHOULDER, conf_floor=kp_conf)
    r_shoulder = _kp(_KP_RIGHT_SHOULDER, conf_floor=kp_conf)
    l_hip = _kp(_KP_LEFT_HIP, conf_floor=kp_conf)
    r_hip = _kp(_KP_RIGHT_HIP, conf_floor=kp_conf)
    torso_scale = 0.0
    if l_shoulder is not None and l_hip is not None:
        torso_scale = max(
            torso_scale, math.hypot(l_shoulder[0][0] - l_hip[0][0], l_shoulder[0][1] - l_hip[0][1])
        )
    if r_shoulder is not None and r_hip is not None:
        torso_scale = max(
            torso_scale, math.hypot(r_shoulder[0][0] - r_hip[0][0], r_shoulder[0][1] - r_hip[0][1])
        )

    # Hint of "where the floor is" so we can drop wrists that are below the
    # ankles (common YOLOv8n-pose failure: 'right wrist' lands on the foot).
    l_ankle = _kp(_KP_LEFT_ANKLE, conf_floor=kp_conf)
    r_ankle = _kp(_KP_RIGHT_ANKLE, conf_floor=kp_conf)
    ankle_y_floor: float | None = None
    if l_ankle is not None and r_ankle is not None:
        ankle_y_floor = max(l_ankle[0][1], r_ankle[0][1])
    elif l_ankle is not None:
        ankle_y_floor = l_ankle[0][1]
    elif r_ankle is not None:
        ankle_y_floor = r_ankle[0][1]

    rejected: list[str] = []
    out: list[dict[str, Any]] = []
    for side, w_idx, e_idx, s_idx in (
        ("Left", _KP_LEFT_WRIST, _KP_LEFT_ELBOW, _KP_LEFT_SHOULDER),
        ("Right", _KP_RIGHT_WRIST, _KP_RIGHT_ELBOW, _KP_RIGHT_SHOULDER),
    ):
        wrist = _kp(w_idx)
        if wrist is None:
            continue
        elbow = _kp(e_idx)
        shoulder = _kp(s_idx, conf_floor=kp_conf)

        # Anatomical sanity: drop wrist if it sits clearly below the ankles
        # (== on the foot/floor). Tolerance proportional to torso scale.
        if ankle_y_floor is not None:
            slack = max(15.0, 0.10 * (torso_scale or 100.0))
            if wrist[0][1] > ankle_y_floor + slack:
                rejected.append(f"{side}_below_ankles")
                continue

        # Anatomical sanity: drop wrist if its distance from the shoulder is
        # absurd (> 2.5 x upper-arm reach == ~1.4 x torso). Catches the case
        # where pose flips a wrist onto a chair leg or the doorframe.
        if shoulder is not None and torso_scale > 1.0:
            reach = math.hypot(
                wrist[0][0] - shoulder[0][0], wrist[0][1] - shoulder[0][1]
            )
            if reach > 1.6 * torso_scale:
                rejected.append(f"{side}_reach={reach / torso_scale:.2f}xtorso")
                continue

        # Anatomical sanity: if elbow is present, its distance to the wrist
        # (== forearm length) shouldn't exceed ~80% of torso. A "forearm"
        # stretching across the whole body is almost always a wrist that
        # snapped to a different limb.
        if elbow is not None and torso_scale > 1.0:
            forearm = math.hypot(
                wrist[0][0] - elbow[0][0], wrist[0][1] - elbow[0][1]
            )
            if forearm > 0.95 * torso_scale:
                rejected.append(f"{side}_forearm={forearm / torso_scale:.2f}xtorso")
                continue

        out.append(
            {
                "side": side,
                "wrist": wrist[0],
                "elbow": elbow[0] if elbow is not None else None,
                "kp_conf": wrist[1],
                "elbow_conf": elbow[1] if elbow is not None else 0.0,
            }
        )
    return out


# =============================================================================
#  forearm-aware hand bbox
# =============================================================================

def _hand_box_from_arm(
    wrist_xy: tuple[float, float],
    elbow_xy: tuple[float, float] | None,
    *,
    frame_w: int,
    frame_h: int,
    forward_ratio: float = 0.35,
    crop_ratio: float = 1.2,
    min_side_px: int = 80,
    fallback_half_size: int = 70,
    forward_bias: float = 0.7,
) -> tuple[tuple[int, int, int, int], tuple[float, float]]:
    """Return ((x1,y1,x2,y2), (anchor_x, anchor_y)).

    With elbow available we know the forearm direction (elbow -> wrist), so
    we can build a crop that is biased ALONG that direction:

      - axial extent = ``crop_ratio * forearm_len`` (or ``min_side_px``)
        split asymmetrically: ``forward_bias`` of it lies BEYOND the wrist
        (where the held tool is) and ``1 - forward_bias`` lies BEHIND
        (back toward the elbow / hand body).  Default 0.70 = 70% forward.
      - cross-axis extent = ``0.5 * axial_extent`` so the crop is rectangular,
        narrow across the forearm, long along it.

    The returned bbox is the AXIS-ALIGNED bounding box of that rotated
    rectangle (we don't rotate the crop because YOLO ingests AABBs).  The
    anchor point reported back is the geometric center of that bbox.

    Without elbow we fall back to a fixed-size square centered on the wrist.
    """
    wx, wy = wrist_xy
    if elbow_xy is None:
        half = float(fallback_half_size)
        cx, cy = wx, wy
        x1 = max(0, int(round(cx - half)))
        y1 = max(0, int(round(cy - half)))
        x2 = min(frame_w, int(round(cx + half)))
        y2 = min(frame_h, int(round(cy + half)))
        return ((x1, y1, x2, y2), (float(cx), float(cy)))

    ex, ey = elbow_xy
    dx, dy = wx - ex, wy - ey
    forearm_len = math.hypot(dx, dy)
    if forearm_len <= 1e-3:
        half = float(fallback_half_size)
        cx, cy = wx, wy
        x1 = max(0, int(round(cx - half)))
        y1 = max(0, int(round(cy - half)))
        x2 = min(frame_w, int(round(cx + half)))
        y2 = min(frame_h, int(round(cy + half)))
        return ((x1, y1, x2, y2), (float(cx), float(cy)))

    ux, uy = dx / forearm_len, dy / forearm_len
    # Perpendicular unit vector (cross-axis)
    px, py = -uy, ux

    axial = max(float(min_side_px), crop_ratio * forearm_len)
    cross = 0.5 * axial
    fwd = forward_bias * axial
    back = (1.0 - forward_bias) * axial

    # Four corners of the rotated rectangle in image space.
    cx_full = wx + ux * (forward_ratio * forearm_len)  # legacy push (small)
    cy_full = wy + uy * (forward_ratio * forearm_len)
    p_fwd_x = cx_full + ux * fwd
    p_fwd_y = cy_full + uy * fwd
    p_back_x = cx_full - ux * back
    p_back_y = cy_full - uy * back

    corners = [
        (p_fwd_x + px * cross, p_fwd_y + py * cross),
        (p_fwd_x - px * cross, p_fwd_y - py * cross),
        (p_back_x + px * cross, p_back_y + py * cross),
        (p_back_x - px * cross, p_back_y - py * cross),
    ]
    xs = [c[0] for c in corners]
    ys = [c[1] for c in corners]
    x1 = max(0, int(round(min(xs))))
    y1 = max(0, int(round(min(ys))))
    x2 = min(frame_w, int(round(max(xs))))
    y2 = min(frame_h, int(round(max(ys))))

    # Anchor reported back = AABB center (used for the green dot in drawings).
    cx = 0.5 * (x1 + x2)
    cy = 0.5 * (y1 + y2)
    return ((x1, y1, x2, y2), (float(cx), float(cy)))


# =============================================================================
#  drawing
# =============================================================================

_SIDE_COLOR = {
    "Left": (255, 180, 60),   # cyan-ish
    "Right": (60, 180, 255),  # orange-ish
}


def _draw_header(frame: np.ndarray, *, src_idx: int, ts_sec: float, sharp: float) -> None:
    txt = f"src#{src_idx}  t={ts_sec:.2f}s  sharp={sharp:.0f}"
    cv2.putText(
        frame, txt, (12, 26), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (240, 240, 240), 2, cv2.LINE_AA
    )


def _draw_hand_box(
    frame: np.ndarray,
    side: str,
    bbox: tuple[int, int, int, int],
    anchor: tuple[float, float],
) -> None:
    color = _SIDE_COLOR.get(side, (200, 200, 60))
    x1, y1, x2, y2 = bbox
    cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)
    ax, ay = int(round(anchor[0])), int(round(anchor[1]))
    cv2.circle(frame, (ax, ay), 4, (60, 220, 60), -1)
    label = f"{side}"
    cv2.putText(
        frame, label, (x1, max(14, y1 - 6)),
        cv2.FONT_HERSHEY_SIMPLEX, 0.55, color, 2, cv2.LINE_AA,
    )


def _draw_crop_box(frame: np.ndarray, crop_box: tuple[float, float, float, float]) -> None:
    x1, y1, x2, y2 = (int(round(v)) for v in crop_box)
    cv2.rectangle(frame, (x1, y1), (x2, y2), (200, 200, 200), 1)


# =============================================================================
#  per-window frame gather (sharpness only - no hand detection)
# =============================================================================

def _gather_window(
    cap,
    anchor_idx: int,
    half_window: int,
    crop_box: tuple[float, float, float, float] | None,
    *,
    enhance_mode: str,
    dark_threshold: float,
    enhance_gamma: float,
):
    """Read every input frame in [anchor +/- half_window], score by sharpness,
    and decide per-frame whether enhancement is needed.  Returns rows sorted
    sharpest-first."""
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
        crop_view = frame
        if crop_box is not None:
            cx1, cy1, cx2, cy2 = (int(round(v)) for v in crop_box)
            cx2 = max(cx2, cx1 + 1)
            cy2 = max(cy2, cy1 + 1)
            crop_view = frame[cy1:cy2, cx1:cx2]
        enhance_input = _decide_enhance(crop_view, enhance_mode, dark_threshold)
        rows.append(
            {
                "fi": fi,
                "sharpness": sharpness,
                "frame": frame,
                "enhance_input": enhance_input,
            }
        )
    rows.sort(key=lambda r: r["sharpness"], reverse=True)
    return rows


def _probe_video_fps(video_path: Path) -> float:
    """Best-effort FPS for metadata when we skip full decode."""
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        return 30.0
    try:
        return float(cap.get(cv2.CAP_PROP_FPS) or 0.0) or 30.0
    finally:
        cap.release()


def _write_empty_evidence_json(
    run_dir: Path,
    video_path: Path,
    *,
    stub_reason: str,
    src_fps: float,
    window_sec: float,
    picks: int,
    person_pad: float,
    person_conf: float,
    kp_conf: float,
    enhance_mode: str,
    enhance_gamma: float,
    dark_threshold: float,
    forearm_forward_ratio: float,
    forearm_crop_ratio: float,
    min_pose_crop_px: int,
    forward_bias: float,
    pose_synth_size: int,
) -> Path:
    """Emit evidence.json with ``frames: []`` so Step 2b / merge never fail on
    missing file (empty room, reducer dropped all person anchors, etc.)."""
    out_dir = run_dir / "zoom_evidence"
    out_dir.mkdir(parents=True, exist_ok=True)
    payload = {
        "run_dir": run_dir.as_posix(),
        "video": video_path.as_posix(),
        "src_fps": src_fps,
        "stub": True,
        "stub_reason": stub_reason,
        "window_sec": window_sec,
        "picks_per_sample": picks,
        "person_pad": person_pad,
        "person_conf": person_conf,
        "kp_conf": kp_conf,
        "enhance_mode": enhance_mode,
        "enhance_gamma": enhance_gamma,
        "dark_threshold": dark_threshold,
        "forearm_forward_ratio": forearm_forward_ratio,
        "forearm_crop_ratio": forearm_crop_ratio,
        "min_pose_crop_px": min_pose_crop_px,
        "forward_bias": forward_bias,
        "pose_synth_size": pose_synth_size,
        "static_clusters_excluded": [],
        "person_samples": 0,
        "frames_emitted": 0,
        "frames": [],
    }
    out_json = out_dir / "evidence.json"
    out_json.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(f"[STUB] Wrote empty evidence.json ({stub_reason}):\n  {out_json}")
    return out_json


# =============================================================================
#  run
# =============================================================================

def run(
    run_dir: Path,
    *,
    video_path: Path,
    pose_weights: Path | None,
    window_sec: float,
    picks: int,
    person_pad: float,
    person_conf: float,
    kp_conf: float,
    enhance_mode: str,
    enhance_gamma: float,
    dark_threshold: float,
    forearm_forward_ratio: float,
    forearm_crop_ratio: float,
    min_pose_crop_px: int,
    forward_bias: float,
    pose_synth_size: int,
    show: bool,
    delay_ms: int,
    use_reducer: bool = True,
) -> int:
    if not video_path.is_file():
        print(f"[ERROR] source video not found: {video_path}")
        return 1

    def _emit_empty_stub(reason: str) -> None:
        _write_empty_evidence_json(
            run_dir,
            video_path,
            stub_reason=reason,
            src_fps=_probe_video_fps(video_path),
            window_sec=window_sec,
            picks=picks,
            person_pad=person_pad,
            person_conf=person_conf,
            kp_conf=kp_conf,
            enhance_mode=enhance_mode,
            enhance_gamma=enhance_gamma,
            dark_threshold=dark_threshold,
            forearm_forward_ratio=forearm_forward_ratio,
            forearm_crop_ratio=forearm_crop_ratio,
            min_pose_crop_px=min_pose_crop_px,
            forward_bias=forward_bias,
            pose_synth_size=pose_synth_size,
        )

    step1 = _load_step1_detections(run_dir)
    if not step1 or not step1.get("frames"):
        print(f"[ERROR] Step 1 detections.json not found in {run_dir / 'detections'}.")
        print("Run first: python ai/models/SCVAM2.1/dectator.py")
        return 1

    person_frames: list[dict[str, Any]] = [
        f for f in step1["frames"] if "person" in (f.get("labels") or [])
    ]
    if not person_frames:
        print("[INFO] No 'person' frames in Step 1 - nothing to zoom on.")
        _emit_empty_stub("no_person_in_step1")
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
                    "rerun with --no-reducer to process them anyway."
                )
                _emit_empty_stub("reducer_dropped_all_person_samples")
                return 0
        else:
            print(
                "[REDUCER] No reduced/active_frames.json - processing all person "
                "samples (run reducer.py to enable filtering)."
            )

    static_clusters = _detect_static_person_clusters(person_frames)
    if static_clusters:
        print(
            f"[FILTER] Detected {len(static_clusters)} static 'person' cluster(s) - "
            f"these will be excluded as wall art / printed photos:"
        )
        for sx, sy in static_clusters:
            print(f"           centroid=({sx:.0f}, {sy:.0f})")
        kept = []
        for fmeta in person_frames:
            if _person_bbox_from_dets(
                fmeta.get("detections") or [],
                static_clusters=static_clusters,
            ) is not None:
                kept.append(fmeta)
        if kept:
            print(
                f"[FILTER] {len(person_frames)} -> {len(kept)} samples after "
                f"removing static-only frames."
            )
            person_frames = kept
        else:
            print(
                "[FILTER] All person samples are static; ignoring filter so we "
                "still process them."
            )
            static_clusters = []

    pose_model = _load_yolo_pose(pose_weights)
    if pose_model is None:
        print("[ERROR] could not load pose model; aborting.")
        return 1

    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        print(f"[ERROR] could not open video: {video_path}")
        return 1
    src_fps = float(cap.get(cv2.CAP_PROP_FPS) or 0.0) or 30.0
    half_window = max(1, int(round(window_sec * src_fps)))

    out_dir = run_dir / "zoom_evidence"
    out_dir.mkdir(parents=True, exist_ok=True)

    win_name = "SCVAM2.1 Step 2 Zoom Evidence (pose-only)"
    if show:
        cv2.namedWindow(win_name, cv2.WINDOW_NORMAL)
        cv2.resizeWindow(win_name, 960, 540)

    print(
        f"Step 2 zoom on {len(person_frames)} person samples\n"
        f"  video:           {video_path}\n"
        f"  src_fps:         {src_fps:.3f}\n"
        f"  window:          +/-{half_window} src frames (~{window_sec:.2f}s)\n"
        f"  picks/sample:    {picks}\n"
        f"  person_pad:      {person_pad}\n"
        f"  pose_weights:    {pose_weights or '(auto: yolov8n-pose.pt)'}\n"
        f"  pose conf:       person={person_conf:.2f}  kp={kp_conf:.2f}\n"
        f"  forearm crop:    forward={forearm_forward_ratio:.2f}  "
        f"side={forearm_crop_ratio:.2f}x  min={min_pose_crop_px}px  "
        f"fwd_bias={forward_bias:.2f}\n"
        f"  enhance:         mode={enhance_mode}  gamma={enhance_gamma:.2f}  "
        f"dark<{dark_threshold:.0f}\n"
        f"  out_dir:         {out_dir}"
    )

    summary: list[dict[str, Any]] = []
    emitted_src: set[int] = set()
    quit_early = False
    log_every = max(1, len(person_frames) // 20)

    n_with_left = 0
    n_with_right = 0
    n_no_pose = 0

    for i, fmeta in enumerate(person_frames, start=1):
        sample_name = str(fmeta.get("frame", ""))
        sample_ts = float(fmeta.get("ts_sec", 0.0))
        anchor_idx = int(fmeta.get("src_index", int(round(sample_ts * src_fps))))

        person_box_raw = _person_bbox_from_dets(
            fmeta.get("detections") or [],
            static_clusters=static_clusters,
        )

        crop_box: tuple[float, float, float, float] | None = None
        if person_box_raw is not None:
            cap.set(cv2.CAP_PROP_POS_FRAMES, anchor_idx)
            ok, probe = cap.read()
            if ok and probe is not None:
                ph, pw = probe.shape[:2]
                crop_box = _expand_bbox(person_box_raw, pw, ph, pad=person_pad)

        candidates = _gather_window(
            cap,
            anchor_idx,
            half_window,
            crop_box,
            enhance_mode=enhance_mode,
            dark_threshold=dark_threshold,
            enhance_gamma=enhance_gamma,
        )
        if not candidates:
            continue

        chosen: list[dict[str, Any]] = []
        for c in candidates:
            if c["fi"] in emitted_src:
                continue
            chosen.append(c)
            if len(chosen) >= picks:
                break
        if not chosen:
            continue

        for rank, c in enumerate(chosen, start=1):
            fi = c["fi"]
            frame = c["frame"]
            sharpness = c["sharpness"]
            enhance_input = c["enhance_input"]
            h, w = frame.shape[:2]
            emitted_src.add(fi)

            inf_frame = (
                _enhance_for_inference(frame, gamma=enhance_gamma)
                if enhance_input
                else frame
            )

            wrists = _pose_wrists(
                pose_model,
                inf_frame,
                crop_box,
                person_conf=person_conf,
                kp_conf=kp_conf,
            )

            hands_data: list[dict[str, Any]] = []
            for kp in wrists:
                wxy = kp.get("wrist")
                if wxy is None:
                    continue
                bbox, anchor = _hand_box_from_arm(
                    wxy,
                    kp.get("elbow"),
                    frame_w=w,
                    frame_h=h,
                    forward_ratio=forearm_forward_ratio,
                    crop_ratio=forearm_crop_ratio,
                    min_side_px=min_pose_crop_px,
                    fallback_half_size=pose_synth_size,
                    forward_bias=forward_bias,
                )
                hands_data.append(
                    {
                        "side": kp["side"],
                        "synthetic": True,
                        "bbox": list(bbox),
                        "wrist": [float(wxy[0]), float(wxy[1])],
                        "elbow": (
                            [float(kp["elbow"][0]), float(kp["elbow"][1])]
                            if kp.get("elbow") is not None
                            else None
                        ),
                        "anchor": [float(anchor[0]), float(anchor[1])],
                        "kp_conf": round(float(kp.get("kp_conf") or 0.0), 4),
                        "elbow_conf": round(float(kp.get("elbow_conf") or 0.0), 4),
                        # placeholders populated by zoom_evidence_dectator.py
                        "object_in_hand": None,
                        "category": None,
                        "objects": [],
                        "landmarks": [],
                    }
                )

            sides_present = {h_["side"] for h_ in hands_data}
            if "Left" in sides_present:
                n_with_left += 1
            if "Right" in sides_present:
                n_with_right += 1
            if not hands_data:
                n_no_pose += 1

            # ---- annotate frame
            if crop_box is not None:
                _draw_crop_box(frame, crop_box)
            _draw_header(frame, src_idx=fi, ts_sec=fi / src_fps, sharp=sharpness)
            for hd in hands_data:
                _draw_hand_box(
                    frame, hd["side"], tuple(hd["bbox"]), tuple(hd["anchor"])
                )

            stem_name = Path(sample_name).stem if sample_name else f"s{i:06d}"
            out_name = f"{stem_name}_pick{rank}_src{fi:06d}.png"
            cv2.imwrite(str(out_dir / out_name), frame)

            summary.append(
                {
                    "sample_frame": sample_name,
                    "sample_ts_sec": sample_ts,
                    "source_frame_index": fi,
                    "source_ts_sec": round(fi / src_fps, 3),
                    "sharpness": round(sharpness, 1),
                    "enhance_input": bool(enhance_input),
                    "enhance_gamma": enhance_gamma if enhance_input else None,
                    "person_bbox": list(person_box_raw) if person_box_raw is not None else None,
                    "crop_bbox": list(crop_box) if crop_box is not None else None,
                    "pose_used": bool(hands_data),
                    "pose_fallback_used": bool(hands_data),  # legacy alias
                    "hands_found": len(hands_data),
                    "hands": hands_data,
                    # placeholders the dector fills in
                    "held_objects_full_frame": [],
                    "held_objects_from_person_zoom": [],
                    "held_objects_from_hand_zoom": [],
                    "held_categories": [],
                    "output": out_name,
                }
            )

            if i == 1 or i == len(person_frames) or i % log_every == 0:
                tag = ", ".join(h_["side"] for h_ in hands_data) or "no-pose"
                print(
                    f"  [{i}/{len(person_frames)}] {sample_name} pick{rank} "
                    f"src#{fi} t={fi / src_fps:.2f}s sharp={sharpness:.0f} "
                    f"enh={'Y' if enhance_input else 'N'}: {tag}"
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

    payload = {
        "run_dir": run_dir.as_posix(),
        "video": video_path.as_posix(),
        "src_fps": src_fps,
        "window_sec": window_sec,
        "picks_per_sample": picks,
        "person_pad": person_pad,
        "person_conf": person_conf,
        "kp_conf": kp_conf,
        "enhance_mode": enhance_mode,
        "enhance_gamma": enhance_gamma,
        "dark_threshold": dark_threshold,
        "forearm_forward_ratio": forearm_forward_ratio,
        "forearm_crop_ratio": forearm_crop_ratio,
        "min_pose_crop_px": min_pose_crop_px,
        "forward_bias": forward_bias,
        "pose_synth_size": pose_synth_size,
        "static_clusters_excluded": [list(c) for c in static_clusters],
        "person_samples": len(person_frames),
        "frames_emitted": len(summary),
        "frames": summary,
    }
    out_json = out_dir / "evidence.json"
    out_json.write_text(json.dumps(payload, indent=2), encoding="utf-8")

    print(
        f"\nDone. emitted={len(summary)}  "
        f"left={n_with_left} right={n_with_right} no_pose={n_no_pose}\n"
        f"Annotated frames: {out_dir}\n"
        f"Evidence JSON:    {out_json}\n"
        f"\nNext: python ai/models/SCVAM2.1/zoom_evidence_dectator.py\n"
        f"      python ai/models/SCVAM2.1/zoom_evidence_verify.py   # optional 2c"
    )
    return 0


# =============================================================================
#  CLI
# =============================================================================

def main() -> int:
    parser = argparse.ArgumentParser(
        description="Step 2: pose-driven Left/Right hand crops on person samples."
    )
    parser.add_argument(
        "--run", default="",
        help="Step 1 run dir (default: newest under ai/models/SCVAM2.1/output).",
    )
    parser.add_argument(
        "--video", default="",
        help="Source video path (default: SELECTED_VIDEO.txt from test.py).",
    )
    parser.add_argument(
        "--pose-weights", default="",
        help="Path to a YOLOv8-pose .pt model (default: auto-download yolov8n-pose.pt).",
    )
    parser.add_argument(
        "--window-sec", type=float, default=0.4,
        help="Half-window of source frames around each person sample (default 0.4s).",
    )
    parser.add_argument(
        "--picks", type=int, default=3,
        help="How many frames to emit per person sample (default 3).",
    )
    parser.add_argument(
        "--person-pad", type=float, default=0.25,
        help="Padding fraction added to YOLO person bbox before cropping (default 0.25).",
    )
    parser.add_argument(
        "--person-conf", type=float, default=0.20,
        help="YOLO-pose min person confidence (default 0.20).",
    )
    parser.add_argument(
        "--kp-conf", type=float, default=0.20,
        help="YOLO-pose min keypoint confidence for wrist/elbow (default 0.20).",
    )
    parser.add_argument(
        "--forearm-forward-ratio", type=float, default=0.35,
        help="Hand-box anchor pushed beyond the wrist by this fraction of the "
        "forearm length (default 0.35).",
    )
    parser.add_argument(
        "--forearm-crop-ratio", type=float, default=1.2,
        help="Hand-box side = max(min-pose-crop-px, this * forearm length) "
        "(default 1.2).",
    )
    parser.add_argument(
        "--min-pose-crop-px", type=int, default=80,
        help="Floor on the hand-box side in pixels (default 80).",
    )
    parser.add_argument(
        "--forward-bias", type=float, default=0.7,
        help="Asymmetric crop split along the forearm axis: this fraction of "
        "the axial extent lies BEYOND the wrist (where a held tool is), the "
        "rest lies behind it. 0.5 = symmetric, 0.7 = 70%% forward (default).",
    )
    parser.add_argument(
        "--pose-synth-size", type=int, default=70,
        help="Fallback half-size (px) when no elbow keypoint is available "
        "(default 70 -> ~140px square).",
    )
    parser.add_argument(
        "--enhance-mode", default="auto", choices=("auto", "on", "off"),
        help="Backlight rescue: auto = enhance only when crop is dark (default).",
    )
    parser.add_argument(
        "--enhance-gamma", type=float, default=0.6,
        help="Gamma for shadow-brightening (<1 brightens, default 0.6).",
    )
    parser.add_argument(
        "--dark-threshold", type=float, default=70.0,
        help="Mean grayscale below which a crop is treated as dark in auto mode "
        "(0-255, default 70).",
    )
    parser.add_argument(
        "--no-reducer", action="store_true",
        help="Ignore reduced/active_frames.json even if reducer.py was run.",
    )
    parser.add_argument("--no-show", action="store_true", help="Skip preview window.")
    parser.add_argument(
        "--delay-ms", type=int, default=200,
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

    return run(
        run_dir,
        video_path=video_path,
        pose_weights=Path(args.pose_weights).expanduser().resolve() if args.pose_weights else None,
        window_sec=max(0.05, args.window_sec),
        picks=max(1, args.picks),
        person_pad=max(0.0, args.person_pad),
        person_conf=max(0.01, args.person_conf),
        kp_conf=max(0.01, args.kp_conf),
        enhance_mode=args.enhance_mode,
        enhance_gamma=max(0.1, min(2.0, args.enhance_gamma)),
        dark_threshold=max(0.0, min(255.0, args.dark_threshold)),
        forearm_forward_ratio=max(0.0, min(1.5, args.forearm_forward_ratio)),
        forearm_crop_ratio=max(0.5, min(3.0, args.forearm_crop_ratio)),
        min_pose_crop_px=max(20, args.min_pose_crop_px),
        forward_bias=max(0.3, min(0.95, args.forward_bias)),
        pose_synth_size=max(20, args.pose_synth_size),
        show=not args.no_show,
        delay_ms=max(1, args.delay_ms),
        use_reducer=not args.no_reducer,
    )


if __name__ == "__main__":
    sys.exit(main())
