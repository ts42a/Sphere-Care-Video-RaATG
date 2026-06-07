"""
Step 1c (frame reducer): drop redundant 2-fps anchors so the expensive
Step 2 (zoom_evidence) and Step 3 (pose_detection) passes can skip them.

A frame is KEPT when ANY of these is true:

  * boundary - first or last anchor in the run
  * new tracked class label appears since the last kept frame
    (defaults: person/knife/scissors/fork/bottle/cup/wine glass/cell phone)
  * person presence flag flips (person appears or disappears)
  * inter-frame motion >= --motion-threshold (mean abs gray-diff in [0,1])
  * --keepalive-sec seconds elapsed since the last kept frame
    (so dead periods still emit a heartbeat for context)

Otherwise the frame is DROPPED.

This script is non-destructive. It writes:
  reduced/active_frames.json       - list of sample_frame names to process
  reduced/reduction_summary.json   - per-frame decisions + motion scores

zoom_evidence.py and pose_detection.py automatically pick up
active_frames.json if it exists; pass --no-reducer to ignore it.

Run (from repo root):
  python ai/models/SCVAM2.1/reducer.py
  python ai/models/SCVAM2.1/reducer.py --motion-threshold 0.02 --keepalive-sec 4
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

import cv2
import numpy as np

# Default "tracked" classes whose appearance in a frame triggers a keep.
# We exclude static furniture (chair / couch / dining table) because Step 1
# detects them in nearly every frame anyway and would force-keep everything.
DEFAULT_TRACKED_CLASSES: list[str] = [
    "person",
    "knife",
    "scissors",
    "fork",
    "bottle",
    "cup",
    "wine glass",
    "cell phone",
]


# =============================================================================
#  filesystem helpers
# =============================================================================

def _package_dir() -> Path:
    return Path(__file__).resolve().parent


def _newest_run_dir() -> Path | None:
    out_root = _package_dir() / "output"
    if not out_root.is_dir():
        return None
    candidates = [
        d for d in out_root.iterdir()
        if d.is_dir() and (d / "detections" / "detections.json").is_file()
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
#  motion estimate
# =============================================================================

def _read_gray_small(path: Path, target_w: int = 320) -> np.ndarray | None:
    if not path.is_file():
        return None
    img = cv2.imread(str(path), cv2.IMREAD_COLOR)
    if img is None:
        return None
    h, w = img.shape[:2]
    if w <= 0 or h <= 0:
        return None
    if w > target_w:
        scale = target_w / float(w)
        img = cv2.resize(img, (target_w, int(round(h * scale))), interpolation=cv2.INTER_AREA)
    return cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)


def _motion_score(prev_gray: np.ndarray | None, curr_gray: np.ndarray | None) -> float:
    """Mean absolute gray-level difference normalized to [0, 1].
    Returns 0.0 when motion can't be computed (missing frames)."""
    if prev_gray is None or curr_gray is None:
        return 0.0
    if prev_gray.shape != curr_gray.shape:
        # Match smaller -> bigger to handle the rare resize edge case.
        h = min(prev_gray.shape[0], curr_gray.shape[0])
        w = min(prev_gray.shape[1], curr_gray.shape[1])
        prev_gray = cv2.resize(prev_gray, (w, h))
        curr_gray = cv2.resize(curr_gray, (w, h))
    diff = cv2.absdiff(prev_gray, curr_gray)
    return float(diff.mean()) / 255.0


# =============================================================================
#  per-frame classification
# =============================================================================

