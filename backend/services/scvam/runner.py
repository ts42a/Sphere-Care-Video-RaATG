from __future__ import annotations

import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

from backend.core import config as app_config

PIPELINE_STEPS: list[tuple[str, str, list[str]]] = [
    ("preprocess", "preprocess.py", ["--no-video"]),
    ("dectator", "dectator.py", ["--no-show"]),
    ("reducer", "reducer.py", []),
    ("zoom_evidence", "zoom_evidence.py", ["--no-show"]),
    ("zoom_evidence_dectator", "zoom_evidence_dectator.py", []),
    ("zoom_evidence_verify", "zoom_evidence_verify.py", []),
    ("pose_detection", "pose_detection.py", ["--no-show"]),
    ("merge_frames", "merge_frames.py", []),
    ("temporal_grn", "temporal_grn.py", []),
    ("risk_engine", "risk_engine.py", []),
    ("llm_explain", "llm_explain.py", []),
]


@dataclass
class ScvamRunResult:
    run_dir: Path
    llm_summary_path: Path
    events_path: Path


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[3]


def _package_dir() -> Path:
    p = Path(app_config.SCVAM_PACKAGE_DIR)
    if not p.is_dir():
        raise FileNotFoundError(f"SCVAM package not found: {p}")
    return p.resolve()


def discover_run_dir(work_root: Path) -> Path:
    """Return newest run directory under work_root containing frames/."""
    candidates: list[Path] = []
    if not work_root.is_dir():
        raise FileNotFoundError(f"SCVAM work root missing: {work_root}")
    for child in work_root.iterdir():
        if child.is_dir() and (child / "frames").is_dir():
            candidates.append(child)
    if not candidates:
        raise FileNotFoundError(f"No SCVAM run dir with frames/ under {work_root}")
    return max(candidates, key=lambda p: p.stat().st_mtime)


def run_scvam_pipeline(*, input_video: Path, work_root: Path) -> ScvamRunResult:
    if not input_video.is_file():
        raise FileNotFoundError(input_video)

    pkg = _package_dir()
    repo = _repo_root()
    work_root = work_root.resolve()
    work_root.mkdir(parents=True, exist_ok=True)

    selected_file = pkg / "SELECTED_VIDEO.txt"
    selected_file.write_text(input_video.resolve().as_posix(), encoding="utf-8")

    py = sys.executable
    run_dir: Path | None = None

    for step_name, script_name, extra_args in PIPELINE_STEPS:
        script_path = pkg / script_name
        if not script_path.is_file():
            raise FileNotFoundError(f"Missing SCVAM script: {script_path}")

        cmd: list[str] = [py, str(script_path)]

        if step_name == "preprocess":
            cmd.extend(["--video", str(input_video.resolve()), "--out", str(work_root)])
            cmd.extend(extra_args)
        else:
            if run_dir is None:
                raise RuntimeError("preprocess did not produce a run directory")
            merged_json = run_dir / "merged" / "merged_frames.json"
            if step_name in {"temporal_grn", "risk_engine"}:
                cmd.extend(["--merged", str(merged_json)])
                if step_name == "risk_engine":
                    cmd.extend(["--temporal", str(run_dir / "merged" / "temporal.json")])
            elif step_name == "llm_explain":
                cmd.extend(["--run", str(run_dir)])
            else:
                cmd.extend(["--run", str(run_dir)])
            cmd.extend(extra_args)

        proc = subprocess.run(
            cmd,
            cwd=str(repo),
            capture_output=True,
            text=True,
        )
        if proc.returncode != 0:
            err = (proc.stderr or proc.stdout or "").strip()
            raise RuntimeError(f"SCVAM step {step_name} failed (code {proc.returncode}): {err[:2000]}")

        if step_name == "preprocess":
            run_dir = discover_run_dir(work_root)

    if run_dir is None:
        raise RuntimeError("SCVAM pipeline finished without a run directory")

    llm_summary = run_dir / "merged" / "llm_summary.json"
    events = run_dir / "merged" / "events.json"
    if not llm_summary.is_file():
        raise FileNotFoundError(f"Missing {llm_summary}")
    if not events.is_file():
        raise FileNotFoundError(f"Missing {events}")

    return ScvamRunResult(run_dir=run_dir, llm_summary_path=llm_summary, events_path=events)
