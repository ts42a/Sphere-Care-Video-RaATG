from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Dict, List, Set

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.services.ai.vision.zones import load_zone_defs
from ai.training.ai_flags.layers import (
    AlphaPathProcessor,
    BetaCreation,
    BranchDecision,
    CandidateLayer,
    DataQualityGate,
    FrameSelector,
    IngestLayer,
    ObservationPathProcessor,
    PerceptionLayer,
    RiskTriage,
)

_STAGE_ORDER = {
    "ingest": 1,
    "quality": 2,
    "select": 3,
    "detect": 5,
    "candidate": 7,
    "beta": 8,
    "triage": 10,
    "branch": 11,
    "incident": 12,
    "summary": 13,
    "all": 99,
}


def _stage_ge(current: str, target: str) -> bool:
    return _STAGE_ORDER.get(current, 99) >= _STAGE_ORDER.get(target, 0)


def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description="Terminal tester for Ingest -> ... -> Branch Decision (Layer 11)."
    )
    p.add_argument("--source", help="Video source path (file/stream URI).")
    p.add_argument(
        "--stage",
        choices=(
            "ingest",
            "quality",
            "select",
            "detect",
            "candidate",
            "beta",
            "triage",
            "branch",
            "incident",
            "summary",
            "all",
        ),
        default="all",
        help="Highest stage to execute; default runs through Layer 13A where applicable.",
    )
    p.add_argument("--max-frames", type=int, default=120, help="Maximum ingested frames to inspect.")
    p.add_argument("--max-fps", type=float, default=2.0, help="Ingest target fps.")
    p.add_argument("--max-width", type=int, default=960, help="Ingest max width resize.")

    p.add_argument("--dark-threshold", type=float, default=35.0)
    p.add_argument("--blur-threshold", type=float, default=70.0)
    p.add_argument("--occlusion-threshold", type=float, default=0.80)

    p.add_argument("--min-interval-sec", type=float, default=0.5)
    p.add_argument("--dedupe-threshold", type=float, default=4.0)
    p.add_argument("--burst-threshold", type=float, default=12.0)
    p.add_argument("--burst-frames", type=int, default=2)
    p.add_argument("--show-samples", type=int, default=8, help="Rows to print for sampled output.")
    p.add_argument("--detector", choices=("mock", "yolo"), default="mock", help="Detector backend for layer 4.")
    p.add_argument("--camera-id", type=int, default=0, help="Camera id used for zone tagging.")
    p.add_argument(
        "--fallback-zone",
        default="",
        help="Optional fallback zone label for test mode when detections do not hit configured zones.",
    )
    p.add_argument(
        "--specialist-enabled",
        action=argparse.BooleanOptionalAction,
        default=False,
        help="Enable Layer 5 close-up specialist inference.",
    )
    p.add_argument(
        "--specialist-backend",
        choices=("heuristic", "mediapipe", "auto"),
        default="heuristic",
        help="Layer 5 backend. 'auto' tries mediapipe then falls back to heuristic.",
    )
    p.add_argument(
        "--specialist-interaction-threshold",
        type=float,
        default=0.40,
        help="Threshold used to count specialist interaction frames in terminal summary.",
    )
    p.add_argument(
        "--focus-labels",
        default="person,knife,spill,scissors",
        help="Comma-separated labels to report as risk-focused detections.",
    )
    p.add_argument(
        "--focus-only",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="When true, metrics/sample labels only include focus-label detections.",
    )
    p.add_argument(
        "--interactive",
        action="store_true",
        help="Ask for options in terminal (auto-enabled if --source is missing).",
    )
    return p


def _prompt_str(label: str, default: str) -> str:
    val = input(f"{label} [{default}]: ").strip()
    return val or default


def _prompt_int(label: str, default: int) -> int:
    while True:
        val = input(f"{label} [{default}]: ").strip()
        if not val:
            return default
        try:
            return int(val)
        except ValueError:
            print("Enter a valid integer.")


def _prompt_float(label: str, default: float) -> float:
    while True:
        val = input(f"{label} [{default}]: ").strip()
        if not val:
            return default
        try:
            return float(val)
        except ValueError:
            print("Enter a valid number.")


