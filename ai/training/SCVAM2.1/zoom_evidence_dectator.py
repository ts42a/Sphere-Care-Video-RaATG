"""
Step 2b: held-object detection on the Left/Right hand crops produced by
zoom_evidence.py.

Per pick row in zoom_evidence/evidence.json:
  * For each hand (Left, Right):
      1. Seek the original source video to source_frame_index and read the
         frame at full resolution.
      2. Crop the hand bbox (with --crop-pad expansion).
      3. Square-pad to a black canvas, resize to --target (default 640).
      4. Run YOLO restricted to the held-object allowlist
         (knife / scissors / fork / bottle / cup / wine glass / cell phone).
      5. Map detections back to full-frame coordinates.
      6. Save an annotated PNG of the upscaled crop and record the result.
  * Pick the highest-confidence object as that hand's ``object_in_hand``.

Outputs (under <run_dir>/zoom_evidence_dectator/):
  detections.json                                per pick / per hand objects
  <stem>_pick<K>_src<NNNNNN>_<side>.png          annotated upscaled crop

Side-effect: ``zoom_evidence/evidence.json`` is patched IN PLACE to add
``held_objects_from_hand_zoom`` (concat of all detections) and per-hand
``object_in_hand`` / ``category`` so downstream pose_detection.py and
merge_frames.py keep working unchanged.

Run:
  python ai/models/SCVAM2.1/zoom_evidence_dectator.py
  python ai/models/SCVAM2.1/zoom_evidence_dectator.py --weights ai/models/yolo/yolov8s.pt
  python ai/models/SCVAM2.1/zoom_evidence_dectator.py --conf 0.07 --target 960
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
DEFAULT_WEIGHTS = REPO_ROOT / "ai" / "models" / "yolo" / "yolov8n.pt"
SELECTED_NAME = "SELECTED_VIDEO.txt"

HELD_OBJECT_CATEGORIES: dict[str, tuple[str, ...]] = {
    "sharp_object": ("knife", "scissors", "fork"),
    "medicine_or_drink": ("bottle", "cup", "wine glass"),
    "phone": ("cell phone",),
}
# Default = safety-only.  Drinks (cup/bottle/wine glass) are the main source
# of false-positive "object in hand" detections on dark crops (foot mistaken
# for cup, sleeve mistaken for bottle).  Opt in via --include-drinks.
SAFETY_HELD_CLASSES: tuple[str, ...] = (
    HELD_OBJECT_CATEGORIES["sharp_object"] + HELD_OBJECT_CATEGORIES["phone"]
)
DRINK_HELD_CLASSES: tuple[str, ...] = HELD_OBJECT_CATEGORIES["medicine_or_drink"]
DEFAULT_HELD_CLASSES: tuple[str, ...] = SAFETY_HELD_CLASSES
NON_COCO_HINTS = {
    "walking aid", "walking_aid", "walker", "cane", "crutch", "wheelchair",
    "fire", "smoke", "blood", "syringe", "needle", "pill", "medication",
}


def _categorize_label(label: str) -> str | None:
    label = (label or "").strip().lower()
    for cat, items in HELD_OBJECT_CATEGORIES.items():
        if label in items:
            return cat
    return None


# =============================================================================
#  filesystem
# =============================================================================

def _package_dir() -> Path:
    return Path(__file__).resolve().parent


def _newest_run_dir() -> Path | None:
    out_root = _package_dir() / "output"
    if not out_root.is_dir():
        return None
    cands = [
        d for d in out_root.iterdir()
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


# =============================================================================
#  YOLO
# =============================================================================

def _load_yolo(weights: Path):
    try:
        from ultralytics import YOLO
    except Exception as exc:
        print(f"[ERROR] ultralytics not installed: {exc}")
        return None
    if not weights.is_file():
        print(f"[WARN] weights not found at {weights} - ultralytics will try to fetch.")
    try:
        return YOLO(str(weights))
    except Exception as exc:
        print(f"[ERROR] could not load YOLO weights {weights}: {exc}")
        return None


def _resolve_class_ids(model, requested: list[str]) -> tuple[list[int], list[str], list[str]]:
    name_to_id: dict[str, int] = {}
    for cid, cname in (getattr(model, "names", {}) or {}).items():
        name_to_id[str(cname).strip().lower()] = int(cid)
    allowed_ids: list[int] = []
    allowed_names: list[str] = []
    unsupported: list[str] = []
    for n in requested:
        n_low = n.strip().lower()
        if not n_low:
            continue
        cid = name_to_id.get(n_low)
        if cid is not None:
            if cid not in allowed_ids:
                allowed_ids.append(cid)
                allowed_names.append(n_low)
        else:
            unsupported.append(n_low)
    return allowed_ids, allowed_names, unsupported


# =============================================================================
#  per-hand crop -> YOLO
# =============================================================================

def _expand_pad(
    bbox: tuple[float, float, float, float],
    *,
    pad: float,
    frame_w: int,
    frame_h: int,
) -> tuple[int, int, int, int]:
    x1, y1, x2, y2 = bbox
    bw = max(1.0, x2 - x1)
    bh = max(1.0, y2 - y1)
    px = bw * pad
    py = bh * pad
    nx1 = int(round(max(0.0, x1 - px)))
    ny1 = int(round(max(0.0, y1 - py)))
    nx2 = int(round(min(float(frame_w), x2 + px)))
    ny2 = int(round(min(float(frame_h), y2 + py)))
    if nx2 <= nx1 or ny2 <= ny1:
        return (0, 0, 0, 0)
    return (nx1, ny1, nx2, ny2)


def _yolo_on_hand_crop(
    model,
    frame_bgr: np.ndarray,
    hand_bbox: tuple[float, float, float, float],
    *,
    crop_pad: float,
    target: int,
    conf: float,
    allowed_ids: list[int],
):
    """Crop the hand bbox (with crop_pad), square-pad to a black canvas,
    upscale to target, run YOLO, and map detections back to full-frame
    coordinates.  Returns (detections, crop_bbox_full_frame, fed_image).
    fed_image is the upscaled crop with detections drawn (for saving).
    """
    fh, fw = frame_bgr.shape[:2]
    cx1, cy1, cx2, cy2 = _expand_pad(hand_bbox, pad=crop_pad, frame_w=fw, frame_h=fh)
    if cx2 <= cx1 or cy2 <= cy1:
        return [], None, None
    crop = frame_bgr[cy1:cy2, cx1:cx2]
    if crop.size == 0:
        return [], None, None
    cw, ch = crop.shape[1], crop.shape[0]
    side = max(cw, ch)
    canvas = np.zeros((side, side, 3), dtype=crop.dtype)
    pad_x = (side - cw) // 2
    pad_y = (side - ch) // 2
    canvas[pad_y:pad_y + ch, pad_x:pad_x + cw] = crop
    fed = cv2.resize(canvas, (target, target), interpolation=cv2.INTER_CUBIC)

    if model is None or not allowed_ids:
        return [], (cx1, cy1, cx2, cy2), fed

    try:
        res = model(fed, verbose=False, conf=conf, classes=allowed_ids)[0]
    except Exception as exc:
        print(f"[WARN] YOLO inference failed on hand crop: {exc}")
        return [], (cx1, cy1, cx2, cy2), fed

    names = getattr(res, "names", {}) or {}
    scale = side / float(target)
    out: list[dict[str, Any]] = []
    fed_annot = fed.copy()
    for box in res.boxes or []:
        c = float(box.conf[0])
        if c < conf:
            continue
        cls_id = int(box.cls[0])
        label = str(names.get(cls_id, f"class_{cls_id}")).strip().lower()
        cat = _categorize_label(label)
        if cat is None:
            continue
        bx1, by1, bx2, by2 = (float(v) for v in box.xyxy[0].tolist())
        # fed -> canvas (side x side) -> remove pad -> add crop offset
        ux1 = bx1 * scale - pad_x + cx1
        uy1 = by1 * scale - pad_y + cy1
        ux2 = bx2 * scale - pad_x + cx1
        uy2 = by2 * scale - pad_y + cy1
        out.append(
            {
                "label": label,
                "confidence": round(c, 4),
                "category": cat,
                "xyxy": [ux1, uy1, ux2, uy2],
                "fed_xyxy": [bx1, by1, bx2, by2],
            }
        )
        # annotate fed image
        cv2.rectangle(
            fed_annot,
            (int(round(bx1)), int(round(by1))),
            (int(round(bx2)), int(round(by2))),
            (60, 220, 60),
            2,
        )
        cv2.putText(
            fed_annot,
            f"{label} {c:.2f}",
            (int(round(bx1)), max(14, int(round(by1)) - 6)),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.55,
            (60, 220, 60),
            2,
            cv2.LINE_AA,
        )
    out.sort(key=lambda d: float(d["confidence"]), reverse=True)
    return out, (cx1, cy1, cx2, cy2), fed_annot


# =============================================================================
#  main
# =============================================================================

def detect(
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
        print("[INFO] evidence.json has no frames - nothing to detect on.")
        return 0

    yolo = _load_yolo(weights)
    if yolo is None:
        return 1
    allowed_ids, allowed_names, unsupported = _resolve_class_ids(yolo, classes)
    if unsupported:
        non_coco = [n for n in unsupported if n in NON_COCO_HINTS]
        other = [n for n in unsupported if n not in NON_COCO_HINTS]
        if non_coco:
            print(
                f"[WARN] Not in this YOLO model: {', '.join(non_coco)}. "
                f"Custom-trained model needed."
            )
        if other:
            print(f"[WARN] Unknown class names ignored: {', '.join(other)}")
    if not allowed_ids:
        print("[ERROR] No requested classes match this YOLO model. Aborting.")
        return 1

    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        print(f"[ERROR] could not open video: {video_path}")
        return 1

    video_is_webm = video_path.suffix.lower() == ".webm"
    out_dir = run_dir / "zoom_evidence_dectator"
    out_dir.mkdir(parents=True, exist_ok=True)

    print(
        f"Step 2b held-object detection on {len(frames)} pick rows\n"
        f"  weights:    {weights}\n"
        f"  classes:    {allowed_names}  (conf>={conf})\n"
        f"  target:     {target}x{target}\n"
        f"  crop_pad:   {crop_pad:.2f}\n"
        f"  hand gates: min_area={min_hand_area_px}px^2  "
        f"edge_margin={edge_margin_px}px  "
        f"max_obj/hand={max_obj_to_hand_ratio:.2f}\n"
        f"  evidence:   {ev_path}\n"
        f"  out_dir:    {out_dir}"
    )

    out_frames: list[dict[str, Any]] = []
    n_hands_total = 0
    n_hands_with_obj = 0
    n_hands_skipped_small = 0
    n_hands_skipped_edge = 0
    n_dets_dropped_oversize = 0
    n_categories: dict[str, int] = {}
    log_every = max(1, len(frames) // 20)

    # We mutate each pick row in place so the patched evidence.json keeps the
    # downstream schema (held_objects_from_hand_zoom + per-hand object_in_hand).
    for i, pick in enumerate(frames, start=1):
        sample_name = str(pick.get("sample_frame", ""))
        sample_ts = float(pick.get("sample_ts_sec") or 0.0)
        src_idx = int(pick.get("source_frame_index") or 0)
        src_ts = float(pick.get("source_ts_sec") or (src_idx / 30.0))
        hands = pick.get("hands") or []

        frame = None
        if video_is_webm:
            # WebM seeking fails in this environment; use the already-saved
            # evidence frame PNG created by zoom_evidence.py.
            out_name = pick.get("output")
            if isinstance(out_name, str) and out_name:
                ev_frame_path = run_dir / "zoom_evidence" / out_name
                if ev_frame_path.is_file():
                    frame = cv2.imread(str(ev_frame_path))

        if frame is None:
            if video_is_webm:
                # Fallback: try seeking (may fail).
                cap.set(cv2.CAP_PROP_POS_MSEC, src_ts * 1000.0)
            else:
                cap.set(cv2.CAP_PROP_POS_FRAMES, src_idx)
            ok, frame = cap.read()
            if not ok or frame is None:
                print(f"[WARN] could not read src#{src_idx} for {sample_name}")
                continue

        per_hand: list[dict[str, Any]] = []
        all_dets_for_pick: list[dict[str, Any]] = []
        held_categories: list[str] = []

        fh, fw = frame.shape[:2]
        for hand in hands:
            n_hands_total += 1
            side = str(hand.get("side") or "?")
            hbb = hand.get("bbox") or []
            if len(hbb) != 4:
                hand["object_in_hand"] = None
                hand["category"] = None
                hand["objects"] = []
                per_hand.append({"side": side, "bbox": hbb, "objects": []})
                continue

            x1, y1, x2, y2 = (float(hbb[0]), float(hbb[1]), float(hbb[2]), float(hbb[3]))
            hand_w = max(0.0, x2 - x1)
            hand_h = max(0.0, y2 - y1)
            hand_area = hand_w * hand_h

            # Gate 1: skip impossibly tiny crops (poor pose anchor / very
            # distant subject) - YOLO can only hallucinate on these.
            if hand_area < float(min_hand_area_px):
                n_hands_skipped_small += 1
                hand["object_in_hand"] = None
                hand["category"] = None
                hand["objects"] = []
                hand["skip_reason"] = (
                    f"too_small({int(hand_area)}<{min_hand_area_px})"
                )
                per_hand.append(
                    {
                        "side": side,
                        "bbox": list(hbb),
                        "objects": [],
                        "object_in_hand": None,
                        "category": None,
                        "annotated_crop": None,
                        "skip_reason": hand["skip_reason"],
                    }
                )
                continue

            # Gate 2: skip crops that touch the frame border (the wrist
            # keypoint snapped to the edge - real hand is out-of-frame).
            if (
                x1 <= edge_margin_px
                or y1 <= edge_margin_px
                or x2 >= fw - edge_margin_px
                or y2 >= fh - edge_margin_px
            ):
                n_hands_skipped_edge += 1
                hand["object_in_hand"] = None
                hand["category"] = None
                hand["objects"] = []
                hand["skip_reason"] = "frame_edge"
                per_hand.append(
                    {
                        "side": side,
                        "bbox": list(hbb),
                        "objects": [],
                        "object_in_hand": None,
                        "category": None,
                        "annotated_crop": None,
                        "skip_reason": "frame_edge",
                    }
                )
                continue

            dets, crop_full, fed_annot = _yolo_on_hand_crop(
                yolo,
                frame,
                (x1, y1, x2, y2),
                crop_pad=crop_pad,
                target=target,
                conf=conf,
                allowed_ids=allowed_ids,
            )

            # Gate 3: drop detections whose bbox area exceeds
            # max_obj_to_hand_ratio x hand_area.  A "cup" filling 95% of the
            # hand crop is almost always a body part (foot / forearm) being
            # mislabeled by YOLO.
            if dets and hand_area > 0:
                kept_dets: list[dict[str, Any]] = []
                for d in dets:
                    bx = d.get("xyxy") or [0, 0, 0, 0]
                    bw = max(0.0, float(bx[2]) - float(bx[0]))
                    bh = max(0.0, float(bx[3]) - float(bx[1]))
                    barea = bw * bh
                    ratio = barea / max(1.0, hand_area)
                    if ratio > max_obj_to_hand_ratio:
                        n_dets_dropped_oversize += 1
                        continue
                    kept_dets.append(d)
                dets = kept_dets

            # Fold detections into the pick row so downstream code sees them.
            top = dets[0] if dets else None
            hand["object_in_hand"] = (
                {
                    "label": top["label"],
                    "confidence": float(top["confidence"]),
                    "category": top["category"],
                    "xyxy": top["xyxy"],
                }
                if top is not None
                else None
            )
            hand["category"] = top["category"] if top is not None else None
            hand["objects"] = dets
            all_dets_for_pick.extend(dets)
            for d in dets:
                cat = d.get("category")
                if cat and cat not in held_categories:
                    held_categories.append(cat)
                if cat:
                    n_categories[cat] = n_categories.get(cat, 0) + 1
            if dets:
                n_hands_with_obj += 1

            # Save annotated upscaled crop if anything was found, so the user
            # can flip through evidence quickly.
            saved_path: str | None = None
            if save_annotated and fed_annot is not None and dets:
                stem = Path(sample_name).stem if sample_name else f"s{i:06d}"
                pick_tag = pick.get("output", "")
                # try to copy the pickK tag from zoom_evidence's filename
                rank_tag = ""
                if isinstance(pick_tag, str) and "_pick" in pick_tag:
                    rank_tag = pick_tag.split("_pick", 1)[1].split("_", 1)[0]
                rank_tag = f"_pick{rank_tag}" if rank_tag else ""
                out_name = (
                    f"{stem}{rank_tag}_src{src_idx:06d}_{side.lower()}.png"
                )
                cv2.imwrite(str(out_dir / out_name), fed_annot)
                saved_path = out_name

            per_hand.append(
                {
                    "side": side,
                    "bbox": list(hbb),
                    "crop_bbox_full_frame": list(crop_full) if crop_full is not None else None,
                    "objects": dets,
                    "object_in_hand": hand["object_in_hand"],
                    "category": hand["category"],
                    "annotated_crop": saved_path,
                }
            )

        # patch the legacy aggregate fields downstream merge_frames.py expects
        pick["held_objects_from_hand_zoom"] = all_dets_for_pick
        pick["held_categories"] = held_categories

        out_frames.append(
            {
                "sample_frame": sample_name,
                "sample_ts_sec": sample_ts,
                "source_frame_index": src_idx,
                "source_ts_sec": src_ts,
                "hands": per_hand,
                "held_categories": held_categories,
            }
        )

        if i == 1 or i == len(frames) or i % log_every == 0 or held_categories:
            tags = []
            for ph in per_hand:
                obj = ph.get("object_in_hand")
                if obj:
                    tags.append(f"{ph['side']}={obj['label']}({obj['confidence']:.2f})")
            tag_str = ", ".join(tags) if tags else "no obj"
            print(
                f"  [{i}/{len(frames)}] {sample_name} src#{src_idx} "
                f"t={src_ts:.2f}s: {tag_str}"
            )

    cap.release()

    payload = {
        "run_dir": run_dir.as_posix(),
        "video": video_path.as_posix(),
        "weights": weights.as_posix(),
        "target_size": target,
        "obj_conf": conf,
        "crop_pad": crop_pad,
        "classes": allowed_names,
        "n_pick_rows": len(out_frames),
        "n_hands": n_hands_total,
        "n_hands_with_obj": n_hands_with_obj,
        "n_hands_skipped_small": n_hands_skipped_small,
        "n_hands_skipped_edge": n_hands_skipped_edge,
        "n_dets_dropped_oversize": n_dets_dropped_oversize,
        "n_categories": n_categories,
        "frames": out_frames,
    }
    out_json = out_dir / "detections.json"
    out_json.write_text(json.dumps(payload, indent=2), encoding="utf-8")

    # Save patched evidence.json so pose_detection / merge_frames see results.
    ev_path.write_text(json.dumps(evidence, indent=2), encoding="utf-8")

    print(
        f"\nDone. {n_hands_with_obj}/{n_hands_total} hands had a detected held "
        f"object. Categories: {n_categories or '(none)'}"
    )
    if n_hands_skipped_small or n_hands_skipped_edge or n_dets_dropped_oversize:
        print(
            f"  gates fired:  small_crop={n_hands_skipped_small}  "
            f"frame_edge={n_hands_skipped_edge}  "
            f"oversize_obj={n_dets_dropped_oversize}"
        )
    print(f"Detector JSON: {out_json}")
    print(f"Patched:       {ev_path}")
    print("\nNext (optional): python ai/models/SCVAM2.1/zoom_evidence_verify.py")
    return 0


# =============================================================================
#  CLI
# =============================================================================

def _parse_classes(raw: str) -> list[str]:
    return [c.strip() for c in raw.split(",") if c.strip()]


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Step 2b: held-object YOLO on Left/Right hand crops."
    )
    parser.add_argument(
        "--run", default="",
        help="Run dir (default: newest under ai/models/SCVAM2.1/output with "
        "zoom_evidence/evidence.json).",
    )
    parser.add_argument(
        "--video", default="",
        help="Source video path (default: SELECTED_VIDEO.txt).",
    )
    parser.add_argument(
        "--weights", default=str(DEFAULT_WEIGHTS),
        help=f"YOLO weights (default {DEFAULT_WEIGHTS}).",
    )
    parser.add_argument(
        "--classes", default="",
        help="Comma-separated allowlist of held-object classes (COCO names). "
        "Empty (default) = safety-only "
        f"({','.join(SAFETY_HELD_CLASSES)}). "
        "Use --include-drinks to add cup/bottle/wine glass.",
    )
    parser.add_argument(
        "--include-drinks", action="store_true",
        help="Include drink/medicine classes (cup/bottle/wine glass) in the "
        "allowlist. These are the most common false-positive sources, so "
        "they are off by default.",
    )
    parser.add_argument(
        "--conf", type=float, default=0.10,
        help="Min YOLO confidence (default 0.10).",
    )
    parser.add_argument(
        "--target", type=int, default=640,
        help="Square upscale size for each hand crop (default 640).",
    )
    parser.add_argument(
        "--crop-pad", type=float, default=0.25,
        help="Padding fraction added around the hand bbox before cropping "
        "(default 0.25). Larger = more context for tiny tools.",
    )
    parser.add_argument(
        "--no-save-annotated", action="store_true",
        help="Skip writing the annotated PNG per detected hand crop.",
    )
    parser.add_argument(
        "--min-hand-area-px", type=int, default=2500,
        help="Skip hand crops whose pixel area is below this (default 2500 "
        "= ~50x50). Tiny crops mostly produce hallucinated detections.",
    )
    parser.add_argument(
        "--edge-margin-px", type=int, default=4,
        help="Skip hand crops whose bbox touches the frame edge within this "
        "margin (default 4 px). Wrist keypoints often snap to the edge "
        "when the real hand is off-screen.",
    )
    parser.add_argument(
        "--max-obj-to-hand-ratio", type=float, default=0.85,
        help="Drop detections whose bbox area exceeds this fraction of the "
        "hand crop area (default 0.85). Filters out 'cup' / 'bottle' / etc. "
        "that fill the whole crop, which are almost always body parts "
        "being mislabeled.",
    )
    args = parser.parse_args()

    if args.run:
        run_dir = Path(args.run).expanduser().resolve()
    else:
        latest = _newest_run_dir()
        if latest is None:
            print(
                "No --run given and no zoom_evidence/evidence.json under "
                "ai/models/SCVAM2.1/output/*.\n"
                "Run zoom_evidence.py first."
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

    classes_str = args.classes.strip()
    if classes_str:
        classes_list = _parse_classes(classes_str)
    else:
        classes_list = list(SAFETY_HELD_CLASSES)
        if args.include_drinks:
            classes_list = classes_list + list(DRINK_HELD_CLASSES)

    return detect(
        run_dir,
        video_path=video_path,
        weights=Path(args.weights).expanduser().resolve(),
        classes=classes_list,
        conf=max(0.0, args.conf),
        target=max(160, args.target),
        crop_pad=max(0.0, args.crop_pad),
        save_annotated=not args.no_save_annotated,
        min_hand_area_px=max(0, args.min_hand_area_px),
        edge_margin_px=max(0, args.edge_margin_px),
        max_obj_to_hand_ratio=max(0.10, min(1.0, args.max_obj_to_hand_ratio)),
    )


if __name__ == "__main__":
    sys.exit(main())
