"""
Step 0: pick a source video, optionally run the analysis pipeline up to N steps.

Lists videos in this folder, saves your choice to SELECTED_VIDEO.txt, then (by
default) runs every downstream script from preprocess through the LLM summary.
Prints wall-clock time for each pipeline layer and a summary at the end.

Run from repo root (folder name contains a dot, so use the path, not -m):

  python ai/models/SCVAM2.1/test.py
  python ai/models/SCVAM2.1/test.py --video test4.mp4 --steps all
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

SELECTED_NAME = "SELECTED_VIDEO.txt"
TIMING_NAME = "pipeline_timing.json"
VIDEO_EXTS = {".mp4", ".mov", ".avi", ".mkv", ".webm", ".m4v", ".wmv"}

# One unit per script, in order. Step labels match printed help.
PIPELINE_STEPS: list[tuple[str, str]] = [
    ("1a — preprocess (frames @ FPS)", "preprocess.py"),
    ("1b — dectator (object scan)", "dectator.py"),
    ("1c — reducer (anchor pruning)", "reducer.py"),
    ("2a — zoom_evidence (hand crops)", "zoom_evidence.py"),
    ("2b — zoom_evidence_dectator (YOLO on crops)", "zoom_evidence_dectator.py"),
    ("2c — zoom_evidence_verify (enhance + refine YOLO)", "zoom_evidence_verify.py"),
    ("3 — pose_detection", "pose_detection.py"),
    ("4 — merge_frames", "merge_frames.py"),
    ("5 — temporal_grn", "temporal_grn.py"),
    ("6 — risk_engine", "risk_engine.py"),
    ("7 — llm_explain (short text summary, no photos)", "llm_explain.py"),
]


def _package_dir() -> Path:
    return Path(__file__).resolve().parent


def _repo_root() -> Path:
    return _package_dir().parent.parent.parent


def _collect_videos(root: Path) -> list[Path]:
    out: list[Path] = []
    if not root.is_dir():
        return out
    for p in sorted(root.iterdir()):
        if p.is_file() and p.suffix.lower() in VIDEO_EXTS:
            out.append(p)
    return out


def _format_duration(seconds: float) -> str:
    if seconds < 60:
        return f"{seconds:.2f}s"
    minutes, secs = divmod(seconds, 60)
    if minutes < 60:
        return f"{int(minutes)}m {secs:.1f}s"
    hours, minutes = divmod(minutes, 60)
    return f"{int(hours)}h {int(minutes)}m {secs:.1f}s"


def _print_pipeline_steps() -> None:
    print("\nPipeline steps (run in order):")
    for i, (label, _) in enumerate(PIPELINE_STEPS, start=1):
        print(f"  {i}) {label}")


def _prompt_step_count() -> int:
    nmax = len(PIPELINE_STEPS)
    while True:
        raw = input(
            f"\nHow many steps to run? [Enter = all {nmax}, 1–{nmax}, or 0 = skip]: "
        ).strip()
        if raw == "":
            return nmax
        if raw.isdigit():
            n = int(raw)
            if n == 0:
                return 0
            if 1 <= n <= nmax:
                return n
        print(f"Enter 0 to skip, 1–{nmax}, or press Enter for all.")


def _print_timing_summary(
    timings: list[dict[str, object]],
    *,
    total_sec: float,
    count: int,
) -> None:
    print("\n" + "=" * 60)
    print("Pipeline timing summary")
    print("=" * 60)
    for row in timings:
        label = row["label"]
        elapsed = float(row["elapsed_sec"])
        pct = (elapsed / total_sec * 100) if total_sec > 0 else 0.0
        print(
            f"  Step {row['step']}/{count}: {label}\n"
            f"    {_format_duration(elapsed)}  ({pct:.1f}% of total)"
        )
    print("-" * 60)
    print(f"  Total: {_format_duration(total_sec)}")
    print("=" * 60)


def _save_timing_report(timings: list[dict[str, object]], total_sec: float) -> Path:
    pkg = _package_dir()
    out_path = pkg / TIMING_NAME
    payload = {
        "total_sec": round(total_sec, 3),
        "total_human": _format_duration(total_sec),
        "steps": timings,
    }
    out_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return out_path


def _run_pipeline_steps(count: int) -> int:
    root = _repo_root()
    pkg = _package_dir()
    timings: list[dict[str, object]] = []
    total_start = time.perf_counter()

    for i in range(count):
        label, script = PIPELINE_STEPS[i]
        script_path = pkg / script
        if not script_path.is_file():
            print(f"Missing script: {script_path}")
            return 1
        print(f"\n--- Step {i + 1}/{count}: {label} ---")
        print(f"Running: python {script_path.relative_to(root)}")
        step_start = time.perf_counter()
        r = subprocess.run(
            [sys.executable, str(script_path)],
            cwd=root,
        )
        elapsed = time.perf_counter() - step_start
        timings.append(
            {
                "step": i + 1,
                "label": label,
                "script": script,
                "elapsed_sec": round(elapsed, 3),
                "elapsed_human": _format_duration(elapsed),
                "exit_code": r.returncode,
            }
        )
        print(f"Layer time: {_format_duration(elapsed)} (exit {r.returncode})")
        if r.returncode != 0:
            total_sec = time.perf_counter() - total_start
            _print_timing_summary(timings, total_sec=total_sec, count=count)
            _save_timing_report(timings, total_sec)
            print(f"Step failed with exit code {r.returncode}. Stopping.")
            return r.returncode

    total_sec = time.perf_counter() - total_start
    _print_timing_summary(timings, total_sec=total_sec, count=count)
    timing_path = _save_timing_report(timings, total_sec)
    print(f"Timing report saved to:\n  {timing_path}")
    return 0


def _resolve_video(videos: list[Path], spec: str) -> Path | None:
    if spec.isdigit():
        idx = int(spec)
        if 1 <= idx <= len(videos):
            return videos[idx - 1]
        return None
    name = Path(spec).name
    for p in videos:
        if p.name == name or p.stem == spec:
            return p
    return None


def _parse_args(argv: list[str] | None) -> argparse.Namespace:
    nmax = len(PIPELINE_STEPS)
    parser = argparse.ArgumentParser(description="SCVAM2.1 local pipeline test runner")
    parser.add_argument(
        "--video",
        help="Video filename, stem, or 1-based index (skips interactive video menu)",
    )
    parser.add_argument(
        "--steps",
        default="",
        help=f"Steps to run: 0–{nmax}, 'all', or empty for interactive prompt",
    )
    return parser.parse_args(argv)


def _parse_step_count(raw: str) -> int | None:
    nmax = len(PIPELINE_STEPS)
    text = raw.strip().lower()
    if text in ("", "all", "max"):
        return nmax
    if text.isdigit():
        n = int(text)
        if n == 0 or 1 <= n <= nmax:
            return n
    return None


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    script_dir = _package_dir()
    videos = _collect_videos(script_dir)

    _print_pipeline_steps()

    if not videos:
        print(f"\nNo video files found in:\n  {script_dir}")
        print(f"Supported extensions: {', '.join(sorted(VIDEO_EXTS))}")
        return 1

    print("\nVideos in folder:")
    for i, p in enumerate(videos, start=1):
        print(f"  {i}) {p.name}")

    chosen: Path | None = None
    if args.video:
        chosen = _resolve_video(videos, args.video)
        if chosen is None:
            print(f"Unknown video: {args.video!r}")
            return 1
    else:
        print("  0) Cancel")
        while True:
            raw = input("\nEnter number: ").strip()
            if raw == "0":
                print("Cancelled.")
                return 0
            if raw.isdigit():
                idx = int(raw)
                if 1 <= idx <= len(videos):
                    chosen = videos[idx - 1]
                    break
            print("Invalid choice - enter a listed number.")

    assert chosen is not None
    out_path = script_dir / SELECTED_NAME
    out_path.write_text(chosen.resolve().as_posix(), encoding="utf-8")
    print(f"\nSelected: {chosen}")
    print(f"Saved path to:\n  {out_path}")

    if args.steps:
        n_steps = _parse_step_count(args.steps)
        if n_steps is None:
            print(f"Invalid --steps value: {args.steps!r}")
            return 1
    else:
        n_steps = _prompt_step_count()

    if n_steps == 0:
        print(
            "\nSkipped pipeline run. Run steps manually from repo root if needed:\n"
            "  python ai/models/SCVAM2.1/preprocess.py\n"
            "  … through llm_explain.py"
        )
        return 0
    return _run_pipeline_steps(n_steps)


if __name__ == "__main__":
    sys.exit(main())
