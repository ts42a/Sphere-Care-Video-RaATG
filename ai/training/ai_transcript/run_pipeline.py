"""Train gesture models. Matrices + reports go to artifacts/gesture/train_report/."""
from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent
STATIC_MANIFEST = ROOT / "dataset" / "sample_manifest_static_train.jsonl"
MOTION_MANIFEST = ROOT / "dataset" / "sample_manifest_motion_train.jsonl"


def _run(cmd: list[str]) -> None:
    print("\n$", " ".join(cmd))
    subprocess.run(cmd, cwd=str(ROOT), check=True)


def main() -> None:
    parser = argparse.ArgumentParser(description="Build manifests, train gesture models.")
    parser.add_argument("--mode", choices=["static", "motion", "both"], default="both")
    parser.add_argument("--motion-seq-len", type=int, default=10)
    parser.add_argument("--motion-epochs", type=int, default=30)
    parser.add_argument("--motion-patience", type=int, default=5)
    parser.add_argument("--motion-batch-size", type=int, default=64)
    parser.add_argument("--test-size", type=float, default=0.2)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--cv-folds", type=int, default=5)
    parser.add_argument("--split-mode", choices=["auto", "group", "stratified"], default="auto")
    parser.add_argument("--rebuild-manifests", action="store_true")
    parser.add_argument("--allow-failed-gate", action="store_true")
    parser.add_argument(
        "--export-runtime",
        action="store_true",
        help="Copy models to worker_ai (optional; not required for local test.py).",
    )
    parser.add_argument("--runtime-dir", type=str, default="")
    parser.add_argument("--strict-export", action="store_true")
    args = parser.parse_args()

    py = sys.executable
    if args.rebuild_manifests:
        _run([py, "build_train_manifests.py"])

    common = [
        "--test_size",
        str(args.test_size),
        "--seed",
        str(args.seed),
        "--cv_folds",
        str(args.cv_folds),
        "--split_mode",
        args.split_mode,
    ]
    if args.allow_failed_gate:
        common.append("--allow_failed_gate")

    if args.mode in ("static", "both"):
        _run(
            [py, "train.py", "--mode", "static", "--manifest_path", str(STATIC_MANIFEST), *common]
        )
    if args.mode in ("motion", "both"):
        _run(
            [
                py,
                "train.py",
                "--mode",
                "motion",
                "--manifest_path",
                str(MOTION_MANIFEST),
                "--motion_seq_len",
                str(args.motion_seq_len),
                "--motion_epochs",
                str(args.motion_epochs),
                "--motion_patience",
                str(args.motion_patience),
                "--motion_batch_size",
                str(args.motion_batch_size),
                *common,
            ]
        )

    if args.export_runtime:
        export_cmd = [py, "export.py"]
        if args.runtime_dir:
            export_cmd += ["--runtime-dir", args.runtime_dir]
        if args.strict_export:
            export_cmd.append("--strict")
        if args.allow_failed_gate:
            export_cmd.append("--allow-failed-gate")
        _run(export_cmd)

    print("\nPipeline completed.")
    print("Training matrices + reports:", ROOT / "artifacts" / "gesture" / "train_report")


if __name__ == "__main__":
    main()
