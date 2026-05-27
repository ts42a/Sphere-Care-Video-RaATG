"""Regenerate the 2 training PNGs per model from saved train reports + raw data."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from motion_gru import load_motion_sequence_dataset
from train import (
    REPORTS_DIR,
    ROOT,
    _load_manifest_rows,
    load_static_dataset,
)
from train_report_images import save_motion_training_images, save_static_training_images

STATIC_MANIFEST = ROOT / "dataset" / "sample_manifest_static_train.jsonl"
MOTION_MANIFEST = ROOT / "dataset" / "sample_manifest_motion_train.jsonl"


def _metrics_from_report(path: Path) -> dict:
    with open(path, encoding="utf-8") as f:
        payload = json.load(f)
    return payload["result"]["metrics"]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=["static", "motion", "both"], default="both")
    parser.add_argument("--motion-seq-len", type=int, default=10)
    args = parser.parse_args()

    if args.mode in ("static", "both"):
        report = REPORTS_DIR / "static_train_report.json"
        metrics = _metrics_from_report(report) if report.exists() else None
        rows = _load_manifest_rows(STATIC_MANIFEST)
        X, y, labels, _ = load_static_dataset(manifest_rows=rows)
        paths = save_static_training_images(X, y, labels, metrics)
        for p in paths:
            print("Wrote", p)

    if args.mode in ("motion", "both"):
        report = REPORTS_DIR / "motion_train_report.json"
        metrics = _metrics_from_report(report) if report.exists() else None
        rows = _load_manifest_rows(MOTION_MANIFEST)
        X, y, labels, _, lengths = load_motion_sequence_dataset(
            seq_len=args.motion_seq_len, manifest_rows=rows
        )
        paths = save_motion_training_images(X, y, labels, lengths, metrics)
        for p in paths:
            print("Wrote", p)


if __name__ == "__main__":
    main()
