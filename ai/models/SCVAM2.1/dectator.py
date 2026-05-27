"""
Step 1b (low-cost scan): run YOLO on every frame produced by preprocess.py,
filter to a safety-relevant class allowlist, and emit a scan summary.

Inputs (auto-detected for the newest preprocess run, or via --frames):
  ai/models/SCVAM2.1/output/<stem>_<fps>fps/frames/
  ai/models/SCVAM2.1/output/<stem>_<fps>fps/frames_index.json (timestamps)

Default classes (COCO names, lowercase). Override with --classes.
  person, knife, bottle, wine glass, cup, fork, spoon, bowl, scissors,
  chair, couch, bed, dining table, toilet, oven, microwave, toaster,
  sink, refrigerator, cell phone

Note: 'fire' / 'smoke' are NOT COCO classes and yolov8n.pt cannot detect
them. If you list them they are silently dropped after a one-time warning.
A custom-trained model is needed for fire/smoke.

Outputs (under ai/models/SCVAM2.1/output/<stem>_<fps>fps/detections/):
  frame_NNNNNN.png        annotated frame (only allowlisted classes drawn)
  detections.json         per-frame detections with timestamps
  scan_summary.json       per-class first-seen, last-seen, totals

Run (from repo root):
  python ai/models/SCVAM2.1/dectator.py
  python ai/models/SCVAM2.1/dectator.py --conf 0.20 --no-show
  python ai/models/SCVAM2.1/dectator.py --classes "person,knife,bottle,bed"
  python ai/models/SCVAM2.1/dectator.py --weights ai/training/ai_flags/yolov8s.pt
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
DEFAULT_WEIGHTS = REPO_ROOT / "yolov8n.pt"
IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".bmp", ".webp"}

DEFAULT_SAFETY_CLASSES: tuple[str, ...] = (
    "person",
    "knife",
    "bottle",
    "wine glass",
    "cup",
    "fork",
    "spoon",
    "bowl",
    "scissors",
    "chair",
    "couch",
    "bed",
    "dining table",
    "toilet",
    "oven",
    "microwave",
    "toaster",
    "sink",
    "refrigerator",
    "cell phone",
)

NON_COCO_HINTS = {
    "fire",
    "smoke",
    "flame",
    "blood",
    "syringe",
    "needle",
    "pill",
    "medication",
}


def _package_dir() -> Path:
    return Path(__file__).resolve().parent


def _newest_run_dir() -> Path | None:
    out_root = _package_dir() / "output"
    if not out_root.is_dir():
        return None
    candidates = [
        p
        for p in out_root.iterdir()
        if p.is_dir() and (p / "frames").is_dir()
    ]
    if not candidates:
        return None
    candidates.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    return candidates[0]


def _load_frames_index(run_dir: Path) -> dict[str, dict[str, Any]]:
    p = run_dir / "frames_index.json"
    if not p.is_file():
        return {}
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return {}
    out: dict[str, dict[str, Any]] = {}
    for row in data.get("frames", []) or []:
        name = row.get("frame")
        if isinstance(name, str):
            out[name] = row
    return out


def _enhance_for_inference(frame_bgr: np.ndarray, gamma: float = 0.6) -> np.ndarray:
    """Brighten shadows (gamma < 1) and rebuild local contrast (CLAHE on L)."""
    if gamma > 0 and abs(gamma - 1.0) > 1e-3:
        inv = 1.0 / gamma
        table = np.array([(i / 255.0) ** inv * 255 for i in range(256)]).astype("uint8")
        bright = cv2.LUT(frame_bgr, table)
    else:
        bright = frame_bgr
    lab = cv2.cvtColor(bright, cv2.COLOR_BGR2LAB)
    l, a, b = cv2.split(lab)
    clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8))
    l = clahe.apply(l)
    return cv2.cvtColor(cv2.merge((l, a, b)), cv2.COLOR_LAB2BGR)


def _color_for_label(label: str) -> tuple[int, int, int]:
    h = abs(hash(label)) % 0xFFFFFF
    return (h & 0xFF, (h >> 8) & 0xFF, (h >> 16) & 0xFF)


def _draw_detections(img, dets: list[dict[str, Any]]) -> None:
    for d in dets:
        x1, y1, x2, y2 = (int(round(v)) for v in d["xyxy"])
        color = _color_for_label(d["label"])
        cv2.rectangle(img, (x1, y1), (x2, y2), color, 2)
        text = f"{d['label']} {d['confidence']:.2f}"
        (tw, th), bl = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 1)
        ty1 = max(0, y1 - th - bl - 4)
        cv2.rectangle(img, (x1, ty1), (x1 + tw + 6, ty1 + th + bl + 4), color, -1)
        cv2.putText(
            img,
            text,
            (x1 + 3, ty1 + th + 1),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.5,
            (255, 255, 255),
            1,
            cv2.LINE_AA,
        )


def _load_model(weights: Path):
    try:
        from ultralytics import YOLO  # type: ignore
    except Exception as exc:
        print(f"[ERROR] ultralytics not installed: {exc}")
        print("Install:  pip install ultralytics")
        return None
    if not weights.is_file():
        print(f"[ERROR] YOLO weights not found: {weights}")
        return None
    try:
        return YOLO(str(weights))
    except Exception as exc:
        print(f"[ERROR] Failed to load YOLO weights '{weights}': {exc}")
        return None


def _resolve_class_ids(model, requested_names: list[str]) -> tuple[list[int], list[str], list[str]]:
    """Return (allowed_ids, allowed_names, unsupported_names)."""
    name_to_id: dict[str, int] = {}
    for cid, cname in (getattr(model, "names", {}) or {}).items():
        name_to_id[str(cname).strip().lower()] = int(cid)
    allowed_ids: list[int] = []
    allowed_names: list[str] = []
    unsupported: list[str] = []
    seen: set[int] = set()
    for n in requested_names:
        n_low = n.strip().lower()
        if not n_low:
            continue
        if n_low in name_to_id:
            cid = name_to_id[n_low]
            if cid not in seen:
                seen.add(cid)
                allowed_ids.append(cid)
                allowed_names.append(n_low)
        else:
            unsupported.append(n_low)
    return allowed_ids, allowed_names, unsupported


def detect_run(
    run_dir: Path,
    *,
    weights: Path,
    conf: float,
    classes: list[str],
    enhance: bool,
    enhance_gamma: float,
    show: bool,
    delay_ms: int,
) -> int:
    frames_dir = run_dir / "frames"
    if not frames_dir.is_dir():
        print(f"[ERROR] frames folder not found: {frames_dir}")
        return 1

    images = sorted(p for p in frames_dir.iterdir() if p.suffix.lower() in IMAGE_EXTS)
    if not images:
        print(f"[ERROR] no images in {frames_dir}")
        return 1

    model = _load_model(weights)
    if model is None:
        return 1

    allowed_ids, allowed_names, unsupported = _resolve_class_ids(model, classes)
    if not allowed_ids:
        print(
            f"[ERROR] none of the requested classes are supported by {weights}.\n"
            f"  requested: {classes}\n"
            f"  unsupported: {unsupported}"
        )
        return 1
    if unsupported:
        non_coco = [n for n in unsupported if n in NON_COCO_HINTS]
        other = [n for n in unsupported if n not in NON_COCO_HINTS]
        if non_coco:
            print(
                f"[WARN] These classes are NOT in this YOLO model and will be ignored: "
                f"{', '.join(non_coco)}.\n"
                f"       (yolov8n/s/m/l on COCO has no fire/smoke; train a custom model.)"
            )
        if other:
            print(f"[WARN] Unknown class names ignored: {', '.join(other)}")

    index = _load_frames_index(run_dir)
    out_dir = run_dir / "detections"
    out_dir.mkdir(parents=True, exist_ok=True)

    win = "SCVAM2.1 Step 1 Scan"
    if show:
        cv2.namedWindow(win, cv2.WINDOW_NORMAL)
        cv2.resizeWindow(win, 960, 540)

    print(
        f"Step 1b scan on {len(images)} frames\n"
        f"  weights:    {weights}\n"
        f"  classes:    {allowed_names}  (ids={allowed_ids})\n"
        f"  conf:       {conf}\n"
        f"  enhance:    {'on' if enhance else 'off'} (gamma={enhance_gamma:.2f})\n"
        f"  out_dir:    {out_dir}"
    )

    summary_frames: list[dict[str, Any]] = []
    per_class: dict[str, dict[str, Any]] = {
        name: {
            "label": name,
            "frames_seen": 0,
            "total_detections": 0,
            "first_seen_ts": None,
            "first_seen_frame": None,
            "last_seen_ts": None,
            "last_seen_frame": None,
            "max_confidence": 0.0,
        }
        for name in allowed_names
    }

    quit_early = False
    log_every = max(1, len(images) // 20)
    total_dets = 0

    for i, img_path in enumerate(images, start=1):
        meta = index.get(img_path.name, {})
        ts_sec = float(meta.get("ts_sec", 0.0))
        src_index = int(meta.get("src_index", 0))

        frame = cv2.imread(str(img_path))
        if frame is None:
            print(f"  [{i}/{len(images)}] skip (cannot read): {img_path.name}")
            continue

        inf_frame = _enhance_for_inference(frame, gamma=enhance_gamma) if enhance else frame
        results = model(inf_frame, verbose=False, conf=conf, classes=allowed_ids)[0]
        names = getattr(results, "names", {}) or {}

        dets: list[dict[str, Any]] = []
        for box in results.boxes or []:
            c = float(box.conf[0])
            if c < conf:
                continue
            cls_id = int(box.cls[0])
            label = str(names.get(cls_id, f"class_{cls_id}")).strip().lower()
            if label not in per_class:
                continue
            x1, y1, x2, y2 = (float(v) for v in box.xyxy[0].tolist())
            dets.append(
                {
                    "label": label,
                    "confidence": round(c, 4),
                    "xyxy": [round(x1, 1), round(y1, 1), round(x2, 1), round(y2, 1)],
                }
            )

        _draw_detections(frame, dets)
        cv2.putText(
            frame,
            f"#{i}/{len(images)}  src#{src_index}  t={ts_sec:.2f}s  obj={len(dets)}",
            (10, 24),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.6,
            (255, 255, 255),
            2,
            cv2.LINE_AA,
        )
        cv2.imwrite(str(out_dir / img_path.name), frame)

        seen_in_frame: set[str] = set()
        for d in dets:
            lbl = d["label"]
            stat = per_class[lbl]
            stat["total_detections"] += 1
            stat["max_confidence"] = max(stat["max_confidence"], d["confidence"])
            if stat["first_seen_ts"] is None:
                stat["first_seen_ts"] = ts_sec
                stat["first_seen_frame"] = img_path.name
            stat["last_seen_ts"] = ts_sec
            stat["last_seen_frame"] = img_path.name
            seen_in_frame.add(lbl)
        for lbl in seen_in_frame:
            per_class[lbl]["frames_seen"] += 1

        total_dets += len(dets)
        summary_frames.append(
            {
                "frame": img_path.name,
                "src_index": src_index,
                "ts_sec": ts_sec,
                "count": len(dets),
                "labels": sorted(seen_in_frame),
                "detections": dets,
            }
        )

        if i == 1 or i == len(images) or i % log_every == 0:
            labels_str = ", ".join(sorted(seen_in_frame)) or "-"
            print(
                f"  [{i}/{len(images)}] t={ts_sec:.2f}s  {img_path.name}: "
                f"{len(dets)} obj ({labels_str})"
            )

        if show:
            cv2.imshow(win, frame)
            key = cv2.waitKey(delay_ms) & 0xFF
            if key in (ord("q"), ord("Q"), 27):
                quit_early = True
                break
            if key == ord(" "):
                while True:
                    k2 = cv2.waitKey(50) & 0xFF
                    if k2 == ord(" "):
                        break
                    if k2 in (ord("q"), ord("Q"), 27):
                        quit_early = True
                        break
                if quit_early:
                    break

    if show:
        cv2.destroyAllWindows()

    detections_path = out_dir / "detections.json"
    detections_path.write_text(
        json.dumps(
            {
                "run_dir": run_dir.as_posix(),
                "frames_dir": frames_dir.as_posix(),
                "weights": weights.as_posix(),
                "conf": conf,
                "classes": allowed_names,
                "enhance": enhance,
                "enhance_gamma": enhance_gamma,
                "frame_count": len(summary_frames),
                "total_detections": total_dets,
                "frames": summary_frames,
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    summary_path = out_dir / "scan_summary.json"
    summary_path.write_text(
        json.dumps(
            {
                "run_dir": run_dir.as_posix(),
                "frames_scanned": len(summary_frames),
                "total_detections": total_dets,
                "classes": [
                    per_class[name]
                    for name in allowed_names
                    if per_class[name]["total_detections"] > 0
                ],
                "classes_never_seen": [
                    name
                    for name in allowed_names
                    if per_class[name]["total_detections"] == 0
                ],
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    print(
        f"\nDone{' (stopped early)' if quit_early else ''}: "
        f"{len(summary_frames)} frames scanned, {total_dets} detections."
    )
    seen = [name for name in allowed_names if per_class[name]["total_detections"] > 0]
    miss = [name for name in allowed_names if per_class[name]["total_detections"] == 0]
    print(f"  classes seen:   {seen or '-'}")
    print(f"  classes missed: {miss or '-'}")
    print(f"Detections JSON: {detections_path}")
    print(f"Scan summary:    {summary_path}")
    return 0


def _parse_classes(raw: str) -> list[str]:
    return [c.strip() for c in raw.split(",") if c.strip()]


def main() -> int:
    parser = argparse.ArgumentParser(description="Step 1b: filtered YOLO scan over preprocess frames.")
    parser.add_argument(
        "--run",
        default="",
        help="Run dir (default: newest under ai/models/SCVAM2.1/output).",
    )
    parser.add_argument(
        "--frames",
        default="",
        help="Path to a frames/ folder (overrides --run).",
    )
    parser.add_argument(
        "--weights",
        default=str(DEFAULT_WEIGHTS),
        help=f"YOLO weights (default: {DEFAULT_WEIGHTS}).",
    )
    parser.add_argument("--conf", type=float, default=0.20, help="Min confidence (default 0.20).")
    parser.add_argument(
        "--classes",
        default=",".join(DEFAULT_SAFETY_CLASSES),
        help="Comma-separated allowlist of class names (COCO).",
    )
    parser.add_argument(
        "--no-enhance",
        action="store_true",
        help="Disable backlight rescue (gamma + CLAHE) before YOLO.",
    )
    parser.add_argument(
        "--enhance-gamma",
        type=float,
        default=0.6,
        help="Gamma for shadow-brightening before YOLO (<1 brightens, default 0.6).",
    )
    parser.add_argument("--no-show", action="store_true", help="Skip preview window.")
    parser.add_argument(
        "--delay-ms",
        type=int,
        default=50,
        help="Per-frame display delay when previewing (default 50).",
    )
    args = parser.parse_args()

    if args.frames:
        frames_dir = Path(args.frames).expanduser().resolve()
        run_dir = frames_dir.parent
    elif args.run:
        run_dir = Path(args.run).expanduser().resolve()
    else:
        latest = _newest_run_dir()
        if latest is None:
            print(
                "No --run/--frames given and nothing under ai/models/SCVAM2.1/output/*/frames.\n"
                "Run first: python ai/models/SCVAM2.1/preprocess.py"
            )
            return 1
        run_dir = latest

    return detect_run(
        run_dir,
        weights=Path(args.weights).expanduser().resolve(),
        conf=max(0.0, args.conf),
        classes=_parse_classes(args.classes),
        enhance=not args.no_enhance,
        enhance_gamma=max(0.1, min(2.0, args.enhance_gamma)),
        show=not args.no_show,
        delay_ms=max(1, args.delay_ms),
    )


if __name__ == "__main__":
    sys.exit(main())
