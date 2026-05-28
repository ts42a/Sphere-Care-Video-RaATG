"""
Step 6: Event Builder / Risk Engine.

Reads merged/merged_frames.json + merged/temporal.json and emits a discrete
event timeline: one entry per detected interval with start_ts / end_ts /
severity / reasons / supporting_frames. This is the compact, LLM-friendly
view of the run; the LLM does NOT need to read 2400 raw feature rows when
this file exists.

Algorithm
---------
For each event channel `e` in temporal.json's `event_names`:

    1) hysteresis: enter when p[t] >= theta_enter, leave when p[t] < theta_leave.
    2) require minimum run length (default 2 frames @ 2 fps = ~1 s).
    3) merge same-type intervals separated by <= merge_gap frames.
    4) attach severity = max_event_prob * class_weight + 0.3 * max_anomaly.
    5) collect human-readable reasons from merged_signals + obj_in_hand_candidates.
    6) keep top-K supporting frames (highest event prob) as evidence for the LLM.

Run (from repo root):
    python ai/models/SCVAM2.1/risk_engine.py
    python ai/models/SCVAM2.1/risk_engine.py --theta-enter 0.5 --theta-leave 0.25

Outputs:
    merged/events.json
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any

# Class-specific severity multipliers. Higher = more dangerous when the
# channel fires. These are deliberately coarse; tune to your domain.
EVENT_SEVERITY_WEIGHT: dict[str, float] = {
    "person_active":         0.10,
    "hand_visible":          0.10,
    "obj_in_hand":           0.40,
    "sharp_object_in_hand":  1.00,
    "fall_like":             1.00,
    "unstable_gait":         0.60,
    "abnormal_posture":      0.50,
    "prolonged_immobility":  0.85,
    "wandering_like":        0.45,
    "environment_hazard_context": 0.55,
}

# Categories from zoom_evidence's _categorize_label that map to "dangerous"
# in our risk lexicon. Used to enrich reasons.
_DANGEROUS_LABELS: set[str] = {"knife", "scissors", "fork"}


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
        if d.is_dir() and (d / "merged" / "merged_frames.json").is_file()
    ]
    if not candidates:
        return None
    candidates.sort(key=lambda d: d.stat().st_mtime, reverse=True)
    return candidates[0]


# =============================================================================
#  hysteresis
# =============================================================================

def hysteresis_intervals(
    probs: list[float],
    theta_enter: float,
    theta_leave: float,
    min_run: int,
    merge_gap: int,
) -> list[tuple[int, int]]:
    """Return inclusive (start_idx, end_idx) intervals where the channel is on.
    A run starts when probs[t] >= theta_enter and ends when probs[t] < theta_leave.
    Runs shorter than min_run are dropped. Adjacent runs separated by <= merge_gap
    silent frames are merged into one."""
    intervals: list[list[int]] = []
    in_run = False
    start = 0
    for t, p in enumerate(probs):
        if not in_run and p >= theta_enter:
            in_run = True
            start = t
        elif in_run and p < theta_leave:
            length = t - start
            if length >= min_run:
                intervals.append([start, t - 1])
            in_run = False
    if in_run:
        length = len(probs) - start
        if length >= min_run:
            intervals.append([start, len(probs) - 1])

    if merge_gap > 0:
        merged: list[list[int]] = []
        for s, e in intervals:
            if merged and s - merged[-1][1] - 1 <= merge_gap:
                merged[-1][1] = e
            else:
                merged.append([s, e])
        intervals = merged

    return [(s, e) for s, e in intervals]


# =============================================================================
#  event construction
# =============================================================================

def _collect_reasons(
    frame: dict[str, Any],
    event_type: str,
) -> list[str]:
    """Extract human-readable reason strings from the merged frame relevant
    to a particular event_type."""
    reasons: list[str] = []
    ms = frame.get("merged_signals") or {}
    cands = frame.get("obj_in_hand_candidates") or []

    if event_type in {"obj_in_hand", "sharp_object_in_hand"}:
        if ms.get("obj_in_hand_label"):
            grade = ms.get("obj_in_hand_max_conf_grade") or "confirmed"
            reasons.append(
                f"obj_in_hand={ms['obj_in_hand_label']}"
                f" conf={ms.get('obj_in_hand_max_conf')}"
                f" grade={grade}"
            )
        seen: set[str] = set()
        for c in cands[:5]:
            lab = (c.get("label") or "").lower()
            if not lab or lab in seen:
                continue
            seen.add(lab)
            tag = (
                f"candidate={lab} conf={float(c.get('confidence') or 0.0):.2f}"
                f" cat={c.get('category')}"
                f" grade={c.get('confidence_grade') or 'confirmed'}"
            )
            if event_type == "sharp_object_in_hand" and (
                lab in _DANGEROUS_LABELS or c.get("category") == "sharp_object"
            ):
                reasons.append(tag)
            elif event_type == "obj_in_hand":
                reasons.append(tag)

    if event_type == "fall_like":
        fs = ms.get("fall_score")
        if fs is not None:
            reasons.append(f"fall_score={fs}")
        if ms.get("posture") in ("lying", "unknown"):
            reasons.append(f"posture={ms.get('posture')}")
        bend = ms.get("bend_angle_deg")
        if isinstance(bend, (int, float)) and bend > 30:
            reasons.append(f"bend_angle={bend:.1f}deg")

    if event_type == "unstable_gait":
        gs = ms.get("gait_instability_score")
        if gs is not None:
            reasons.append(f"gait_instab={gs}")

    if event_type == "abnormal_posture":
        if ms.get("posture") and ms["posture"] not in ("standing",):
            reasons.append(f"posture={ms['posture']}")
        bend = ms.get("bend_angle_deg")
        if isinstance(bend, (int, float)) and bend > 25:
            reasons.append(f"bend_angle={bend:.1f}deg")

    if event_type == "hand_visible":
        # No special reasoning beyond the channel firing.
        pass

    if event_type == "person_active":
        if ms.get("person_max_conf"):
            reasons.append(f"person_conf={ms['person_max_conf']}")

    if event_type == "prolonged_immobility":
        reasons.append("proxy=ac_immobility_proxy (rolling low limb motion + seated/lying)")
        if ms.get("posture"):
            reasons.append(f"posture={ms.get('posture')}")

    if event_type == "wandering_like":
        reasons.append("proxy=ac_wandering_proxy (rolling variability of hip height / movement)")

    if event_type == "environment_hazard_context":
        reasons.append("proxy=ac_home_hazard_proxy (object load + gait instability)")
        oc = ms.get("object_count")
        if oc is not None:
            reasons.append(f"object_count={oc}")

    return reasons


def _evidence_for_interval(
    s: int,
    e: int,
    probs: list[float],
    frames: list[dict[str, Any]],
    tframes: list[dict[str, Any]],
    *,
    top_k: int,
    event_type: str,
) -> tuple[list[dict[str, Any]], list[str]]:
    """Pick top_k frames with the highest channel prob inside [s, e],
    return the structured evidence rows + the union of reason strings."""
    ranked = sorted(range(s, e + 1), key=lambda i: probs[i], reverse=True)[:top_k]
    ranked.sort()  # restore chronological order in the evidence list
    ev: list[dict[str, Any]] = []
    reasons_set: list[str] = []
    seen_reasons: set[str] = set()
    for i in ranked:
        fr = frames[i]
        tf = tframes[i]
        ms = fr.get("merged_signals") or {}
        ev.append(
            {
                "sample_frame": fr["sample_frame"],
                "sample_ts_sec": fr["sample_ts_sec"],
                "event_prob": round(float(probs[i]), 3),
                "anomaly_score": round(float(tf.get("anomaly_score") or 0.0), 3),
                "obj_in_hand_label_set": fr.get("obj_in_hand_label_set"),
                "obj_in_hand_category_set": fr.get("obj_in_hand_category_set"),
                "posture": ms.get("posture"),
                "fall_score": ms.get("fall_score"),
                "gait_instability_score": ms.get("gait_instability_score"),
                "hands_visible": ms.get("hands_visible"),
                "obj_in_hand_label": ms.get("obj_in_hand_label"),
                "obj_in_hand_raw_label": ms.get("obj_in_hand_raw_label"),
                "obj_in_hand_max_conf": ms.get("obj_in_hand_max_conf"),
                "obj_in_hand_max_conf_grade": ms.get(
                    "obj_in_hand_max_conf_grade"
                ),
            }
        )
        for r in _collect_reasons(fr, event_type):
            if r not in seen_reasons:
                seen_reasons.add(r)
                reasons_set.append(r)
    return ev, reasons_set


def _interval_object_grade(
    s: int,
    e: int,
    frames: list[dict[str, Any]],
    event_type: str,
) -> tuple[str | None, str | None, str | None]:
    """For obj_in_hand / sharp_object_in_hand events, return
    (grade, dominant_label, dominant_category) summarising the strongest
    contributing held-object hit across [s, e]. ``grade`` is 'confirmed'
    when any frame in the interval has a confirmed hit, otherwise
    'possible' if any possible hit exists, otherwise None. The label /
    category come from the highest-confidence frame that matches the
    chosen grade."""
    if event_type not in {"obj_in_hand", "sharp_object_in_hand"}:
        return None, None, None
    best_conf = -1.0
    best_label: str | None = None
    best_category: str | None = None
    saw_confirmed = False
    saw_possible = False
    for i in range(s, e + 1):
        ms = (frames[i].get("merged_signals") or {})
        if not ms.get("obj_in_hand"):
            continue
        grade = (ms.get("obj_in_hand_max_conf_grade") or "confirmed").lower()
        if grade == "confirmed":
            saw_confirmed = True
        elif grade == "possible":
            saw_possible = True
        try:
            c = float(ms.get("obj_in_hand_max_conf") or 0.0)
        except Exception:
            c = 0.0
        if c > best_conf:
            best_conf = c
            best_label = ms.get("obj_in_hand_label")
            best_category = ms.get("obj_in_hand_category")
    if saw_confirmed:
        return "confirmed", best_label, best_category
    if saw_possible:
        return "possible", best_label, best_category
    return None, best_label, best_category


def build_events(
    merged: dict[str, Any],
    temporal: dict[str, Any],
    *,
    theta_enter: float = 0.6,
    theta_leave: float = 0.3,
    min_run: int = 2,
    merge_gap: int = 4,
    evidence_top_k: int = 3,
) -> list[dict[str, Any]]:
    frames = merged["frames"]
    tframes = temporal["frames"]
    event_names = temporal["event_names"]
    if len(frames) != len(tframes):
        print(
            f"[WARN] merged frames ({len(frames)}) != temporal frames ({len(tframes)});"
            f" will iterate up to the shorter."
        )
    n = min(len(frames), len(tframes))
    frames = frames[:n]
    tframes = tframes[:n]

    per_channel: dict[str, list[float]] = defaultdict(list)
    for tf in tframes:
        ep = tf.get("event_probs") or {}
        for name in event_names:
            per_channel[name].append(float(ep.get(name) or 0.0))

    events: list[dict[str, Any]] = []
    for ch, probs in per_channel.items():
        for s, e in hysteresis_intervals(
            probs, theta_enter, theta_leave, min_run, merge_gap
        ):
            window_max_p = max(probs[s : e + 1])
            window_anomaly = max(
                float(tframes[i].get("anomaly_score") or 0.0) for i in range(s, e + 1)
            )
            severity = round(
                window_max_p * EVENT_SEVERITY_WEIGHT.get(ch, 0.3)
                + 0.3 * window_anomaly,
                3,
            )

            evidence, reasons = _evidence_for_interval(
                s, e, probs, frames, tframes,
                top_k=evidence_top_k, event_type=ch,
            )

            grade, dom_label, dom_category = _interval_object_grade(
                s, e, frames, ch
            )

            event_record: dict[str, Any] = {
                "event_type": ch,
                "start_ts_sec": float(frames[s]["sample_ts_sec"]),
                "end_ts_sec": float(frames[e]["sample_ts_sec"]),
                "duration_sec": round(
                    float(frames[e]["sample_ts_sec"]) - float(frames[s]["sample_ts_sec"]),
                    3,
                ),
                "frame_index_span": [int(s), int(e)],
                "n_frames": int(e - s + 1),
                "severity": severity,
                "max_event_prob": round(window_max_p, 3),
                "max_anomaly": round(window_anomaly, 3),
                "reasons": reasons,
                "evidence": evidence,
            }
            if grade is not None:
                event_record["confidence_grade"] = grade
                event_record["object_label"] = dom_label
                event_record["object_category"] = dom_category
            events.append(event_record)

    events.sort(key=lambda x: (x["start_ts_sec"], -x["severity"]))
    return events


# =============================================================================
#  CLI
# =============================================================================

def main() -> int:
    parser = argparse.ArgumentParser(
        description="Step 6: Event Builder / Risk Engine over temporal.json."
    )
    parser.add_argument(
        "--merged",
        default="",
        help="Path to merged/merged_frames.json. Default: newest run dir.",
    )
    parser.add_argument(
        "--temporal",
        default="",
        help="Path to merged/temporal.json. Default: sibling of --merged.",
    )
    parser.add_argument(
        "--out",
        default="",
        help="Output path (default: sibling events.json next to merged).",
    )
    parser.add_argument("--theta-enter", type=float, default=0.6)
    parser.add_argument("--theta-leave", type=float, default=0.3)
    parser.add_argument(
        "--min-run", type=int, default=2,
        help="Minimum number of consecutive 'on' frames to count as an event "
        "(default 2 = ~1 s at 2 fps).",
    )
    parser.add_argument(
        "--merge-gap", type=int, default=4,
        help="Merge same-channel events separated by <= this many silent frames "
        "(default 4 = ~2 s at 2 fps).",
    )
    parser.add_argument(
        "--evidence-top-k", type=int, default=3,
        help="How many supporting frames to attach per event (default 3).",
    )
    args = parser.parse_args()

    if args.merged:
        merged_path = Path(args.merged).expanduser().resolve()
    else:
        latest = _newest_run_dir()
        if latest is None:
            print(
                "No --merged and no run dir under "
                "ai/models/SCVAM2.1/output/*/merged/merged_frames.json.\n"
                "Run merge_frames.py + temporal_grn.py first."
            )
            return 1
        merged_path = latest / "merged" / "merged_frames.json"

    if not merged_path.is_file():
        print(f"[ERROR] merged_frames.json not found at {merged_path}")
        return 1

    if args.temporal:
        temporal_path = Path(args.temporal).expanduser().resolve()
    else:
        temporal_path = merged_path.with_name("temporal.json")
    if not temporal_path.is_file():
        print(
            f"[ERROR] temporal.json not found at {temporal_path}\n"
            "Run first: python ai/models/SCVAM2.1/temporal_grn.py"
        )
        return 1

    merged = json.loads(merged_path.read_text(encoding="utf-8"))
    temporal = json.loads(temporal_path.read_text(encoding="utf-8"))

    events = build_events(
        merged,
        temporal,
        theta_enter=args.theta_enter,
        theta_leave=args.theta_leave,
        min_run=max(1, args.min_run),
        merge_gap=max(0, args.merge_gap),
        evidence_top_k=max(1, args.evidence_top_k),
    )

    out_path = (
        Path(args.out).expanduser().resolve()
        if args.out
        else merged_path.with_name("events.json")
    )

    by_type: dict[str, int] = {}
    max_severity: dict[str, float] = {}
    for ev in events:
        by_type[ev["event_type"]] = by_type.get(ev["event_type"], 0) + 1
        max_severity[ev["event_type"]] = max(
            max_severity.get(ev["event_type"], 0.0), float(ev["severity"])
        )

    payload = {
        "merged_path": merged_path.as_posix(),
        "temporal_path": temporal_path.as_posix(),
        "video": merged.get("video"),
        "src_fps": merged.get("src_fps"),
        "thresholds": {
            "theta_enter": args.theta_enter,
            "theta_leave": args.theta_leave,
            "min_run": args.min_run,
            "merge_gap": args.merge_gap,
            "evidence_top_k": args.evidence_top_k,
        },
        "n_events": len(events),
        "events_by_type": by_type,
        "max_severity_by_type": {k: round(v, 3) for k, v in max_severity.items()},
        "events": events,
    }
    out_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")

    print(
        f"Wrote {out_path}  events={len(events)}  by_type={by_type}"
    )
    if max_severity:
        worst = max(events, key=lambda e: e["severity"])
        print(
            f"  worst event: {worst['event_type']} severity={worst['severity']} "
            f"@ {worst['start_ts_sec']:.2f}-{worst['end_ts_sec']:.2f}s"
        )
        if worst.get("reasons"):
            print(f"    reasons: {', '.join(worst['reasons'][:5])}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