def _interactive_fill(args: argparse.Namespace) -> argparse.Namespace:
    print("Interactive mode: press Enter to keep default values.")
    args.source = _prompt_str(
        "Source path",
        "video/WhatsApp Video 2026-04-01 at 10.17.46 PM.mp4",
    )
    args.stage = _prompt_str(
        "Stage (ingest|quality|select|detect|candidate|beta|triage|branch|incident|summary|all)",
        str(args.stage or "all"),
    )
    if args.stage not in {
        "ingest",
        "quality",
        "select",
        "detect",
        "candidate",
        "beta",
        "triage",
        "branch",
        "incident",
        "summary",
        "all",
    }:
        print("Invalid stage, using default 'all'.")
        args.stage = "all"

    args.max_frames = _prompt_int("Max frames", int(args.max_frames))
    args.max_fps = _prompt_float("Max FPS", float(args.max_fps))
    args.max_width = _prompt_int("Max width", int(args.max_width))

    args.dark_threshold = _prompt_float("Dark threshold", float(args.dark_threshold))
    args.blur_threshold = _prompt_float("Blur threshold", float(args.blur_threshold))
    args.occlusion_threshold = _prompt_float("Occlusion threshold", float(args.occlusion_threshold))

    args.min_interval_sec = _prompt_float("Selector min interval (sec)", float(args.min_interval_sec))
    args.dedupe_threshold = _prompt_float("Selector dedupe threshold", float(args.dedupe_threshold))
    args.burst_threshold = _prompt_float("Selector burst threshold", float(args.burst_threshold))
    args.burst_frames = _prompt_int("Selector burst frames", int(args.burst_frames))
    args.detector = _prompt_str("Detector (mock|yolo)", str(args.detector or "mock"))
    if args.detector not in {"mock", "yolo"}:
        print("Invalid detector, using default 'mock'.")
        args.detector = "mock"
    args.camera_id = _prompt_int("Camera id", int(args.camera_id))
    args.fallback_zone = _prompt_str("Fallback zone label (blank to disable)", str(args.fallback_zone or ""))
    args.specialist_enabled = bool(
        _prompt_int("Enable specialist (1 yes, 0 no)", 1 if args.specialist_enabled else 0)
    )
    args.specialist_backend = _prompt_str(
        "Specialist backend (heuristic|mediapipe|auto)",
        str(args.specialist_backend or "heuristic"),
    )
    if args.specialist_backend not in {"heuristic", "mediapipe", "auto"}:
        print("Invalid specialist backend, using default 'heuristic'.")
        args.specialist_backend = "heuristic"
    args.specialist_interaction_threshold = _prompt_float(
        "Specialist interaction threshold",
        float(args.specialist_interaction_threshold),
    )
    args.focus_labels = _prompt_str("Focus labels (comma-separated)", str(args.focus_labels))
    args.focus_only = bool(_prompt_int("Focus-only mode (1 yes, 0 no)", 1 if args.focus_only else 0))
    args.show_samples = _prompt_int("Show sample rows", int(args.show_samples))
    return args


def _parse_focus_labels(raw: str) -> Set[str]:
    return {x.strip().lower() for x in str(raw).split(",") if x.strip()}


def _sample_priority(row: Dict[str, object]) -> tuple:
    return (
        int(bool(row.get("candidate_created", False))),
        int(float(row.get("specialist_interaction_conf", 0.0)) >= 0.40),
        int(bool(row.get("focus_hits"))),
        int(float(row.get("detections", 0)) > 0),
        int(bool(row.get("selected", False))),
        float(row.get("specialist_interaction_conf", 0.0)),
        float(row.get("specialist_hand_conf", 0.0)),
        float(row.get("detections", 0.0)),
        -float(row.get("ts", 0.0)),
    )


def _triage_reason(level: str, triage_meta: Dict[str, object]) -> str:
    repeated = bool(triage_meta.get("repeated", False))
    duration_ok = bool(triage_meta.get("duration_ok", False))
    quality_ok = bool(triage_meta.get("quality_ok", True))
    adjusted = float(triage_meta.get("adjusted_confidence", 0.0))
    if level == "alpha":
        return "alpha: thresholds and temporal rules passed"
    reasons = []
    if not (repeated or duration_ok):
        reasons.append("missing repetition/duration")
    if not quality_ok:
        reasons.append("low visibility penalty")
    if adjusted < 0.65:
        reasons.append("adjusted confidence below alpha threshold")
    return "; ".join(reasons) if reasons else "kept beta by triage rules"


