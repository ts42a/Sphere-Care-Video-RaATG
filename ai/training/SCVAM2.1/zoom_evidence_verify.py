"""
Step 2c: second-pass held-object verification on hand crops.

After zoom_evidence_dectator.py (2b), re-read each source frame, crop the same
hand regions, build one **high-resolution** square crop (denoise + Lanczos +
optional cv2.dnn_superres), and run YOLO over **N enhancement variations**
(test-time augmentation). Detections from each variation are clustered by IoU,
and only clusters with at least ``--min-supporters`` agreeing variations
become the final held-object call.

Variations (--variations, default order):
  baseline        gamma 0.75 + CLAHE 2.5 + mild unsharp.
  shadow_lift     gamma 0.45 + CLAHE 2.0 (heavy shadow lift, no sharpen).
  contrast_punch  gamma 0.85 + CLAHE 4.5 + strong unsharp.
  luma_only       CLAHE on L only + saturation 0.5 (metallic edges pop).
  edge_boost      bilateral filter + CLAHE 2.0 + tighter unsharp.

Silhouette modes (--silhouette-mode):
  off        no masking; YOLO sees the raw enhanced crop.
  hand_only  (default) erode the dark silhouette before grey-filling so the
             blade boundary stays visible, but a separately dilated mask is
             still used to drop arm-shaped detections.
  full       grey-fill the entire dilated silhouette.

Auto low-conf retry (--retry-low-conf, default ON):
  Within each variation, if the main pass returns nothing, retry at
  --retry-conf (default 0.04) on --retry-classes (default knife,scissors,
  fork). Retry results still pass through the same silhouette overlap drop.

Cross-variation consensus (TTA mode, --tta, default ON):
  All kept dets from all variations are clustered by label + IoU
  (>= --consensus-iou, default 0.5). A cluster with >= --min-supporters
  variations (default 2) is "consensus".
  agreement values:
    consensus_match              consensus + label matches 2b
    consensus_label_changed      consensus + different label
    new_detection_consensus      consensus + 2b had no label
    low_conf_recovered_consensus consensus formed only from retry passes
    single_variation_only        some det but didn't reach min_supporters
    cleared_false_positive       no det at all + 2b had a label
    both_empty                   no det at all + 2b had nothing

Use --no-tta to fall back to the legacy single-pass verifier (no TTA, no SR,
single enhancement preset).

Restrict to specific frames with --frames frame_000018,frame_000020 or 18,20.

Inputs:
  zoom_evidence/evidence.json   (patched by 2a + 2b)
  source video (SELECTED_VIDEO.txt or --video)

Outputs (under <run_dir>/zoom_evidence_verify/):
  verify.json                                        per-hand variations + consensus
  <stem>_pick<K>_src<NNNNNN>_<side>_verify.png       baseline crop +
                                                     5-cell variation strip
  (with --save-all-variations: one PNG per variation per hand)
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

import cv2
import numpy as np

REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_WEIGHTS = REPO_ROOT / "ai" / "models" / "yolo" / "yolov8s.pt"
SELECTED_NAME = "SELECTED_VIDEO.txt"

# Load helpers + YOLO crop pipeline from step 2b (same geometry / gates).
import importlib.util

_pkg = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location(
    "_zoom_evidence_dectator", _pkg / "zoom_evidence_dectator.py"
)
_zed = importlib.util.module_from_spec(_spec)
assert _spec.loader is not None
_spec.loader.exec_module(_zed)

DEFAULT_VERIFY_CLASSES: tuple[str, ...] = (
    "knife",
    "scissors",
    "fork",
    "bottle",
    "cup",
    "wine glass",
    "cell phone",
    "baseball bat",
    "umbrella",
)

DEFAULT_RETRY_CLASSES: tuple[str, ...] = ("knife", "scissors", "fork")

SILHOUETTE_MODES: tuple[str, ...] = ("off", "hand_only", "full")


def _package_dir() -> Path:
    return Path(__file__).resolve().parent


def _newest_run_dir() -> Path | None:
    out_root = _package_dir() / "output"
    if not out_root.is_dir():
        return None
    cands = [
        d
        for d in out_root.iterdir()
        if d.is_dir() and (d / "zoom_evidence" / "evidence.json").is_file()
    ]
    if not cands:
        return None
    cands.sort(key=lambda d: d.stat().st_mtime, reverse=True)
    return cands[0]


def _read_selected_video() -> Path | None:
    p = _package_dir() / SELECTED_NAME
    if not p.is_file():
        return None
    text = p.read_text(encoding="utf-8").strip()
    return Path(text) if text else None


def _enhance_bgr(
    bgr: np.ndarray,
    *,
    clahe_clip: float,
    sharpen: bool,
    gamma: float | None,
) -> np.ndarray:
    out = bgr
    if gamma is not None and abs(gamma - 1.0) > 1e-3:
        out = np.clip((out.astype(np.float32) / 255.0) ** gamma * 255.0, 0, 255).astype(
            np.uint8
        )
    lab = cv2.cvtColor(out, cv2.COLOR_BGR2LAB)
    l_ch, a_ch, b_ch = cv2.split(lab)
    clahe = cv2.createCLAHE(
        clipLimit=max(1.0, clahe_clip), tileGridSize=(8, 8)
    )
    l2 = clahe.apply(l_ch)
    merged = cv2.merge([l2, a_ch, b_ch])
    out = cv2.cvtColor(merged, cv2.COLOR_LAB2BGR)
    if sharpen:
        blur = cv2.GaussianBlur(out, (0, 0), sigmaX=3)
        out = cv2.addWeighted(out, 1.45, blur, -0.45, 0)
    return out


def _silhouette_masks(
    fed_bgr: np.ndarray, mode: str
) -> tuple[np.ndarray, np.ndarray]:
    """Return (fill_mask, drop_mask).

    fill_mask: pixels we grey-fill before YOLO. Shape depends on ``mode``:
      - 'off'       : empty (no masking).
      - 'hand_only' : eroded core of the largest dark CC; the silhouette
                      boundary (and any blade attached to it) stays visible.
      - 'full'      : dilated silhouette (legacy aggressive mask).
    drop_mask: pixels used for the arm-shape overlap check. Always the dilated
    silhouette so we still reject arm-shaped boxes regardless of mode (unless
    mode='off', in which case it's empty too).
    """
    empty = np.zeros(fed_bgr.shape[:2], dtype=np.uint8)
    if mode == "off":
        return empty, empty

    hsv = cv2.cvtColor(fed_bgr, cv2.COLOR_BGR2HSV)
    v = hsv[:, :, 2]
    _, dark = cv2.threshold(
        v, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU
    )
    num, lbl, stats, _ = cv2.connectedComponentsWithStats(dark, connectivity=8)
    if num <= 1:
        return empty, empty
    largest_i = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    big_area = int(stats[largest_i, cv2.CC_STAT_AREA])
    img_area = int(fed_bgr.shape[0] * fed_bgr.shape[1])
    if big_area < 0.05 * img_area or big_area > 0.85 * img_area:
        return empty, empty
    base = (lbl == largest_i).astype(np.uint8) * 255

    dilate_k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    drop_mask = cv2.dilate(base, dilate_k, iterations=1)

    if mode == "hand_only":
        erode_k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))
        fill_mask = cv2.erode(base, erode_k, iterations=1)
    else:  # 'full'
        fill_mask = drop_mask
    return fill_mask, drop_mask


def _suppress_silhouette(
    fed_bgr: np.ndarray, mask: np.ndarray, fill_value: int = 128
) -> np.ndarray:
    if mask is None or int(mask.sum()) == 0:
        return fed_bgr
    out = fed_bgr.copy()
    out[mask > 0] = (fill_value, fill_value, fill_value)
    return out


def _bbox_overlap_with_mask(
    fed_bbox: tuple[float, float, float, float], mask: np.ndarray
) -> float:
    if mask is None or int(mask.sum()) == 0:
        return 0.0
    H, W = mask.shape[:2]
    x1 = max(0, int(round(fed_bbox[0])))
    y1 = max(0, int(round(fed_bbox[1])))
    x2 = min(W, int(round(fed_bbox[2])))
    y2 = min(H, int(round(fed_bbox[3])))
    if x2 <= x1 or y2 <= y1:
        return 0.0
    sub = mask[y1:y2, x1:x2]
    return float((sub > 0).sum()) / float(max(1, sub.size))


def _decode_yolo_boxes(
    res,
    *,
    drop_mask: np.ndarray,
    silhouette_drop_threshold: float,
    suppress_active: bool,
    scale: float,
    pad_x: int,
    pad_y: int,
    cx1: int,
    cy1: int,
    conf_floor: float,
    extra_record_keys: dict[str, Any],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Convert one YOLO result into (kept_dets, dropped_dets) in full-frame
    coords. Drops detections whose bbox sits over >=threshold of drop_mask."""
    names = getattr(res, "names", {}) or {}
    kept: list[dict[str, Any]] = []
    dropped: list[dict[str, Any]] = []
    for box in res.boxes or []:
        c = float(box.conf[0])
        if c < conf_floor:
            continue
        cls_id = int(box.cls[0])
        label = str(names.get(cls_id, f"class_{cls_id}")).strip().lower()
        cat = _zed._categorize_label(label)
        if cat is None:
            continue
        bx1, by1, bx2, by2 = (float(v) for v in box.xyxy[0].tolist())
        sil_overlap = _bbox_overlap_with_mask(
            (bx1, by1, bx2, by2), drop_mask
        )
        ux1 = bx1 * scale - pad_x + cx1
        uy1 = by1 * scale - pad_y + cy1
        ux2 = bx2 * scale - pad_x + cx1
        uy2 = by2 * scale - pad_y + cy1
        rec = {
            "label": label,
            "confidence": round(c, 4),
            "category": cat,
            "xyxy": [ux1, uy1, ux2, uy2],
            "fed_xyxy": [bx1, by1, bx2, by2],
            "from_verify_pass": True,
            "silhouette_overlap": round(sil_overlap, 3),
            **extra_record_keys,
        }
        if suppress_active and sil_overlap >= silhouette_drop_threshold:
            dropped.append(rec)
        else:
            kept.append(rec)
    kept.sort(key=lambda d: float(d["confidence"]), reverse=True)
    return kept, dropped


def _draw_dets(
    fed_annot: np.ndarray,
    dets: list[dict[str, Any]],
    *,
    color: tuple[int, int, int],
    prefix: str,
) -> None:
    for d in dets:
        bx = d.get("fed_xyxy") or [0, 0, 0, 0]
        bx1, by1, bx2, by2 = (int(round(float(x))) for x in bx)
        cv2.rectangle(fed_annot, (bx1, by1), (bx2, by2), color, 2)
        cv2.putText(
            fed_annot,
            f"{prefix}{d.get('label')} {float(d.get('confidence') or 0):.2f}",
            (bx1, max(14, by1 - 6)),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.55,
            color,
            2,
            cv2.LINE_AA,
        )


# =====================================================================
# Test-time augmentation: variations + consensus voting
# =====================================================================

_VARIATIONS_BUILTIN: tuple[str, ...] = (
    "baseline",
    "shadow_lift",
    "contrast_punch",
    "luma_only",
    "edge_boost",
)


def _gamma_apply(bgr: np.ndarray, g: float) -> np.ndarray:
    if g is None or abs(float(g) - 1.0) < 1e-3:
        return bgr
    arr = bgr.astype(np.float32) / 255.0
    return np.clip(np.power(arr, float(g)) * 255.0, 0, 255).astype(np.uint8)


def _clahe_l_apply(bgr: np.ndarray, clip: float) -> np.ndarray:
    lab = cv2.cvtColor(bgr, cv2.COLOR_BGR2LAB)
    l_ch, a_ch, b_ch = cv2.split(lab)
    clahe = cv2.createCLAHE(clipLimit=max(1.0, float(clip)), tileGridSize=(8, 8))
    l2 = clahe.apply(l_ch)
    return cv2.cvtColor(cv2.merge([l2, a_ch, b_ch]), cv2.COLOR_LAB2BGR)


def _unsharp_apply(bgr: np.ndarray, *, amount: float, sigma: float) -> np.ndarray:
    blur = cv2.GaussianBlur(bgr, (0, 0), sigmaX=float(sigma))
    return cv2.addWeighted(bgr, float(amount), blur, -(float(amount) - 1.0), 0)


def _apply_variant(bgr: np.ndarray, name: str) -> np.ndarray:
    """Return ``bgr`` with the named variation applied. Unknown names fall back
    to the baseline so the caller can keep the per-variation list driven by a
    user-supplied CSV without crashing."""
    if name == "baseline":
        out = _gamma_apply(bgr, 0.75)
        out = _clahe_l_apply(out, 2.5)
        return _unsharp_apply(out, amount=1.45, sigma=3.0)
    if name == "shadow_lift":
        out = _gamma_apply(bgr, 0.45)
        return _clahe_l_apply(out, 2.0)
    if name == "contrast_punch":
        out = _gamma_apply(bgr, 0.85)
        out = _clahe_l_apply(out, 4.5)
        return _unsharp_apply(out, amount=1.7, sigma=2.0)
    if name == "luma_only":
        out = _clahe_l_apply(bgr, 3.0)
        hsv = cv2.cvtColor(out, cv2.COLOR_BGR2HSV)
        s = hsv[:, :, 1].astype(np.float32) * 0.5
        hsv[:, :, 1] = np.clip(s, 0, 255).astype(np.uint8)
        return cv2.cvtColor(hsv, cv2.COLOR_HSV2BGR)
    if name == "edge_boost":
        bf = cv2.bilateralFilter(bgr, d=5, sigmaColor=50, sigmaSpace=50)
        out = _clahe_l_apply(bf, 2.0)
        return _unsharp_apply(out, amount=1.8, sigma=1.5)
    return _apply_variant(bgr, "baseline")


def _load_sr_engine(weights_path: Path | None):
    """Best-effort cv2.dnn_superres loader. Returns ``None`` (and prints a
    one-line warning) if anything goes wrong; callers should then fall back to
    Lanczos upscaling."""
    if weights_path is None:
        return None
    raw = str(weights_path).strip()
    if not raw:
        return None
    p = Path(raw).expanduser()
    if not p.is_file():
        print(f"[WARN] SR weights not found: {p}; using Lanczos upscale instead.")
        return None
    if not hasattr(cv2, "dnn_superres"):
        print(
            "[WARN] cv2.dnn_superres unavailable (need opencv-contrib-python); "
            "using Lanczos upscale instead."
        )
        return None
    try:
        sr = cv2.dnn_superres.DnnSuperResImpl_create()
        sr.readModel(str(p))
        name = p.stem.lower()
        scale = 2
        for cand in (4, 3, 2):
            if f"x{cand}" in name:
                scale = cand
                break
        model_kind = "edsr"
        for m in ("edsr", "espcn", "fsrcnn", "lapsrn"):
            if m in name:
                model_kind = m
                break
        sr.setModel(model_kind, scale)
        print(f"[INFO] super-resolution: {model_kind} x{scale} from {p.name}")
        return sr
    except Exception as exc:
        print(f"[WARN] could not load SR weights {p}: {exc}")
        return None


def _build_fed_high_res(
    frame_bgr: np.ndarray,
    hand_bbox: tuple[float, float, float, float],
    *,
    crop_pad: float,
    target: int,
    denoise: bool,
    interp: str,
    sr_engine,
):
    """Crop, optional denoise + super-resolve, square-pad, then resize to
    (target, target). Returns (fed_bgr, geom) or None when the bbox is empty.
    ``geom`` records every transform so detections can be mapped back to the
    source frame coordinate system (and inverted for annotation)."""
    fh, fw = frame_bgr.shape[:2]
    cx1, cy1, cx2, cy2 = _zed._expand_pad(
        hand_bbox, pad=crop_pad, frame_w=fw, frame_h=fh
    )
    if cx2 <= cx1 or cy2 <= cy1:
        return None
    crop = frame_bgr[cy1:cy2, cx1:cx2]
    if crop.size == 0:
        return None

    if denoise:
        try:
            crop = cv2.fastNlMeansDenoisingColored(
                crop, None, h=3, hColor=3, templateWindowSize=7, searchWindowSize=21,
            )
        except Exception as exc:
            print(f"[WARN] denoise failed: {exc}")

    sr_scale = 1.0
    if sr_engine is not None:
        try:
            up = sr_engine.upsample(crop)
            if up is not None and up.shape[0] > 0:
                sr_scale = float(up.shape[0]) / float(max(1, crop.shape[0]))
                crop = up
        except Exception as exc:
            print(f"[WARN] SR upsample failed: {exc}")

    ch, cw = crop.shape[:2]
    side = max(ch, cw)
    canvas = np.zeros((side, side, 3), dtype=crop.dtype)
    pad_x = (side - cw) // 2
    pad_y = (side - ch) // 2
    canvas[pad_y : pad_y + ch, pad_x : pad_x + cw] = crop
    flag = cv2.INTER_LANCZOS4 if interp == "lanczos" else cv2.INTER_CUBIC
    fed = cv2.resize(canvas, (int(target), int(target)), interpolation=flag)
    geom = {
        "scale_to_canvas": float(side) / float(target),
        "pad_x": int(pad_x),
        "pad_y": int(pad_y),
        "sr_scale": float(sr_scale),
        "cx1": int(cx1),
        "cy1": int(cy1),
        "cx2": int(cx2),
        "cy2": int(cy2),
        "interp": interp,
        "denoise": bool(denoise),
        "target": int(target),
    }
    return fed, geom


def _decode_yolo_boxes_geom(
    res,
    *,
    drop_mask: np.ndarray,
    silhouette_drop_threshold: float,
    suppress_active: bool,
    geom: dict[str, Any],
    conf_floor: float,
    extra_record_keys: dict[str, Any],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Like ``_decode_yolo_boxes`` but driven by the TTA geom dict (supports
    SR scaling)."""
    s = float(geom["scale_to_canvas"])
    px = int(geom["pad_x"])
    py = int(geom["pad_y"])
    sr = float(geom.get("sr_scale") or 1.0) or 1.0
    cx1 = int(geom["cx1"])
    cy1 = int(geom["cy1"])
    names = getattr(res, "names", {}) or {}
    kept: list[dict[str, Any]] = []
    dropped: list[dict[str, Any]] = []
    for box in res.boxes or []:
        c = float(box.conf[0])
        if c < conf_floor:
            continue
        cls_id = int(box.cls[0])
        label = str(names.get(cls_id, f"class_{cls_id}")).strip().lower()
        cat = _zed._categorize_label(label)
        if cat is None:
            continue
        bx1, by1, bx2, by2 = (float(v) for v in box.xyxy[0].tolist())
        sil_overlap = _bbox_overlap_with_mask((bx1, by1, bx2, by2), drop_mask)
        ux1 = ((bx1 * s) - px) / sr + cx1
        uy1 = ((by1 * s) - py) / sr + cy1
        ux2 = ((bx2 * s) - px) / sr + cx1
        uy2 = ((by2 * s) - py) / sr + cy1
        rec = {
            "label": label,
            "confidence": round(c, 4),
            "category": cat,
            "xyxy": [ux1, uy1, ux2, uy2],
            "fed_xyxy": [bx1, by1, bx2, by2],
            "from_verify_pass": True,
            "silhouette_overlap": round(sil_overlap, 3),
            **extra_record_keys,
        }
        if suppress_active and sil_overlap >= silhouette_drop_threshold:
            dropped.append(rec)
        else:
            kept.append(rec)
    kept.sort(key=lambda d: float(d["confidence"]), reverse=True)
    return kept, dropped


def _frame_xyxy_to_fed(xyxy_frame: list[float], geom: dict[str, Any]) -> list[float]:
    """Inverse of the geom forward transform; used only for drawing the
    consensus box on the baseline fed image."""
    s = float(geom["scale_to_canvas"]) or 1.0
    px = int(geom["pad_x"])
    py = int(geom["pad_y"])
    sr = float(geom.get("sr_scale") or 1.0) or 1.0
    cx1 = int(geom["cx1"])
    cy1 = int(geom["cy1"])

    def ix(x: float) -> float:
        return ((float(x) - cx1) * sr + px) / s

    def iy(y: float) -> float:
        return ((float(y) - cy1) * sr + py) / s

    x1, y1, x2, y2 = xyxy_frame
    return [ix(x1), iy(y1), ix(x2), iy(y2)]


def _iou_xyxy(a: list[float], b: list[float]) -> float:
    ax1, ay1, ax2, ay2 = (float(v) for v in a)
    bx1, by1, bx2, by2 = (float(v) for v in b)
    ix1 = max(ax1, bx1)
    iy1 = max(ay1, by1)
    ix2 = min(ax2, bx2)
    iy2 = min(ay2, by2)
    iw = max(0.0, ix2 - ix1)
    ih = max(0.0, iy2 - iy1)
    inter = iw * ih
    if inter <= 0.0:
        return 0.0
    aa = max(0.0, ax2 - ax1) * max(0.0, ay2 - ay1)
    bb = max(0.0, bx2 - bx1) * max(0.0, by2 - by1)
    union = aa + bb - inter
    if union <= 0.0:
        return 0.0
    return float(inter / union)


def _consensus_dets(
    per_variant: list[tuple[str, list[dict[str, Any]]]],
    *,
    iou_thr: float,
    min_supporters: int,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Cluster all kept dets across variations by label + IoU. Returns
    (clusters_with_>=min_supporters, all_flat_supporting_dets).

    Each cluster is::

        {label, category, n_supporters, supporting_variations[],
         mean_confidence, max_confidence, score, xyxy (mean over members),
         via_low_conf_retry, members[]}
    """
    flat: list[dict[str, Any]] = []
    for var_name, dets in per_variant:
        for d in dets:
            d2 = dict(d)
            d2["_variation"] = var_name
            flat.append(d2)
    if not flat:
        return [], []
    flat.sort(key=lambda d: float(d.get("confidence") or 0.0), reverse=True)

    clusters: list[list[dict[str, Any]]] = []
    used = [False] * len(flat)
    for i, di in enumerate(flat):
        if used[i]:
            continue
        cl = [di]
        used[i] = True
        for j in range(i + 1, len(flat)):
            if used[j]:
                continue
            dj = flat[j]
            if dj.get("label") != di.get("label"):
                continue
            if (
                _iou_xyxy(
                    di.get("xyxy") or [0, 0, 0, 0],
                    dj.get("xyxy") or [0, 0, 0, 0],
                )
                >= iou_thr
            ):
                cl.append(dj)
                used[j] = True
        clusters.append(cl)

    out: list[dict[str, Any]] = []
    for cl in clusters:
        seen: set[str] = set()
        dedup: list[dict[str, Any]] = []
        for m in cl:
            v = str(m.get("_variation") or "")
            if v in seen:
                continue
            seen.add(v)
            dedup.append(m)
        n_supp = len(dedup)
        if n_supp < min_supporters:
            continue
        confs = [float(m.get("confidence") or 0.0) for m in dedup]
        mean_conf = float(sum(confs) / max(1, len(confs)))
        max_conf = float(max(confs)) if confs else 0.0
        xs1 = [float((m.get("xyxy") or [0, 0, 0, 0])[0]) for m in dedup]
        ys1 = [float((m.get("xyxy") or [0, 0, 0, 0])[1]) for m in dedup]
        xs2 = [float((m.get("xyxy") or [0, 0, 0, 0])[2]) for m in dedup]
        ys2 = [float((m.get("xyxy") or [0, 0, 0, 0])[3]) for m in dedup]
        any_main = any(not bool(m.get("from_low_conf_retry")) for m in dedup)
        out.append(
            {
                "label": dedup[0].get("label"),
                "category": dedup[0].get("category"),
                "n_supporters": n_supp,
                "supporting_variations": sorted(seen),
                "mean_confidence": round(mean_conf, 4),
                "max_confidence": round(max_conf, 4),
                "score": round(mean_conf * n_supp, 4),
                "xyxy": [
                    sum(xs1) / len(xs1),
                    sum(ys1) / len(ys1),
                    sum(xs2) / len(xs2),
                    sum(ys2) / len(ys2),
                ],
                "via_low_conf_retry": (not any_main),
                "members": dedup,
            }
        )
    out.sort(key=lambda c: float(c.get("score") or 0.0), reverse=True)
    return out, flat


def _yolo_on_hand_crop_tta(
    model,
    frame_bgr: np.ndarray,
    hand_bbox: tuple[float, float, float, float],
    *,
    crop_pad: float,
    target: int,
    interp: str,
    denoise: bool,
    sr_engine,
    conf: float,
    allowed_ids: list[int],
    silhouette_mode: str,
    silhouette_drop_threshold: float,
    retry_conf: float | None,
    retry_class_ids: list[int] | None,
    variations: list[str],
):
    """High-res TTA verifier. Builds one fed (denoise + Lanczos / SR), runs
    YOLO main + retry over each requested variation, and returns the per-
    variation records plus the baseline image used for annotation. Geometry
    is shared so all decoded boxes live in source-frame coordinates."""
    built = _build_fed_high_res(
        frame_bgr,
        hand_bbox,
        crop_pad=crop_pad,
        target=target,
        denoise=denoise,
        interp=interp,
        sr_engine=sr_engine,
    )
    if built is None:
        return None
    fed, geom = built

    baseline_enhanced = _apply_variant(fed, "baseline")
    fill_mask, drop_mask = _silhouette_masks(baseline_enhanced, silhouette_mode)
    suppress_active = silhouette_mode != "off" and int(drop_mask.sum()) > 0

    per_variation: list[dict[str, Any]] = []
    silhouette_drops: list[dict[str, Any]] = []
    variation_images: dict[str, np.ndarray] = {}
    baseline_image: np.ndarray | None = None

    for var_name in variations:
        try:
            v_img = _apply_variant(fed, var_name)
        except Exception as exc:
            print(f"[WARN] variation '{var_name}' failed: {exc}")
            v_img = fed.copy()
        if int(fill_mask.sum()) > 0:
            v_img = _suppress_silhouette(v_img, fill_mask)
        variation_images[var_name] = v_img
        if var_name == "baseline" or baseline_image is None:
            baseline_image = v_img

        if model is None or not allowed_ids:
            per_variation.append(
                {"name": var_name, "main_dets": [], "retry_dets": []}
            )
            continue

        main_kept: list[dict[str, Any]] = []
        try:
            res_main = model(
                v_img, verbose=False, conf=conf, classes=allowed_ids
            )[0]
        except Exception as exc:
            print(f"[WARN] YOLO main failed on variation '{var_name}': {exc}")
            res_main = None
        if res_main is not None:
            main_kept, main_drops = _decode_yolo_boxes_geom(
                res_main,
                drop_mask=drop_mask,
                silhouette_drop_threshold=silhouette_drop_threshold,
                suppress_active=suppress_active,
                geom=geom,
                conf_floor=conf,
                extra_record_keys={
                    "from_low_conf_retry": False,
                    "variation": var_name,
                },
            )
            silhouette_drops.extend(main_drops)

        retry_kept: list[dict[str, Any]] = []
        if (
            not main_kept
            and retry_conf is not None
            and retry_class_ids
        ):
            try:
                res_retry = model(
                    v_img,
                    verbose=False,
                    conf=retry_conf,
                    classes=retry_class_ids,
                )[0]
            except Exception as exc:
                print(
                    f"[WARN] YOLO retry failed on variation '{var_name}': {exc}"
                )
                res_retry = None
            if res_retry is not None:
                retry_kept, retry_drops = _decode_yolo_boxes_geom(
                    res_retry,
                    drop_mask=drop_mask,
                    silhouette_drop_threshold=silhouette_drop_threshold,
                    suppress_active=suppress_active,
                    geom=geom,
                    conf_floor=retry_conf,
                    extra_record_keys={
                        "from_low_conf_retry": True,
                        "variation": var_name,
                    },
                )
                silhouette_drops.extend(retry_drops)

        per_variation.append(
            {"name": var_name, "main_dets": main_kept, "retry_dets": retry_kept}
        )

    if baseline_image is None:
        baseline_image = fed.copy()

    return {
        "geom": geom,
        "fed": fed,
        "baseline_image": baseline_image,
        "variation_images": variation_images,
        "fill_mask": fill_mask,
        "drop_mask": drop_mask,
        "silhouette_mode": silhouette_mode,
        "suppress_active": suppress_active,
        "per_variation": per_variation,
        "silhouette_drops": silhouette_drops,
    }


def _ratio_filter_dets(
    items: list[dict[str, Any]],
    *,
    hand_area: float,
    max_ratio: float,
) -> list[dict[str, Any]]:
    if not items or hand_area <= 0:
        return list(items)
    out: list[dict[str, Any]] = []
    for d in items:
        bx = d.get("xyxy") or [0, 0, 0, 0]
        bw = max(0.0, float(bx[2]) - float(bx[0]))
        bh = max(0.0, float(bx[3]) - float(bx[1]))
        ratio = (bw * bh) / max(1.0, hand_area)
        if ratio > max_ratio:
            continue
        out.append(d)
    return out


def _build_variation_strip(
    variation_images: dict[str, np.ndarray],
    per_variation: list[dict[str, Any]],
    *,
    cell_h: int = 160,
) -> np.ndarray | None:
    if not variation_images:
        return None
    n = len(variation_images)
    cell_w = cell_h
    strip = np.zeros((cell_h, cell_w * n, 3), dtype=np.uint8)
    rec_by_name = {r["name"]: r for r in per_variation}
    for i, (name, img) in enumerate(variation_images.items()):
        thumb = cv2.resize(img, (cell_w, cell_h), interpolation=cv2.INTER_AREA)
        strip[:, i * cell_w : (i + 1) * cell_w] = thumb
        rec = rec_by_name.get(name)
        n_main = len(rec.get("main_dets", [])) if rec else 0
        n_retry = len(rec.get("retry_dets", [])) if rec else 0
        cv2.rectangle(
            strip, (i * cell_w, 0), ((i + 1) * cell_w - 1, cell_h - 1),
            (40, 40, 40), 1,
        )
        cv2.putText(
            strip, name, (i * cell_w + 4, 14),
            cv2.FONT_HERSHEY_SIMPLEX, 0.42, (240, 240, 240), 1, cv2.LINE_AA,
        )
        cv2.putText(
            strip, f"m={n_main} r={n_retry}",
            (i * cell_w + 4, cell_h - 6),
            cv2.FONT_HERSHEY_SIMPLEX, 0.42, (200, 200, 200), 1, cv2.LINE_AA,
        )
    return strip


def _yolo_on_hand_crop_enhanced(
    model,
    frame_bgr: np.ndarray,
    hand_bbox: tuple[float, float, float, float],
    *,
    crop_pad: float,
    target: int,
    conf: float,
    allowed_ids: list[int],
    enhance: bool,
    clahe_clip: float,
    sharpen: bool,
    gamma: float | None,
    silhouette_mode: str,
    silhouette_drop_threshold: float,
    retry_conf: float | None,
    retry_class_ids: list[int] | None,
):
    """Verification-pass detector with optional silhouette masking and a
    low-conf retry sweep. Returns
    (main_dets, retry_dets, silhouette_drops, crop_full, fed_annot).
    main_dets has priority; retry_dets are only meaningful when main_dets
    is empty."""
    fh, fw = frame_bgr.shape[:2]
    cx1, cy1, cx2, cy2 = _zed._expand_pad(
        hand_bbox, pad=crop_pad, frame_w=fw, frame_h=fh
    )
    if cx2 <= cx1 or cy2 <= cy1:
        return [], [], [], None, None
    crop = frame_bgr[cy1:cy2, cx1:cx2]
    if crop.size == 0:
        return [], [], [], None, None
    if enhance:
        crop = _enhance_bgr(crop, clahe_clip=clahe_clip, sharpen=sharpen, gamma=gamma)

    ch, cw = crop.shape[0], crop.shape[1]
    side = max(cw, ch)
    canvas = np.zeros((side, side, 3), dtype=crop.dtype)
    pad_x = (side - cw) // 2
    pad_y = (side - ch) // 2
    canvas[pad_y : pad_y + ch, pad_x : pad_x + cw] = crop
    fed = cv2.resize(canvas, (target, target), interpolation=cv2.INTER_CUBIC)

    fill_mask, drop_mask = _silhouette_masks(fed, silhouette_mode)
    suppress_active = silhouette_mode != "off" and int(drop_mask.sum()) > 0
    fed_for_yolo = (
        _suppress_silhouette(fed, fill_mask)
        if int(fill_mask.sum()) > 0
        else fed
    )

    if model is None or not allowed_ids:
        return [], [], [], (cx1, cy1, cx2, cy2), fed_for_yolo

    scale = side / float(target)
    decode_kwargs = dict(
        drop_mask=drop_mask,
        silhouette_drop_threshold=silhouette_drop_threshold,
        suppress_active=suppress_active,
        scale=scale,
        pad_x=pad_x,
        pad_y=pad_y,
        cx1=cx1,
        cy1=cy1,
    )

    main_dets: list[dict[str, Any]] = []
    silhouette_drops: list[dict[str, Any]] = []
    try:
        res = model(fed_for_yolo, verbose=False, conf=conf, classes=allowed_ids)[0]
    except Exception as exc:
        print(f"[WARN] YOLO verify inference failed on hand crop: {exc}")
        res = None
    if res is not None:
        main_dets, silhouette_drops = _decode_yolo_boxes(
            res,
            conf_floor=conf,
            extra_record_keys={"from_low_conf_retry": False},
            **decode_kwargs,
        )

    retry_dets: list[dict[str, Any]] = []
    if (
        not main_dets
        and retry_conf is not None
        and retry_class_ids
    ):
        try:
            res2 = model(
                fed_for_yolo,
                verbose=False,
                conf=retry_conf,
                classes=retry_class_ids,
            )[0]
        except Exception as exc:
            print(f"[WARN] YOLO retry inference failed on hand crop: {exc}")
            res2 = None
        if res2 is not None:
            retry_kept, retry_drops = _decode_yolo_boxes(
                res2,
                conf_floor=retry_conf,
                extra_record_keys={"from_low_conf_retry": True},
                **decode_kwargs,
            )
            retry_dets = retry_kept
            silhouette_drops.extend(retry_drops)

    fed_annot = fed_for_yolo.copy()
    _draw_dets(fed_annot, main_dets, color=(80, 180, 255), prefix="v:")
    _draw_dets(fed_annot, retry_dets, color=(255, 220, 80), prefix="r:")
    _draw_dets(fed_annot, silhouette_drops, color=(60, 60, 200), prefix="DROP:")
    return main_dets, retry_dets, silhouette_drops, (cx1, cy1, cx2, cy2), fed_annot


def _pass1_top_label(hand: dict[str, Any]) -> str | None:
    oih = hand.get("object_in_hand")
    if isinstance(oih, dict) and oih.get("label"):
        return str(oih["label"]).strip().lower()
    objs = hand.get("objects") or []
    if objs and isinstance(objs[0], dict) and objs[0].get("label"):
        return str(objs[0]["label"]).strip().lower()
    return None


def _should_verify_hand(
    hand: dict[str, Any],
    *,
    only_candidates: bool,
    min_pass1_conf: float,
) -> bool:
    if hand.get("skip_reason"):
        return False
    if not only_candidates:
        return True
    oih = hand.get("object_in_hand")
    if isinstance(oih, dict):
        try:
            if float(oih.get("confidence") or 0.0) >= min_pass1_conf:
                return True
        except Exception:
            return True
    objs = hand.get("objects") or []
    return len(objs) > 0


def _frame_matches_filter(sample_name: str, filters: list[str]) -> bool:
    """``filters`` may be exact filenames ('frame_000018.png'), stems
    ('frame_000018'), or numeric tokens ('18', '000018'). Empty list = all."""
    if not filters:
        return True
    name = sample_name.strip().lower()
    stem = Path(name).stem
    digits = "".join(c for c in stem if c.isdigit()).lstrip("0") or "0"
    for f in filters:
        f_low = f.strip().lower()
        if not f_low:
            continue
        if f_low in (name, stem):
            return True
        f_digits = "".join(c for c in f_low if c.isdigit()).lstrip("0") or "0"
        if f_digits and f_digits == digits:
            return True
    return False


def verify_run(
    run_dir: Path,
    *,
    video_path: Path,
    weights: Path,
    classes: list[str],
    conf: float,
    target: int,
    crop_pad: float,
    save_annotated: bool,
    min_hand_area_px: int,
    edge_margin_px: int,
    max_obj_to_hand_ratio: float,
    only_candidates: bool,
    min_pass1_conf: float,
    enhance: bool,
    clahe_clip: float,
    sharpen: bool,
    gamma: float | None,
    silhouette_mode: str,
    silhouette_drop_threshold: float,
    frame_filters: list[str],
    retry_low_conf: bool,
    retry_conf: float,
    retry_classes: list[str],
    tta: bool = True,
    upscale_target: int = 1536,
    upscale_interp: str = "lanczos",
    upscale_denoise: bool = True,
    sr_weights: Path | None = None,
    variations: list[str] | None = None,
    consensus_iou: float = 0.5,
    min_supporters: int = 2,
    save_all_variations: bool = False,
) -> int:
    ev_path = run_dir / "zoom_evidence" / "evidence.json"
    if not ev_path.is_file():
        print(f"[ERROR] evidence.json not found at {ev_path}.")
        print("Run first: python ai/models/SCVAM2.1/zoom_evidence.py")
        return 1
    if not video_path.is_file():
        print(f"[ERROR] source video not found: {video_path}")
        return 1

    try:
        evidence = json.loads(ev_path.read_text(encoding="utf-8"))
    except Exception as exc:
        print(f"[ERROR] could not parse {ev_path}: {exc}")
        return 1

    frames = evidence.get("frames") or []
    if not frames:
        print("[INFO] evidence.json has no frames.")
        return 0

    yolo = _zed._load_yolo(weights)
    if yolo is None:
        return 1
    allowed_ids, allowed_names, unsupported = _zed._resolve_class_ids(yolo, classes)
    if unsupported:
        print(f"[WARN] Unknown class names ignored: {', '.join(unsupported)}")
    if not allowed_ids:
        print("[ERROR] No requested classes match this YOLO model. Aborting.")
        return 1

    retry_class_ids: list[int] = []
    retry_names: list[str] = []
    if retry_low_conf and retry_classes:
        retry_class_ids, retry_names, retry_unsupp = _zed._resolve_class_ids(
            yolo, retry_classes
        )
        if retry_unsupp:
            print(f"[WARN] Unknown retry class names ignored: {', '.join(retry_unsupp)}")
        if not retry_class_ids:
            print(
                "[WARN] No retry classes match this YOLO model. Disabling low-conf retry."
            )
            retry_low_conf = False

    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        print(f"[ERROR] could not open video: {video_path}")
        return 1
    video_is_webm = video_path.suffix.lower() == ".webm"

    out_dir = run_dir / "zoom_evidence_verify"
    out_dir.mkdir(parents=True, exist_ok=True)

    if variations is None or not variations:
        variations = list(_VARIATIONS_BUILTIN)
    sr_engine = _load_sr_engine(sr_weights) if (tta and sr_weights) else None
    effective_target = max(320, int(upscale_target if tta else target))

    retry_descr = (
        f"on (conf>={retry_conf:.2f}, classes={retry_names})"
        if retry_low_conf
        else "off"
    )
    if tta:
        mode_descr = (
            f"TTA  variations={variations}  consensus_iou={consensus_iou:.2f}  "
            f"min_supporters={min_supporters}"
        )
    else:
        mode_descr = "single-pass (legacy)"
    print(
        f"Step 2c verification on {len(frames)} pick rows\n"
        f"  weights:           {weights}\n"
        f"  classes:           {allowed_names}  (conf>={conf})\n"
        f"  target:            {effective_target}x{effective_target}\n"
        f"  mode:              {mode_descr}\n"
        f"  upscale:           interp={upscale_interp}  denoise={upscale_denoise}  "
        f"sr={'on' if sr_engine is not None else 'off'}\n"
        f"  legacy enhance:    {enhance}  clahe={clahe_clip} sharpen={sharpen} gamma={gamma}\n"
        f"  only_candidates:   {only_candidates}  min_pass1_conf={min_pass1_conf}\n"
        f"  silhouette_mode:   {silhouette_mode}  "
        f"drop_overlap>={silhouette_drop_threshold:.2f}\n"
        f"  retry_low_conf:    {retry_descr}\n"
        f"  frame_filters:     {frame_filters or '(all)'}\n"
        f"  evidence:          {ev_path}\n"
        f"  out_dir:           {out_dir}"
    )

    out_frames: list[dict[str, Any]] = []
    n_picks_filtered = 0
    n_verify_hands = 0
    n_match = 0
    n_replaced = 0
    n_cleared = 0
    n_new = 0
    n_recovered = 0
    n_silhouette_drops = 0
    n_consensus = 0
    n_single_var = 0

    for i, pick in enumerate(frames, start=1):
        sample_name = str(pick.get("sample_frame", ""))
        src_idx = int(pick.get("source_frame_index") or 0)
        src_ts = float(pick.get("source_ts_sec") or (src_idx / 30.0))
        hands = pick.get("hands") or []

        if frame_filters and not _frame_matches_filter(sample_name, frame_filters):
            n_picks_filtered += 1
            continue

        frame = None
        if video_is_webm:
            # WebM seeking is unreliable in some OpenCV builds on Windows.
            # Use the already-saved Step-2 annotated source frame instead.
            out_name = pick.get("output")
            if isinstance(out_name, str) and out_name:
                ev_frame_path = run_dir / "zoom_evidence" / out_name
                if ev_frame_path.is_file():
                    frame = cv2.imread(str(ev_frame_path))

        if frame is None:
            cap.set(cv2.CAP_PROP_POS_FRAMES, src_idx)
            ok, frame = cap.read()
            if not ok or frame is None:
                print(f"[WARN] could not read src#{src_idx} for {sample_name}")
                continue

        per_hand: list[dict[str, Any]] = []
        fh, fw = frame.shape[:2]

        for hand in hands:
            side = str(hand.get("side") or "?")
            hbb = hand.get("bbox") or []
            pass1_label = _pass1_top_label(hand)

            if len(hbb) != 4:
                hand["held_verify"] = {
                    "skipped": True,
                    "reason": "bad_bbox",
                }
                per_hand.append({"side": side, "held_verify": hand["held_verify"]})
                continue

            x1, y1, x2, y2 = (float(hbb[0]), float(hbb[1]), float(hbb[2]), float(hbb[3]))
            hand_w = max(0.0, x2 - x1)
            hand_h = max(0.0, y2 - y1)
            hand_area = hand_w * hand_h

            if hand_area < float(min_hand_area_px) or (
                x1 <= edge_margin_px
                or y1 <= edge_margin_px
                or x2 >= fw - edge_margin_px
                or y2 >= fh - edge_margin_px
            ):
                hand["held_verify"] = {"skipped": True, "reason": "gated_like_2b"}
                per_hand.append({"side": side, "held_verify": hand["held_verify"]})
                continue

            if not _should_verify_hand(
                hand,
                only_candidates=only_candidates,
                min_pass1_conf=min_pass1_conf,
            ):
                hand.setdefault(
                    "held_verify",
                    {"skipped": True, "reason": "not_a_candidate"},
                )
                per_hand.append({"side": side, "held_verify": hand["held_verify"]})
                continue

            n_verify_hands += 1

            stem = Path(sample_name).stem if sample_name else f"s{i:06d}"
            pick_tag = pick.get("output", "")
            rank_tag = ""
            if isinstance(pick_tag, str) and "_pick" in pick_tag:
                rank_tag = pick_tag.split("_pick", 1)[1].split("_", 1)[0]
            rank_tag = f"_pick{rank_tag}" if rank_tag else ""
            base_out_name = f"{stem}{rank_tag}_src{src_idx:06d}_{side.lower()}"

            chosen_dets: list[dict[str, Any]] = []
            via_retry = False
            agreement: str = "both_empty"
            saved_path: str | None = None
            extra_record: dict[str, Any] = {}
            pass1_oih = hand.get("object_in_hand") if isinstance(hand.get("object_in_hand"), dict) else None

            if tta:
                tta_res = _yolo_on_hand_crop_tta(
                    yolo,
                    frame,
                    (x1, y1, x2, y2),
                    crop_pad=crop_pad,
                    target=effective_target,
                    interp=upscale_interp,
                    denoise=upscale_denoise,
                    sr_engine=sr_engine,
                    conf=conf,
                    allowed_ids=allowed_ids,
                    silhouette_mode=silhouette_mode,
                    silhouette_drop_threshold=silhouette_drop_threshold,
                    retry_conf=retry_conf if retry_low_conf else None,
                    retry_class_ids=retry_class_ids if retry_low_conf else None,
                    variations=list(variations),
                )
                if tta_res is None:
                    hand["held_verify"] = {"skipped": True, "reason": "empty_crop"}
                    per_hand.append(
                        {"side": side, "held_verify": hand["held_verify"]}
                    )
                    continue

                sil_drops = tta_res["silhouette_drops"]
                n_silhouette_drops += len(sil_drops)
                geom = tta_res["geom"]
                crop_full = (
                    int(geom["cx1"]),
                    int(geom["cy1"]),
                    int(geom["cx2"]),
                    int(geom["cy2"]),
                )

                for v in tta_res["per_variation"]:
                    v["main_dets"] = _ratio_filter_dets(
                        v["main_dets"],
                        hand_area=hand_area,
                        max_ratio=max_obj_to_hand_ratio,
                    )
                    v["retry_dets"] = _ratio_filter_dets(
                        v["retry_dets"],
                        hand_area=hand_area,
                        max_ratio=max_obj_to_hand_ratio,
                    )

                per_variant_for_consensus: list[
                    tuple[str, list[dict[str, Any]]]
                ] = []
                for v in tta_res["per_variation"]:
                    per_variant_for_consensus.append(
                        (v["name"], list(v["main_dets"]) + list(v["retry_dets"]))
                    )
                consensus_clusters, all_flat = _consensus_dets(
                    per_variant_for_consensus,
                    iou_thr=consensus_iou,
                    min_supporters=min_supporters,
                )

                confidence_grade = "none"
                if consensus_clusters:
                    top = consensus_clusters[0]
                    via_retry = bool(top["via_low_conf_retry"])
                    confidence_grade = "confirmed"
                    chosen_dets = [
                        {
                            "label": top["label"],
                            "category": top["category"],
                            "confidence": float(top["max_confidence"]),
                            "mean_confidence": float(top["mean_confidence"]),
                            "consensus_score": float(top["score"]),
                            "n_supporters": int(top["n_supporters"]),
                            "supporting_variations": list(
                                top["supporting_variations"]
                            ),
                            "xyxy": list(top["xyxy"]),
                            "from_verify_pass": True,
                            "from_low_conf_retry": via_retry,
                            "confidence_grade": confidence_grade,
                        }
                    ]
                    if pass1_label is None:
                        agreement = "new_detection_consensus"
                        n_new += 1
                        n_consensus += 1
                    elif via_retry:
                        agreement = "low_conf_recovered_consensus"
                        n_recovered += 1
                        n_consensus += 1
                    elif top["label"] == pass1_label:
                        agreement = "consensus_match"
                        n_match += 1
                        n_consensus += 1
                    else:
                        agreement = "consensus_label_changed"
                        n_replaced += 1
                        n_consensus += 1
                elif all_flat:
                    agreement = "single_variation_only"
                    n_single_var += 1
                    top_flat = all_flat[0]
                    confidence_grade = "possible"
                    via_retry = bool(top_flat.get("from_low_conf_retry"))
                    raw_label = str(top_flat.get("label") or "object")
                    cat_value = top_flat.get("category")
                    display_label = (
                        "sharp object"
                        if cat_value == "sharp_object"
                        else raw_label
                    )
                    chosen_dets = [
                        {
                            "label": display_label,
                            "raw_label": raw_label,
                            "category": cat_value,
                            "confidence": float(top_flat.get("confidence") or 0.0),
                            "mean_confidence": float(
                                top_flat.get("confidence") or 0.0
                            ),
                            "consensus_score": float(
                                top_flat.get("confidence") or 0.0
                            ),
                            "n_supporters": 1,
                            "supporting_variations": [
                                str(
                                    top_flat.get("variation")
                                    or top_flat.get("_variation")
                                    or ""
                                )
                            ],
                            "xyxy": list(top_flat.get("xyxy") or [0, 0, 0, 0]),
                            "from_verify_pass": True,
                            "from_low_conf_retry": via_retry,
                            "confidence_grade": confidence_grade,
                        }
                    ]
                else:
                    if pass1_label is not None:
                        agreement = "cleared_false_positive"
                        n_cleared += 1
                    else:
                        agreement = "both_empty"

                if chosen_dets:
                    top = chosen_dets[0]
                    hand["object_in_hand"] = {
                        "label": top["label"],
                        "raw_label": top.get("raw_label", top["label"]),
                        "confidence": float(top["confidence"]),
                        "category": top["category"],
                        "xyxy": top["xyxy"],
                        "from_verify_pass": True,
                        "from_low_conf_retry": via_retry,
                        "consensus_score": top["consensus_score"],
                        "n_supporters": top["n_supporters"],
                        "supporting_variations": top["supporting_variations"],
                        "confidence_grade": confidence_grade,
                    }
                    hand["category"] = top["category"]
                    hand["objects"] = chosen_dets
                else:
                    # If Step 2b found something at very low confidence, and
                    # the verifier didn't confirm it, keep the pass-1 result
                    # rather than clearing (avoid wiping weak-but-real signals
                    # like tiny phones/tools).
                    keep_pass1 = False
                    if isinstance(pass1_oih, dict):
                        try:
                            keep_pass1 = float(pass1_oih.get("confidence") or 0.0) < float(conf)
                        except Exception:
                            keep_pass1 = True
                    if keep_pass1:
                        agreement = "kept_low_conf_pass1"
                    else:
                        hand["object_in_hand"] = None
                        hand["category"] = None
                        hand["objects"] = []

                pass2_label = chosen_dets[0]["label"] if chosen_dets else None
                hand["held_verify"] = {
                    "pass1_top_label": pass1_label,
                    "pass2_top_label": pass2_label,
                    "agreement": agreement,
                    "confidence_grade": confidence_grade,
                    "via_low_conf_retry": via_retry,
                    "tta": True,
                    "variations": list(variations),
                    "consensus_iou": consensus_iou,
                    "min_supporters": min_supporters,
                    "n_consensus_clusters": len(consensus_clusters),
                    "n_kept_dets_total": len(all_flat),
                    "weights": weights.as_posix(),
                    "verify_classes": allowed_names,
                    "silhouette_mode": silhouette_mode,
                    "silhouette_drops": sil_drops,
                    "retry_low_conf": retry_low_conf,
                    "retry_classes": retry_names if retry_low_conf else [],
                    "retry_conf": retry_conf if retry_low_conf else None,
                    "upscale_target": effective_target,
                    "upscale_interp": upscale_interp,
                    "upscale_denoise": upscale_denoise,
                    "sr_used": sr_engine is not None,
                }

                if save_annotated:
                    base_img = tta_res["baseline_image"]
                    annot = base_img.copy()
                    is_possible = confidence_grade == "possible"
                    box_colour = (
                        (60, 200, 240) if is_possible else (0, 220, 80)
                    )
                    for d in chosen_dets:
                        fed_xy = _frame_xyxy_to_fed(d["xyxy"], geom)
                        bx1, by1, bx2, by2 = (
                            int(round(float(v))) for v in fed_xy
                        )
                        cv2.rectangle(
                            annot, (bx1, by1), (bx2, by2), box_colour, 3
                        )
                        prefix = "p:" if is_possible else "c:"
                        cap_text = (
                            f"{prefix}{d['label']} {d['confidence']:.2f}"
                            f"  x{d['n_supporters']}"
                        )
                        cv2.putText(
                            annot, cap_text, (bx1, max(18, by1 - 8)),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.6,
                            box_colour, 2, cv2.LINE_AA,
                        )
                    for d in tta_res["silhouette_drops"][:8]:
                        bx = d.get("fed_xyxy") or [0, 0, 0, 0]
                        bx1, by1, bx2, by2 = (
                            int(round(float(v))) for v in bx
                        )
                        cv2.rectangle(
                            annot, (bx1, by1), (bx2, by2), (60, 60, 200), 1
                        )
                    if not chosen_dets:
                        msg = (
                            "verify TTA: no object across variations"
                            + (
                                " (silhouette-masked)"
                                if silhouette_mode != "off"
                                else ""
                            )
                        )
                        cv2.putText(
                            annot, msg, (8, annot.shape[0] - 12),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.45,
                            (40, 220, 40), 1, cv2.LINE_AA,
                        )
                    elif is_possible:
                        cv2.putText(
                            annot,
                            f"TTA possible {chosen_dets[0]['label']} "
                            f"(1 of {len(variations)} variations)",
                            (8, annot.shape[0] - 12),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.45,
                            box_colour, 1, cv2.LINE_AA,
                        )
                    elif via_retry:
                        cv2.putText(
                            annot,
                            f"TTA low-conf retry consensus: {chosen_dets[0]['label']}",
                            (8, annot.shape[0] - 12),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.45,
                            (255, 220, 80), 1, cv2.LINE_AA,
                        )
                    strip = _build_variation_strip(
                        tta_res["variation_images"],
                        tta_res["per_variation"],
                        cell_h=160,
                    )
                    if strip is not None:
                        comp_w = max(annot.shape[1], strip.shape[1])
                        comp_h = annot.shape[0] + strip.shape[0]
                        comp = np.zeros((comp_h, comp_w, 3), dtype=np.uint8)
                        comp[: annot.shape[0], : annot.shape[1]] = annot
                        comp[annot.shape[0] :, : strip.shape[1]] = strip
                        img_out = comp
                    else:
                        img_out = annot
                    out_name = f"{base_out_name}_verify.png"
                    cv2.imwrite(str(out_dir / out_name), img_out)
                    saved_path = out_name

                    if save_all_variations:
                        for v_name, v_img in tta_res["variation_images"].items():
                            v_annot = v_img.copy()
                            v_rec = next(
                                (
                                    r
                                    for r in tta_res["per_variation"]
                                    if r["name"] == v_name
                                ),
                                None,
                            )
                            if v_rec is not None:
                                _draw_dets(
                                    v_annot,
                                    v_rec.get("main_dets", []),
                                    color=(80, 180, 255),
                                    prefix=f"v[{v_name}]:",
                                )
                                _draw_dets(
                                    v_annot,
                                    v_rec.get("retry_dets", []),
                                    color=(255, 220, 80),
                                    prefix=f"r[{v_name}]:",
                                )
                            v_path = (
                                out_dir
                                / f"{base_out_name}_var-{v_name}.png"
                            )
                            cv2.imwrite(str(v_path), v_annot)

                extra_record = {
                    "variations": tta_res["per_variation"],
                    "consensus_dets": consensus_clusters,
                    "kept_dets_flat": all_flat,
                    "crop_geom": geom,
                }
            else:
                # legacy single-pass path
                (
                    main_dets,
                    retry_dets,
                    sil_drops,
                    crop_full,
                    fed_annot,
                ) = _yolo_on_hand_crop_enhanced(
                    yolo,
                    frame,
                    (x1, y1, x2, y2),
                    crop_pad=crop_pad,
                    target=target,
                    conf=conf,
                    allowed_ids=allowed_ids,
                    enhance=enhance,
                    clahe_clip=clahe_clip,
                    sharpen=sharpen,
                    gamma=gamma,
                    silhouette_mode=silhouette_mode,
                    silhouette_drop_threshold=silhouette_drop_threshold,
                    retry_conf=retry_conf if retry_low_conf else None,
                    retry_class_ids=retry_class_ids if retry_low_conf else None,
                )
                n_silhouette_drops += len(sil_drops)
                main_dets = _ratio_filter_dets(
                    main_dets,
                    hand_area=hand_area,
                    max_ratio=max_obj_to_hand_ratio,
                )
                retry_dets = _ratio_filter_dets(
                    retry_dets,
                    hand_area=hand_area,
                    max_ratio=max_obj_to_hand_ratio,
                )
                if main_dets:
                    chosen_dets = main_dets
                elif retry_dets:
                    chosen_dets = retry_dets
                    via_retry = True

                pass1_oih = hand.get("object_in_hand") if isinstance(hand.get("object_in_hand"), dict) else None
                pass2_label = chosen_dets[0]["label"] if chosen_dets else None
                confidence_grade = "none"
                if chosen_dets:
                    if via_retry:
                        agreement = "low_conf_recovered"
                        n_recovered += 1
                        confidence_grade = "possible"
                    elif pass1_label is None:
                        agreement = "new_detection"
                        n_new += 1
                        confidence_grade = "confirmed"
                    elif pass2_label == pass1_label:
                        agreement = "match"
                        n_match += 1
                        confidence_grade = "confirmed"
                    else:
                        agreement = "label_changed"
                        n_replaced += 1
                        confidence_grade = "confirmed"
                    top = chosen_dets[0]
                    raw_label = str(top.get("label") or "object")
                    cat_value = top.get("category")
                    if confidence_grade == "possible" and cat_value == "sharp_object":
                        display_label = "sharp object"
                    else:
                        display_label = raw_label
                    top["confidence_grade"] = confidence_grade
                    hand["object_in_hand"] = {
                        "label": display_label,
                        "raw_label": raw_label,
                        "confidence": float(top["confidence"]),
                        "category": cat_value,
                        "xyxy": top["xyxy"],
                        "from_verify_pass": True,
                        "from_low_conf_retry": via_retry,
                        "confidence_grade": confidence_grade,
                    }
                    hand["category"] = cat_value
                    hand["objects"] = chosen_dets
                else:
                    if pass1_label is not None:
                        keep_pass1 = False
                        if isinstance(pass1_oih, dict):
                            try:
                                keep_pass1 = float(pass1_oih.get("confidence") or 0.0) < float(conf)
                            except Exception:
                                keep_pass1 = True
                        if keep_pass1:
                            agreement = "kept_low_conf_pass1"
                        else:
                            agreement = "cleared_false_positive"
                            n_cleared += 1
                    else:
                        agreement = "both_empty"
                    if agreement != "kept_low_conf_pass1":
                        hand["object_in_hand"] = None
                        hand["category"] = None
                        hand["objects"] = []

                hand["held_verify"] = {
                    "pass1_top_label": pass1_label,
                    "pass2_top_label": pass2_label,
                    "agreement": agreement,
                    "confidence_grade": confidence_grade,
                    "via_low_conf_retry": via_retry,
                    "tta": False,
                    "enhanced": enhance,
                    "weights": weights.as_posix(),
                    "verify_classes": allowed_names,
                    "silhouette_mode": silhouette_mode,
                    "silhouette_drops": sil_drops,
                    "retry_low_conf": retry_low_conf,
                    "retry_classes": retry_names if retry_low_conf else [],
                    "retry_conf": retry_conf if retry_low_conf else None,
                }

                if save_annotated and fed_annot is not None:
                    out_name = f"{base_out_name}_verify.png"
                    img_out = fed_annot.copy()
                    if not chosen_dets:
                        msg = (
                            "verify: no object above conf"
                            + (
                                " (silhouette-masked)"
                                if silhouette_mode != "off"
                                else ""
                            )
                        )
                        cv2.putText(
                            img_out, msg,
                            (8, img_out.shape[0] - 12),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.45,
                            (40, 220, 40), 1, cv2.LINE_AA,
                        )
                    elif via_retry:
                        cv2.putText(
                            img_out,
                            f"verify: low-conf retry recovered {chosen_dets[0]['label']}",
                            (8, img_out.shape[0] - 12),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.45,
                            (255, 220, 80), 1, cv2.LINE_AA,
                        )
                    cv2.imwrite(str(out_dir / out_name), img_out)
                    saved_path = out_name

                extra_record = {
                    "main_dets": main_dets,
                    "retry_dets": retry_dets,
                }

            per_hand_record: dict[str, Any] = {
                "side": side,
                "bbox": list(hbb),
                "crop_bbox_full_frame": list(crop_full)
                if crop_full is not None
                else None,
                "objects": chosen_dets,
                "object_in_hand": hand["object_in_hand"],
                "category": hand["category"],
                "annotated_crop_verify": saved_path,
                "held_verify": hand["held_verify"],
            }
            per_hand_record.update(extra_record)
            per_hand.append(per_hand_record)

        all_dets_for_pick: list[dict[str, Any]] = []
        held_categories: list[str] = []
        for hand in hands:
            for d in hand.get("objects") or []:
                all_dets_for_pick.append(d)
            cat = hand.get("category")
            if cat and cat not in held_categories:
                held_categories.append(cat)

        pick["held_objects_from_hand_zoom"] = all_dets_for_pick
        pick["held_categories"] = held_categories

        out_frames.append(
            {
                "sample_frame": sample_name,
                "source_frame_index": src_idx,
                "source_ts_sec": src_ts,
                "hands": per_hand,
                "held_categories": held_categories,
            }
        )

    cap.release()

    payload = {
        "run_dir": run_dir.as_posix(),
        "video": video_path.as_posix(),
        "weights": weights.as_posix(),
        "target_size": effective_target if tta else target,
        "legacy_target_size": target,
        "obj_conf": conf,
        "crop_pad": crop_pad,
        "classes": allowed_names,
        "enhance": enhance,
        "only_candidates": only_candidates,
        "silhouette_mode": silhouette_mode,
        "silhouette_drop_threshold": silhouette_drop_threshold,
        "retry_low_conf": retry_low_conf,
        "retry_conf": retry_conf if retry_low_conf else None,
        "retry_classes": retry_names if retry_low_conf else [],
        "frame_filters": frame_filters,
        "tta": bool(tta),
        "tta_settings": {
            "variations": list(variations) if tta else [],
            "consensus_iou": consensus_iou,
            "min_supporters": min_supporters,
            "upscale_target": effective_target,
            "upscale_interp": upscale_interp,
            "upscale_denoise": upscale_denoise,
            "sr_used": sr_engine is not None,
            "sr_weights": (
                str(sr_weights) if (tta and sr_weights) else None
            ),
            "save_all_variations": bool(save_all_variations),
        },
        "n_pick_rows_emitted": len(out_frames),
        "n_picks_filtered_out": n_picks_filtered,
        "n_hands_verified": n_verify_hands,
        "n_silhouette_drops": n_silhouette_drops,
        "agreement_counts": {
            "match": n_match,
            "label_changed": n_replaced,
            "cleared_false_positive": n_cleared,
            "new_detection": n_new,
            "low_conf_recovered": n_recovered,
            "consensus": n_consensus,
            "single_variation_only": n_single_var,
        },
        "frames": out_frames,
    }
    (out_dir / "verify.json").write_text(
        json.dumps(payload, indent=2),
        encoding="utf-8",
    )

    ev_path.write_text(json.dumps(evidence, indent=2), encoding="utf-8")

    if tta:
        print(
            f"\nDone. Verified {n_verify_hands} hand crop(s).  "
            f"filtered_out={n_picks_filtered}  "
            f"silhouette_drops={n_silhouette_drops}\n"
            f"  TTA: consensus={n_consensus}  "
            f"single_var_only={n_single_var}  "
            f"cleared_fp={n_cleared}  both_empty="
            f"{n_verify_hands - n_consensus - n_single_var - n_cleared}\n"
            f"  among consensus: match={n_match}  "
            f"label_changed={n_replaced}  new={n_new}  "
            f"low_conf_recovered={n_recovered}"
        )
    else:
        print(
            f"\nDone. Verified {n_verify_hands} hand crop(s).  "
            f"filtered_out={n_picks_filtered}  silhouette_drops={n_silhouette_drops}\n"
            f"  agreement: match={n_match}  label_changed={n_replaced}  "
            f"cleared_fp={n_cleared}  new={n_new}  "
            f"low_conf_recovered={n_recovered}"
        )
    print(f"Verify JSON:   {out_dir / 'verify.json'}")
    print(f"Patched:       {ev_path}")
    return 0


def _parse_classes(raw: str) -> list[str]:
    return [c.strip() for c in raw.split(",") if c.strip()]


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Step 2c: enhance hand crops + second YOLO pass to verify held objects."
    )
    parser.add_argument(
        "--run",
        default="",
        help="Run dir (default: newest under output with zoom_evidence/evidence.json).",
    )
    parser.add_argument(
        "--video",
        default="",
        help="Source video path (default: SELECTED_VIDEO.txt).",
    )
    parser.add_argument(
        "--weights",
        default=str(DEFAULT_WEIGHTS),
        help="YOLO weights (default: yolov8s). Falls back to ultralytics cache "
        "if file missing.",
    )
    parser.add_argument(
        "--classes",
        default="",
        help="Comma-separated COCO names (default: expanded verify set incl. drinks + bat + umbrella).",
    )
    parser.add_argument(
        "--conf",
        type=float,
        default=0.12,
        help="Min YOLO confidence on verify pass (default 0.12, slightly stricter than 2b).",
    )
    parser.add_argument(
        "--target",
        type=int,
        default=960,
        help="Square upscale size (default 960).",
    )
    parser.add_argument(
        "--crop-pad",
        type=float,
        default=0.28,
        help="Padding fraction around hand bbox before crop (default 0.28).",
    )
    parser.add_argument(
        "--no-save-annotated",
        action="store_true",
        help="Skip writing annotated PNGs.",
    )
    parser.add_argument(
        "--min-hand-area-px",
        type=int,
        default=2500,
        help="Same gate as 2b (default 2500).",
    )
    parser.add_argument(
        "--edge-margin-px",
        type=int,
        default=4,
        help="Same gate as 2b (default 4).",
    )
    parser.add_argument(
        "--max-obj-to-hand-ratio",
        type=float,
        default=0.85,
        help="Same gate as 2b (default 0.85).",
    )
    parser.add_argument(
        "--all-hands",
        action="store_true",
        help="Verify every non-gated hand, not only hands that had a 2b detection.",
    )
    parser.add_argument(
        "--min-pass1-conf",
        type=float,
        default=0.0,
        help="When using default --only-candidates, require at least this 2b confidence.",
    )
    parser.add_argument(
        "--no-enhance",
        action="store_true",
        help="Disable CLAHE/sharpen/gamma (run second model only).",
    )
    parser.add_argument(
        "--clahe-clip",
        type=float,
        default=2.5,
        help="CLAHE clip limit when enhancement is on (default 2.5).",
    )
    parser.add_argument(
        "--no-sharpen",
        action="store_true",
        help="Disable unsharp-style sharpen.",
    )
    parser.add_argument(
        "--gamma",
        type=float,
        default=0.75,
        help="Gamma on crop before CLAHE (<1 brightens shadows). Use 1.0 to disable.",
    )
    parser.add_argument(
        "--frames",
        default="",
        help="Comma-separated sample-frame names/stems/numbers to verify "
        "(e.g. 'frame_000018,frame_000020' or '18,20'). Empty = all frames.",
    )
    parser.add_argument(
        "--silhouette-mode",
        choices=SILHOUETTE_MODES,
        default="hand_only",
        help="How to mask the dark silhouette before YOLO: 'off' = no mask, "
        "'hand_only' (default) = erode core so blade boundary stays visible, "
        "'full' = aggressive dilated mask. Drop check always uses the dilated "
        "mask so arm-shaped boxes are still rejected (unless mode='off').",
    )
    parser.add_argument(
        "--no-silhouette-suppress",
        action="store_true",
        help="(Deprecated) Alias for --silhouette-mode off.",
    )
    parser.add_argument(
        "--silhouette-drop-threshold",
        type=float,
        default=0.55,
        help="Drop a verify detection whose bbox sits over this fraction of the "
        "(dilated) silhouette mask (default 0.55).",
    )
    parser.add_argument(
        "--no-retry-low-conf",
        action="store_true",
        help="Disable the auto low-conf retry sweep.",
    )
    parser.add_argument(
        "--retry-conf",
        type=float,
        default=0.04,
        help="Confidence floor for the low-conf retry pass (default 0.04). "
        "Only applied when the main pass returns nothing.",
    )
    parser.add_argument(
        "--retry-classes",
        default="",
        help="Comma-separated COCO names for the retry sweep "
        f"(default: {','.join(DEFAULT_RETRY_CLASSES)}).",
    )
    parser.add_argument(
        "--no-tta",
        action="store_true",
        help="Disable test-time augmentation (TTA) and fall back to the "
        "legacy single-pass verifier (one enhancement preset, no "
        "consensus voting, no super-resolution).",
    )
    parser.add_argument(
        "--upscale-target",
        type=int,
        default=1536,
        help="TTA target square size before YOLO (default 1536; ignored when "
        "--no-tta is given, in which case --target is used).",
    )
    parser.add_argument(
        "--upscale-interp",
        choices=("lanczos", "cubic"),
        default="lanczos",
        help="TTA upscale interpolation (default 'lanczos').",
    )
    parser.add_argument(
        "--no-upscale-denoise",
        action="store_true",
        help="Disable fastNlMeansDenoisingColored before TTA upscale.",
    )
    parser.add_argument(
        "--sr-weights",
        default="",
        help="Optional cv2.dnn_superres weights (.pb). Filename should "
        "encode the model + scale, e.g. EDSR_x2.pb. When unavailable the "
        "verifier silently falls back to Lanczos.",
    )
    parser.add_argument(
        "--variations",
        default="",
        help="Comma-separated TTA variation names "
        f"(default: {','.join(_VARIATIONS_BUILTIN)}). Unknown names "
        "fall back to the baseline preset.",
    )
    parser.add_argument(
        "--consensus-iou",
        type=float,
        default=0.5,
        help="IoU threshold to merge same-label detections from different "
        "variations into one consensus cluster (default 0.5).",
    )
    parser.add_argument(
        "--min-supporters",
        type=int,
        default=2,
        help="Minimum number of variations that must agree on a detection "
        "before it counts as consensus (default 2).",
    )
    parser.add_argument(
        "--save-all-variations",
        action="store_true",
        help="Also save one annotated PNG per variation per hand "
        "(default off; the composite strip is always saved).",
    )
    args = parser.parse_args()

    if args.run:
        run_dir = Path(args.run).expanduser().resolve()
    else:
        latest = _newest_run_dir()
        if latest is None:
            print(
                "No --run and no zoom_evidence/evidence.json under output/*.\n"
                "Run zoom_evidence.py (and ideally zoom_evidence_dectator.py) first."
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

    cand = Path(args.weights).expanduser().resolve()
    if cand.is_file():
        wpath = cand
    else:
        base = Path(args.weights.strip()).name
        wpath = Path(base) if base else Path("yolov8s.pt")

    classes_list = (
        _parse_classes(args.classes) if args.classes.strip() else list(DEFAULT_VERIFY_CLASSES)
    )

    gamma: float | None = float(args.gamma)
    if abs(gamma - 1.0) < 1e-3:
        gamma = None

    frame_filters = _parse_classes(args.frames)

    silhouette_mode = "off" if args.no_silhouette_suppress else args.silhouette_mode
    retry_classes_list = (
        _parse_classes(args.retry_classes)
        if args.retry_classes.strip()
        else list(DEFAULT_RETRY_CLASSES)
    )

    variations_list = (
        _parse_classes(args.variations)
        if args.variations.strip()
        else list(_VARIATIONS_BUILTIN)
    )
    sr_weights_path: Path | None = None
    if args.sr_weights.strip():
        sr_weights_path = Path(args.sr_weights).expanduser().resolve()

    return verify_run(
        run_dir,
        video_path=video_path,
        weights=wpath,
        classes=classes_list,
        conf=max(0.0, args.conf),
        target=max(320, args.target),
        crop_pad=max(0.0, args.crop_pad),
        save_annotated=not args.no_save_annotated,
        min_hand_area_px=max(0, args.min_hand_area_px),
        edge_margin_px=max(0, args.edge_margin_px),
        max_obj_to_hand_ratio=max(0.10, min(1.0, args.max_obj_to_hand_ratio)),
        only_candidates=not args.all_hands,
        min_pass1_conf=max(0.0, args.min_pass1_conf),
        enhance=not args.no_enhance,
        clahe_clip=max(1.0, args.clahe_clip),
        sharpen=not args.no_sharpen,
        gamma=gamma,
        silhouette_mode=silhouette_mode,
        silhouette_drop_threshold=max(0.05, min(0.95, args.silhouette_drop_threshold)),
        frame_filters=frame_filters,
        retry_low_conf=not args.no_retry_low_conf,
        retry_conf=max(0.0, args.retry_conf),
        retry_classes=retry_classes_list,
        tta=not args.no_tta,
        upscale_target=max(320, args.upscale_target),
        upscale_interp=args.upscale_interp,
        upscale_denoise=not args.no_upscale_denoise,
        sr_weights=sr_weights_path,
        variations=variations_list,
        consensus_iou=max(0.05, min(0.95, args.consensus_iou)),
        min_supporters=max(1, args.min_supporters),
        save_all_variations=bool(args.save_all_variations),
    )


if __name__ == "__main__":
    sys.exit(main())