def _classify(
    fmeta: dict[str, Any],
    prev_kept_meta: dict[str, Any] | None,
    motion: float,
    *,
    tracked: set[str],
    motion_threshold: float,
) -> tuple[str, list[str], dict[str, Any]]:
    """Classify a single frame as one of three states:

      'active'        - something is happening (motion, person flip, new tracked
                        label).  Always kept.
      'person_still'  - person is present but nothing is changing
                        (motion below threshold, labels unchanged, no flip).
                        Subject to keepalive-heartbeat thinning.
      'idle'          - no person AND no motion AND no new tracked label.
                        Collapsed to start/end markers only.

    Returns (state, base_reasons, info).  Boundary keep-rules and the
    idle-collapse logic are applied by the caller.
    """
    cur_labels = {str(x).lower() for x in (fmeta.get("labels") or [])}
    prev_labels = (
        {str(x).lower() for x in (prev_kept_meta.get("labels") or [])}
        if prev_kept_meta
        else set()
    )

    cur_person = "person" in cur_labels
    prev_person = "person" in prev_labels
    person_flip = (cur_person != prev_person)
    new_tracked = (cur_labels & tracked) - prev_labels
    motion_active = motion >= motion_threshold

    reasons: list[str] = []
    if motion_active:
        reasons.append(f"motion={motion:.4f}>=thr")
    if new_tracked:
        reasons.append(f"new_tracked={sorted(new_tracked)}")
    if person_flip:
        reasons.append(f"person_flip={prev_person}->{cur_person}")

    if motion_active or new_tracked or person_flip:
        state = "active"
    elif cur_person:
        state = "person_still"
    else:
        state = "idle"

    info = {
        "has_person": cur_person,
        "new_tracked": sorted(new_tracked),
        "motion_active": motion_active,
        "person_flip": person_flip,
    }
    return state, reasons, info


def _apply_fall_precursor_keep(
    decisions: list[dict[str, Any]],
    *,
    lookback_sec: float,
    forward_sec: float,
) -> int:
    """When Step-1 loses ``person`` (common during falls), force-keep recent
    person anchors and a short forward window so pose_detection still runs."""
    n_added = 0
    for idx in range(1, len(decisions)):
        prev_labels = {str(x).lower() for x in (decisions[idx - 1].get("labels") or [])}
        cur_labels = {str(x).lower() for x in (decisions[idx].get("labels") or [])}
        if "person" not in prev_labels or "person" in cur_labels:
            continue
        loss_ts = float(decisions[idx]["ts_sec"])
        cutoff = loss_ts - lookback_sec
        for j in range(idx):
            dj = decisions[j]
            if "person" not in {str(x).lower() for x in (dj.get("labels") or [])}:
                continue
            if float(dj["ts_sec"]) < cutoff:
                continue
            if not dj["kept"]:
                dj["kept"] = True
                dj["reasons"].append(f"fall_precursor_lookback={lookback_sec:.1f}s")
                n_added += 1
        for j in range(idx, len(decisions)):
            dj = decisions[j]
            if float(dj["ts_sec"]) - loss_ts > forward_sec:
                break
            if not dj["kept"]:
                dj["kept"] = True
                dj["reasons"].append(f"fall_precursor_forward={forward_sec:.1f}s")
                n_added += 1
    return n_added


def _rebuild_active_list(decisions: list[dict[str, Any]]) -> list[str]:
    active_list: list[str] = []
    seen: set[str] = set()
    for d in decisions:
        if not d.get("kept"):
            continue
        name = str(d.get("sample_frame") or "")
        if not name or name in seen:
            continue
        seen.add(name)
        active_list.append(name)
    return active_list


# =============================================================================
#  main
# =============================================================================