def _print_header(args: argparse.Namespace) -> None:
    print("=" * 72)
    print("AI Flags Layered Pipeline Test (up to 13A)")
    print("=" * 72)
    print(f"Source: {args.source}")
    print(
        f"Config: stage={args.stage}, max_frames={args.max_frames}, "
        f"max_fps={args.max_fps}, max_width={args.max_width}"
    )
    print(
        "Selector: "
        f"min_interval={args.min_interval_sec}, dedupe={args.dedupe_threshold}, "
        f"burst_threshold={args.burst_threshold}, burst_frames={args.burst_frames}"
    )
    print(f"Detector: kind={args.detector}, camera_id={args.camera_id}")
    if args.fallback_zone:
        print(f"Fallback zone: {args.fallback_zone}")
    print(
        f"Specialist enabled: {args.specialist_enabled}, "
        f"backend={args.specialist_backend}, "
        f"interaction_threshold={args.specialist_interaction_threshold}"
    )
    print(f"Focus labels: {args.focus_labels} | focus_only={args.focus_only}")
    print("-" * 72)


def run(args: argparse.Namespace) -> int:
    focus_labels = _parse_focus_labels(args.focus_labels)
    zone_defs = load_zone_defs()
    camera_zone_defs = ((zone_defs.get("cameras") or {}).get(str(args.camera_id)) or {}).get("zones") or {}
    ingest = IngestLayer(args.source, max_fps=args.max_fps, max_width=args.max_width)
    quality = DataQualityGate(
        dark_threshold=args.dark_threshold,
        blur_threshold=args.blur_threshold,
        occlusion_ratio_threshold=args.occlusion_threshold,
    )
    selector = FrameSelector(
        min_interval_sec=args.min_interval_sec,
        dedupe_threshold=args.dedupe_threshold,
        burst_motion_threshold=args.burst_threshold,
        burst_frames=args.burst_frames,
    )
    try:
        perception = PerceptionLayer(
            detector_kind=args.detector,
            camera_id=args.camera_id,
            strict_detector=(args.detector == "yolo"),
            specialist_enabled=args.specialist_enabled,
            specialist_backend=args.specialist_backend,
        )
    except RuntimeError as exc:
        print(f"Detector setup failed: {exc}")
        return 2

    counts: Dict[str, int] = {
        "ingested": 0,
        "low_visibility": 0,
        "too_dark": 0,
        "too_blurry": 0,
        "occluded": 0,
        "selected": 0,
        "detected_frames": 0,
        "detections_total": 0,
        "focus_detected_frames": 0,
        "focus_detections_total": 0,
        "specialist_frames": 0,
        "specialist_interaction_frames": 0,
        "candidates": 0,
        "betas": 0,
        "triaged_beta": 0,
        "triaged_alpha": 0,
        "frames_with_known_zone": 0,
        "frames_with_unknown_zone": 0,
        "fallback_zone_applied": 0,
    }
    sample_rows: List[Dict[str, object]] = []
    selected_facts = []

    for frame in ingest.iter_frames():
        if counts["ingested"] >= args.max_frames:
            break

        counts["ingested"] += 1
        if args.stage == "ingest":
            sample_rows.append(
                {
                    "idx": frame.index,
                    "ts": round(frame.ts, 3),
                    "w": frame.metadata.get("width"),
                    "h": frame.metadata.get("height"),
                }
            )
            continue

        qf = quality.evaluate(frame)
        flags = qf.quality_flags
        if flags.get("too_dark"):
            counts["too_dark"] += 1
        if flags.get("too_blurry"):
            counts["too_blurry"] += 1
        if flags.get("occluded"):
            counts["occluded"] += 1
        if flags.get("low_visibility"):
            counts["low_visibility"] += 1

        if args.stage == "quality":
            sample_rows.append(
                {
                    "idx": frame.index,
                    "ts": round(frame.ts, 3),
                    "low_visibility": bool(flags.get("low_visibility", False)),
                    "brightness": round(float(qf.quality_scores.get("brightness", 0.0)), 2),
                    "blur_var": round(float(qf.quality_scores.get("blur_var", 0.0)), 2),
                }
            )
            continue

        selected = selector.should_select(qf)
        if selected:
            counts["selected"] += 1
        if args.stage == "select":
            sample_rows.append(
                {
                    "idx": frame.index,
                    "ts": round(frame.ts, 3),
                    "low_visibility": bool(flags.get("low_visibility", False)),
                    "selected": selected,
                }
            )
            continue

        if not selected:
            sample_rows.append(
                {
                    "idx": frame.index,
                    "ts": round(frame.ts, 3),
                    "selected": False,
                    "detections": 0,
                    "labels": [],
                }
            )
            continue

        fact = perception.process(qf)
        if not fact.zone_hits and args.fallback_zone:
            fact.zone_hits = [str(args.fallback_zone)]
            counts["fallback_zone_applied"] += 1
        if fact.zone_hits:
            counts["frames_with_known_zone"] += 1
        else:
            counts["frames_with_unknown_zone"] += 1
        selected_facts.append(fact)
        labels_all: List[str] = [str(d.get("label", "")).lower() for d in fact.detections]
        labels = [l for l in labels_all if l in focus_labels] if args.focus_only else labels_all
        det_count = len(labels)
        focus_hits = [l for l in labels if l in focus_labels]
        specialist = fact.specialist or {}
        interaction_conf = float(specialist.get("interaction_conf", 0.0))
        hand_conf = float(specialist.get("hand_conf", 0.0))
        specialist_backend_used = str(specialist.get("backend_used", specialist.get("backend", "none")))
        if bool(specialist.get("enabled", False)):
            counts["specialist_frames"] += 1
            if interaction_conf >= float(args.specialist_interaction_threshold):
                counts["specialist_interaction_frames"] += 1
        counts["detections_total"] += det_count
        if det_count > 0:
            counts["detected_frames"] += 1
        counts["focus_detections_total"] += len(focus_hits)
        if focus_hits:
            counts["focus_detected_frames"] += 1
        sample_rows.append(
            {
                "idx": frame.index,
                "ts": round(frame.ts, 3),
                "low_visibility": bool(flags.get("low_visibility", False)),
                "selected": True,
                "detections": det_count,
                "labels": labels[:5],
                "focus_hits": focus_hits[:5],
                "zone_hits": fact.zone_hits[:5],
                "specialist_hand_conf": round(hand_conf, 3),
                "specialist_interaction_conf": round(interaction_conf, 3),
                "specialist_action": str(specialist.get("action_label", "none")),
                "specialist_backend_used": specialist_backend_used,
                "candidate_created": False,
            }
        )

    candidate_rows: List[Dict[str, object]] = []
    beta_rows: List[Dict[str, object]] = []
    triage_rows: List[Dict[str, object]] = []
    branch_info: Dict[str, object] = {}
    branch_output: Dict[str, object] = {}
    if _stage_ge(args.stage, "candidate"):
        candidate_layer = CandidateLayer()
        beta_layer = BetaCreation()
        triage_layer = RiskTriage()

        candidates = []
        for fact in selected_facts:
            candidates.extend(candidate_layer.process(fact))
        betas = beta_layer.create(candidates)
        triaged = triage_layer.process(betas)

        counts["candidates"] = len(candidates)
        counts["betas"] = len(betas)
        counts["triaged_alpha"] = sum(1 for x in triaged if x.level == "alpha")
        counts["triaged_beta"] = sum(1 for x in triaged if x.level == "beta")
        decision = BranchDecision.from_triaged(triaged)
        branch_info = {"alpha_count": decision.alpha_count, "branch": decision.branch}
        if decision.branch == "alpha_path":
            branch_output = AlphaPathProcessor().process(triaged)
        else:
            branch_output = ObservationPathProcessor().process(triaged)

        candidate_keys = {(round(float(c.ts), 3), c.event_type) for c in candidates}
        for row in sample_rows:
            row["candidate_created"] = any(
                round(float(row.get("ts", 0.0)), 3) == ts for ts, _etype in candidate_keys
            )
        sample_rows = sorted(sample_rows, key=_sample_priority, reverse=True)[: args.show_samples]

        candidate_rows = [
            {
                "event_type": c.event_type,
                "ts": round(float(c.ts), 3),
                "zone": c.zone,
                "raw_conf": round(float(c.raw_confidence), 3),
            }
            for c in candidates[: args.show_samples]
        ]
        beta_rows = [
            {
                "beta_id": b.beta_id,
                "event_type": b.event_type,
                "ts": round(float(b.ts), 3),
                "zone": b.zone,
                "conf": round(float(b.confidence), 3),
            }
            for b in betas[: args.show_samples]
        ]
        triage_rows = [
            {
                "event_id": t.event_id,
                "level": t.level,
                "event_type": t.event_type,
                "ts": round(float(t.ts), 3),
                "zone": t.zone,
                "conf": round(float(t.confidence), 3),
                "triage_calibrated_conf": round(float((t.evidence.get("triage") or {}).get("calibrated_confidence", 0.0)), 3),
                "triage_adjusted_conf": round(float((t.evidence.get("triage") or {}).get("adjusted_confidence", 0.0)), 3),
                "repeated": bool((t.evidence.get("triage") or {}).get("repeated", False)),
                "duration_ok": bool((t.evidence.get("triage") or {}).get("duration_ok", False)),
                "quality_ok": bool((t.evidence.get("triage") or {}).get("quality_ok", True)),
                "agreement": round(float((t.evidence.get("triage") or {}).get("agreement", 0.0)), 3),
                "interaction_conf": round(float((t.evidence.get("triage") or {}).get("interaction_conf", 0.0)), 3),
                "hand_conf": round(float((t.evidence.get("triage") or {}).get("hand_conf", 0.0)), 3),
                "proximity_score": round(float((t.evidence.get("triage") or {}).get("proximity_score", 0.0)), 3),
                "reason": _triage_reason(t.level, (t.evidence.get("triage") or {})),
            }
            for t in triaged[: args.show_samples]
        ]
    else:
        sample_rows = sorted(sample_rows, key=_sample_priority, reverse=True)[: args.show_samples]

    if counts["ingested"] == 0:
        print("No frames ingested. Check --source path/stream.")
        return 1

    print("Summary:")
    print(f"- Ingested frames: {counts['ingested']}")
    if _stage_ge(args.stage, "detect"):
        print(
            f"- Detector backend: requested={args.detector}, "
            f"actual={perception.actual_detector_kind}"
        )

    if _stage_ge(args.stage, "quality"):
        print(f"- Low visibility frames: {counts['low_visibility']}")
        print(
            f"- Quality flags: dark={counts['too_dark']}, blurry={counts['too_blurry']}, "
            f"occluded={counts['occluded']}"
        )

    if _stage_ge(args.stage, "select"):
        pct = (100.0 * counts["selected"] / counts["ingested"]) if counts["ingested"] else 0.0
        print(f"- Selected frames: {counts['selected']} ({pct:.1f}%)")
    if _stage_ge(args.stage, "detect"):
        if counts["selected"] > 0:
            avg = counts["detections_total"] / counts["selected"]
            focus_avg = counts["focus_detections_total"] / counts["selected"]
        else:
            avg = 0.0
            focus_avg = 0.0
        print(f"- Frames with >=1 detection: {counts['detected_frames']}")
        print(f"- Total detections: {counts['detections_total']}")
        print(f"- Avg detections per selected frame: {avg:.2f}")
        print(f"- Focus-hit frames: {counts['focus_detected_frames']}")
        print(f"- Focus detections total: {counts['focus_detections_total']}")
        print(f"- Avg focus detections per selected frame: {focus_avg:.2f}")
        print(
            f"- Zone coverage: configured_zones={len(camera_zone_defs)}, "
            f"known_zone_frames={counts['frames_with_known_zone']}, "
            f"unknown_zone_frames={counts['frames_with_unknown_zone']}"
        )
        if args.fallback_zone:
            print(
                f"- Fallback zone applied: {counts['fallback_zone_applied']} "
                f"(label='{args.fallback_zone}')"
            )
        if args.specialist_enabled:
            print(f"- Specialist-enabled frames: {counts['specialist_frames']}")
            print(
                f"- Specialist interaction frames (>={args.specialist_interaction_threshold}): "
                f"{counts['specialist_interaction_frames']}"
            )
    if _stage_ge(args.stage, "candidate"):
        print(f"- Candidate events: {counts['candidates']}")
    if _stage_ge(args.stage, "beta"):
        print(f"- Beta flags: {counts['betas']}")
    if _stage_ge(args.stage, "triage"):
        print(f"- Triaged beta: {counts['triaged_beta']}")
        print(f"- Triaged alpha: {counts['triaged_alpha']}")
    if _stage_ge(args.stage, "branch"):
        print(
            f"- Branch decision: alpha_count={branch_info.get('alpha_count', 0)}, "
            f"branch={branch_info.get('branch', 'observation_path')}"
        )
    if _stage_ge(args.stage, "incident"):
        incident_count = len(branch_output.get("incident_timeline", []))
        print(f"- Layer 12A incidents: {incident_count}")
        obs_timeline_count = len(branch_output.get("observation_timeline", []))
        obs_chunk_count = len(branch_output.get("general_report", {}).get("chunk_summaries", []))
        print(f"- Layer 12B observation timeline events: {obs_timeline_count}")
        print(f"- Layer 12B chunk summaries: {obs_chunk_count}")
    if _stage_ge(args.stage, "summary"):
        has_summary_prep = bool(branch_output.get("incident_summary_prep"))
        print(f"- Layer 13A summary prep available: {has_summary_prep}")

    print("-" * 72)
    print("Sample rows (layers 1-5):")
    for row in sample_rows:
        print(row)
    if _stage_ge(args.stage, "candidate"):
        print("-" * 72)
        print("Candidate rows (Layer 7):")
        for row in candidate_rows:
            print(row)
    if _stage_ge(args.stage, "beta"):
        print("-" * 72)
        print("Beta rows (Layer 8):")
        for row in beta_rows:
            print(row)
    if _stage_ge(args.stage, "triage"):
        print("-" * 72)
        print("Triage rows (Layer 10):")
        for row in triage_rows:
            print(row)
    if _stage_ge(args.stage, "branch"):
        print("-" * 72)
        print("Branch decision (Layer 11):")
        print(branch_info)
    if _stage_ge(args.stage, "incident"):
        print("-" * 72)
        print("Layer 12A output (Incident Path):")
        if branch_info.get("branch") == "alpha_path":
            timeline = branch_output.get("incident_timeline", [])
            print({"incident_count": len(timeline), "audit": branch_output.get("audit", {})})
            for row in list(timeline)[: args.show_samples]:
                print(row)
        else:
            print("Skipped Layer 12A: branch is observation_path (no alpha events).")
        print("-" * 72)
        print("Layer 12B output (Observation Path):")
        if branch_info.get("branch") == "observation_path":
            obs_timeline = branch_output.get("observation_timeline", [])
            general_report = branch_output.get("general_report", {})
            chunk_summaries = general_report.get("chunk_summaries", [])
            print(
                {
                    "observation_event_count": len(obs_timeline),
                    "chunk_count": len(chunk_summaries),
                    "audit": branch_output.get("audit", {}),
                }
            )
            print("General observation summary:")
            print(general_report.get("summary", ""))
            print("Observation timeline sample:")
            for row in list(obs_timeline)[: args.show_samples]:
                print(row)
            print("Chunk summaries sample:")
            for row in list(chunk_summaries)[: args.show_samples]:
                print(row)
        else:
            print("Skipped Layer 12B: branch is alpha_path (alpha incidents exist).")
    if _stage_ge(args.stage, "summary"):
        print("-" * 72)
        print("Layer 13A output (Incident Summary Preparation):")
        if branch_info.get("branch") == "alpha_path":
            print(branch_output.get("incident_summary_prep", {}))
        else:
            print("Skipped Layer 13A: branch is observation_path (no alpha events).")
    print("=" * 72)
    return 0


def main() -> None:
    parser = _build_parser()
    args = parser.parse_args()
    if args.interactive or not args.source:
        args = _interactive_fill(args)
    if not args.source:
        parser.error("--source is required unless provided interactively.")
    _print_header(args)
    raise SystemExit(run(args))


if __name__ == "__main__":
    main()
