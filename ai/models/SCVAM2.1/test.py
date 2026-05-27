"""
Step 0: pick a source video, optionally run the analysis pipeline up to N steps.

Lists videos in this folder, saves your choice to SELECTED_VIDEO.txt, then (by
default) runs every downstream script from preprocess through the LLM summary.

Run from repo root (folder name contains a dot, so use the path, not -m):

  python ai/models/SCVAM2.1/test.py
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

SELECTED_NAME = "SELECTED_VIDEO.txt"
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


def _run_pipeline_steps(count: int) -> int:
    root = _repo_root()
    pkg = _package_dir()
    for i in range(count):
        label, script = PIPELINE_STEPS[i]
        script_path = pkg / script
        if not script_path.is_file():
            print(f"Missing script: {script_path}")
            return 1
        print(f"\n--- Step {i + 1}/{count}: {label} ---")
        print(f"Running: python {script_path.relative_to(root)}")
        r = subprocess.run(
            [sys.executable, str(script_path)],
            cwd=root,
        )
        if r.returncode != 0:
            print(f"Step failed with exit code {r.returncode}. Stopping.")
            return r.returncode
    return 0


def main() -> int:
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
                out_path = script_dir / SELECTED_NAME
                out_path.write_text(chosen.resolve().as_posix(), encoding="utf-8")
                print(f"\nSelected: {chosen}")
                print(f"Saved path to:\n  {out_path}")

                n_steps = _prompt_step_count()
                if n_steps == 0:
                    print(
                        "\nSkipped pipeline run. Run steps manually from repo root if needed:\n"
                        "  python ai/models/SCVAM2.1/preprocess.py\n"
                        "  … through llm_explain.py"
                    )
                    return 0
                return _run_pipeline_steps(n_steps)
        print("Invalid choice - enter a listed number.")


if __name__ == "__main__":
    sys.exit(main())