def reduce_run(
    run_dir: Path,
    *,
    tracked_classes: list[str],
    motion_threshold: float,
    keepalive_sec: float,
    fall_lookback_sec: float = 3.0,
    fall_forward_sec: float = 2.0,
    out_dir_name: str = "reduced",
) -> int:
    step1 = _load_json(run_dir / "detections" / "detections.json")
    if not step1 or not step1.get("frames"):
        print(f"[ERROR] Step 1 detections.json not found under {run_dir / 'detections'}.")
        print("Run first: python ai/models/SCVAM2.1/dectator.py")
        return 1

    frames_meta: list[dict[str, Any]] = list(step1.get("frames") or [])
    frames_meta.sort(key=lambda r: int(r.get("src_index") or 0))

    frames_dir = run_dir / "frames"
    if not frames_dir.is_dir():
        print(f"[WARN] {frames_dir} not found; motion will be 0.0 for every frame.")

    tracked = {c.strip().lower() for c in tracked_classes if c.strip()}

    out_dir = run_dir / out_dir_name
    out_dir.mkdir(parents=True, exist_ok=True)

    print(
        f"Reducing {len(frames_meta)} anchor frames\n"
        f"  motion_threshold: {motion_threshold}\n"
        f"  keepalive_sec:    {keepalive_sec}\n"
        f"  tracked_classes:  {sorted(tracked)}\n"
        f"  frames_dir:       {frames_dir}\n"
        f"  out_dir:          {out_dir}"
    )

    decisions: list[dict[str, Any]] = []
    n_total = len(frames_meta)

    # ---- Pass 1: classify each frame.
    # Motion vs last *active-or-first* frame can drift during long static episodes
    # (codec noise / exposure).  We also compute adjacent-frame motion and take
    # min(...) so "activity" requires both to exceed the threshold (reduces false
    # active states from stale references).
    prev_kept_meta: dict[str, Any] | None = None
    prev_kept_gray: np.ndarray | None = None
    prev_anchor_gray: np.ndarray | None = None

    for idx, fmeta in enumerate(frames_meta):
        sample_name = str(fmeta.get("frame") or "").strip()
        ts_sec = float(fmeta.get("ts_sec") or 0.0)
        src_index = int(fmeta.get("src_index") or 0)

        curr_gray = _read_gray_small(frames_dir / sample_name)
        motion_since_kept = _motion_score(prev_kept_gray, curr_gray)
        motion_adjacent = (
            _motion_score(prev_anchor_gray, curr_gray) if idx > 0 else motion_since_kept
        )
        if idx == 0:
            motion = motion_since_kept
        else:
            motion = min(motion_since_kept, motion_adjacent)

        state, base_reasons, _info = _classify(
            fmeta,
            prev_kept_meta,
            motion,
            tracked=tracked,
            motion_threshold=motion_threshold,
        )

        decisions.append(
            {
                "sample_frame": sample_name,
                "ts_sec": round(ts_sec, 4),
                "src_index": src_index,
                "labels": list(fmeta.get("labels") or []),
                "motion": round(motion, 5),
                "motion_since_kept": round(motion_since_kept, 5),
                "motion_adjacent": round(motion_adjacent, 5) if idx > 0 else None,
                "state": state,
                "kept": False,             # filled in by pass 2
                "reasons": list(base_reasons),
            }
        )

        if curr_gray is not None:
            prev_anchor_gray = curr_gray

        if state == "active" or idx == 0:
            prev_kept_meta = fmeta
            if curr_gray is not None:
                prev_kept_gray = curr_gray

    # ---- Pass 2: apply boundaries, idle-collapse, and person-still keepalive.
    active_list: list[str] = []
    last_kept_ts: float | None = None
    in_idle_run = False
    idle_run_start_idx: int | None = None
    idle_pending_end_idx: int | None = None
    idle_intervals: list[dict[str, Any]] = []

    def _flush_idle_end(end_idx: int) -> None:
        d = decisions[end_idx]
        if not d["kept"]:
            d["kept"] = True
            d["reasons"].append("idle_end")
            active_list.append(d["sample_frame"])

    def _record_interval(start_idx: int, end_idx: int) -> None:
        s = decisions[start_idx]
        e = decisions[end_idx]
        idle_intervals.append(
            {
                "start_sample": s["sample_frame"],
                "end_sample": e["sample_frame"],
                "start_ts_sec": float(s["ts_sec"]),
                "end_ts_sec": float(e["ts_sec"]),
                "duration_sec": round(
                    max(0.0, float(e["ts_sec"]) - float(s["ts_sec"])), 3
                ),
                "n_frames": end_idx - start_idx + 1,
            }
        )

    for idx, d in enumerate(decisions):
        state = d["state"]
        is_first = idx == 0
        is_last = idx == n_total - 1

        if state == "active":
            if in_idle_run and idle_pending_end_idx is not None and idle_run_start_idx is not None:
                _flush_idle_end(idle_pending_end_idx)
                _record_interval(idle_run_start_idx, idle_pending_end_idx)
            in_idle_run = False
            idle_run_start_idx = None
            idle_pending_end_idx = None

            d["kept"] = True
            if is_first and "first_frame" not in d["reasons"]:
                d["reasons"].insert(0, "first_frame")
            active_list.append(d["sample_frame"])
            last_kept_ts = float(d["ts_sec"])

        elif state == "person_still":
            if in_idle_run and idle_pending_end_idx is not None and idle_run_start_idx is not None:
                _flush_idle_end(idle_pending_end_idx)
                _record_interval(idle_run_start_idx, idle_pending_end_idx)
            in_idle_run = False
            idle_run_start_idx = None
            idle_pending_end_idx = None

            ts = float(d["ts_sec"])
            keep = is_first or is_last or last_kept_ts is None
            if keep and last_kept_ts is None:
                d["reasons"].append("first_kept_after_start")
            if not keep and last_kept_ts is not None:
                gap = ts - last_kept_ts
                if gap >= keepalive_sec:
                    keep = True
                    d["reasons"].append(f"keepalive_gap={gap:.2f}s")
            if keep:
                d["kept"] = True
                if is_first and "first_frame" not in d["reasons"]:
                    d["reasons"].insert(0, "first_frame")
                active_list.append(d["sample_frame"])
                last_kept_ts = ts
            else:
                d["reasons"].append("person_still_thinned")

        else:  # state == "idle"
            if not in_idle_run:
                in_idle_run = True
                idle_run_start_idx = idx
                idle_pending_end_idx = idx
                d["kept"] = True
                d["reasons"].insert(0, "idle_start")
                if is_first and "first_frame" not in d["reasons"]:
                    d["reasons"].insert(0, "first_frame")
                active_list.append(d["sample_frame"])
                last_kept_ts = float(d["ts_sec"])
            else:
                idle_pending_end_idx = idx
                d["reasons"].append("idle_collapsed")
                if is_last:
                    _flush_idle_end(idx)
                    if idle_run_start_idx is not None:
                        _record_interval(idle_run_start_idx, idx)
                    in_idle_run = False
                    idle_run_start_idx = None
                    idle_pending_end_idx = None

        # Force-keep the very last frame so the timeline always closes cleanly.
        if is_last and not d["kept"]:
            d["kept"] = True
            d["reasons"].append("forced_last_frame")
            active_list.append(d["sample_frame"])

    # Flush a trailing idle run if we ended inside one.
    if in_idle_run and idle_run_start_idx is not None and idle_pending_end_idx is not None:
        _flush_idle_end(idle_pending_end_idx)
        _record_interval(idle_run_start_idx, idle_pending_end_idx)

    n_fall_precursor = _apply_fall_precursor_keep(
        decisions,
        lookback_sec=fall_lookback_sec,
        forward_sec=fall_forward_sec,
    )
    active = _rebuild_active_list(decisions)

    n_kept = sum(1 for d in decisions if d["kept"])
    n_dropped = n_total - n_kept
    saved_pct = (100.0 * n_dropped / n_total) if n_total else 0.0

    state_counts: dict[str, int] = {}
    for d in decisions:
        s = str(d.get("state") or "?")
        state_counts[s] = state_counts.get(s, 0) + 1

    n_idle_collapsed = sum(
        max(0, iv["n_frames"] - 2) for iv in idle_intervals
    )
    summary = {
        "run_dir": run_dir.as_posix(),
        "video": step1.get("video"),
        "tracked_classes": sorted(tracked),
        "motion_threshold": motion_threshold,
        "keepalive_sec": keepalive_sec,
        "fall_lookback_sec": fall_lookback_sec,
        "fall_forward_sec": fall_forward_sec,
        "n_fall_precursor_added": n_fall_precursor,
        "n_total": n_total,
        "n_kept": n_kept,
        "n_dropped": n_dropped,
        "compute_saved_pct_step2_step3": round(saved_pct, 1),
        "state_counts": state_counts,
        "idle_intervals": idle_intervals,
        "n_idle_intervals": len(idle_intervals),
        "n_frames_idle_collapsed": n_idle_collapsed,
        "decisions": decisions,
    }
    (out_dir / "reduction_summary.json").write_text(
        json.dumps(summary, indent=2), encoding="utf-8"
    )
    (out_dir / "active_frames.json").write_text(
        json.dumps(
            {
                "run_dir": run_dir.as_posix(),
                "n_active": len(active),
                "n_total": n_total,
                "active_frames": active,
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    by_reason: dict[str, int] = {}
    for d in decisions:
        if not d["kept"]:
            continue
        for r in d["reasons"]:
            tag = r.split("=", 1)[0]
            by_reason[tag] = by_reason.get(tag, 0) + 1

    print(
        f"\nKept  {n_kept}/{n_total}  ({100.0 - saved_pct:.1f}%)"
        f"  -> Step 2/3 will skip {n_dropped} frames "
        f"(~{saved_pct:.1f}% compute saved)"
    )
    print(f"  states: {state_counts}")
    if idle_intervals:
        idle_total = sum(iv["duration_sec"] for iv in idle_intervals)
        print(
            f"  idle-collapse: {len(idle_intervals)} interval(s) "
            f"({idle_total:.1f}s total, {n_idle_collapsed} frames hidden)"
        )
        for iv in idle_intervals[:3]:
            print(
                f"     {iv['start_sample']} -> {iv['end_sample']}  "
                f"{iv['start_ts_sec']:.2f}s..{iv['end_ts_sec']:.2f}s  "
                f"({iv['duration_sec']:.2f}s, {iv['n_frames']} frames)"
            )
        if len(idle_intervals) > 3:
            print(f"     ...and {len(idle_intervals) - 3} more")
    if by_reason:
        print(f"  kept-by-reason: {by_reason}")
    if n_fall_precursor:
        print(
            f"  fall-precursor: +{n_fall_precursor} frame(s) around person loss "
            f"(lookback={fall_lookback_sec}s forward={fall_forward_sec}s)"
        )
    print(f"Wrote: {out_dir / 'active_frames.json'}")
    print(f"Wrote: {out_dir / 'reduction_summary.json'}")
    return 0


# =============================================================================
#  CLI
# =============================================================================

def _parse_classes(raw: str) -> list[str]:
    return [c.strip() for c in raw.split(",") if c.strip()]


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Step 1c: frame reducer (drop redundant anchors before Step 2/3)."
    )
    parser.add_argument(
        "--run", default="",
        help="Run dir (default: newest under ai/models/SCVAM2.1/output).",
    )
    parser.add_argument(
        "--tracked-classes",
        default=",".join(DEFAULT_TRACKED_CLASSES),
        help="Comma-separated classes whose first appearance forces a keep.",
    )
    parser.add_argument(
        "--motion-threshold", type=float, default=0.015,
        help="Mean abs gray-diff in [0,1] above which the frame is kept "
        "(default 0.015 ~= 4 gray levels per pixel; raise to drop more).",
    )
    parser.add_argument(
        "--keepalive-sec", type=float, default=5.0,
        help="Even in dead periods, keep one heartbeat frame every N seconds "
        "(default 5.0). Set very large to disable.",
    )
    parser.add_argument(
        "--out-dir", default="reduced",
        help="Output subfolder name inside the run dir (default 'reduced').",
    )
    parser.add_argument(
        "--fall-lookback-sec", type=float, default=3.0,
        help="When person disappears, also keep person-labeled anchors this many "
        "seconds before the loss (default 3.0).",
    )
    parser.add_argument(
        "--fall-forward-sec", type=float, default=2.0,
        help="After person disappears, keep anchors this many seconds forward "
        "for pose on the ground (default 2.0).",
    )
    args = parser.parse_args()

    if args.run:
        run_dir = Path(args.run).expanduser().resolve()
    else:
        latest = _newest_run_dir()
        if latest is None:
            print(
                "No --run given and no run dir under "
                "ai/models/SCVAM2.1/output/*/detections/detections.json.\n"
                "Run preprocess.py + dectator.py first."
            )
            return 1
        run_dir = latest

    return reduce_run(
        run_dir,
        tracked_classes=_parse_classes(args.tracked_classes),
        motion_threshold=max(0.0, args.motion_threshold),
        keepalive_sec=max(0.05, args.keepalive_sec),
        fall_lookback_sec=max(0.0, args.fall_lookback_sec),
        fall_forward_sec=max(0.0, args.fall_forward_sec),
        out_dir_name=args.out_dir,
    )


if __name__ == "__main__":
    sys.exit(main())
