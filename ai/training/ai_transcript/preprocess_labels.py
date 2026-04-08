from __future__ import annotations

import argparse
import json
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from dataset_manifest import DATASET_DIR, MANIFEST_PATHS
from label_spec import canonicalize_motion_label_relaxed, canonicalize_static_label, load_label_spec


ROOT = Path(__file__).resolve().parent
DEFAULT_CLEAN_MANIFEST = DATASET_DIR / "sample_manifest_cleaned.jsonl"
DEFAULT_LABELS_JSON = DATASET_DIR / "labels_cleaned.json"


def _load_rows(paths: list[Path]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for path in paths:
        if not path.exists():
            continue
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    row = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if isinstance(row, dict):
                    rows.append(row)
    return rows


def _normalize_label(row: dict[str, Any]) -> str:
    task = str(row.get("task", "")).strip().lower()
    raw = str(row.get("label", "")).strip()
    if not raw:
        raise ValueError("empty label")
    if task == "static":
        return canonicalize_static_label(raw)
    if task == "motion":
        return canonicalize_motion_label_relaxed(raw)
    raise ValueError(f"unsupported task '{task}'")


def _sample_exists(row: dict[str, Any]) -> bool:
    rel = str(row.get("sample_path", "")).replace("\\", "/").strip()
    if not rel:
        return False
    return (ROOT / rel).exists()


def main() -> None:
    parser = argparse.ArgumentParser(description="Preprocess manifest labels into canonical cleaned dataset manifest.")
    parser.add_argument(
        "--manifest",
        action="append",
        default=[],
        help="Manifest path(s) to load. Defaults to merged custom + converted + legacy manifests.",
    )
    parser.add_argument("--out_manifest", type=str, default=str(DEFAULT_CLEAN_MANIFEST))
    parser.add_argument("--out_labels", type=str, default=str(DEFAULT_LABELS_JSON))
    parser.add_argument(
        "--min_motion_samples",
        type=int,
        default=1,
        help="Drop motion labels with fewer than this many samples after cleaning.",
    )
    parser.add_argument(
        "--drop_missing_files",
        action="store_true",
        help="Drop rows whose sample_path no longer exists on disk.",
    )
    args = parser.parse_args()

    spec = load_label_spec()
    input_paths = [Path(p).resolve() for p in args.manifest] if args.manifest else MANIFEST_PATHS
    rows = _load_rows(input_paths)

    cleaned_rows: list[dict[str, Any]] = []
    dropped_invalid = 0
    dropped_missing = 0

    for row in rows:
        try:
            cleaned_label = _normalize_label(row)
        except Exception:
            dropped_invalid += 1
            continue
        if args.drop_missing_files and not _sample_exists(row):
            dropped_missing += 1
            continue
        payload = dict(row)
        payload["label"] = cleaned_label
        payload["task"] = str(row.get("task", "")).strip().lower()
        cleaned_rows.append(payload)

    motion_counts = Counter(r["label"] for r in cleaned_rows if r.get("task") == "motion")
    if args.min_motion_samples > 1:
        cleaned_rows = [
            r
            for r in cleaned_rows
            if r.get("task") != "motion" or motion_counts.get(str(r.get("label")), 0) >= args.min_motion_samples
        ]
        motion_counts = Counter(r["label"] for r in cleaned_rows if r.get("task") == "motion")

    static_labels = sorted({str(r["label"]) for r in cleaned_rows if r.get("task") == "static"})
    motion_labels = sorted({str(r["label"]) for r in cleaned_rows if r.get("task") == "motion"})

    out_manifest = Path(args.out_manifest).resolve()
    out_manifest.parent.mkdir(parents=True, exist_ok=True)
    with open(out_manifest, "w", encoding="utf-8") as f:
        for row in cleaned_rows:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")

    out_labels = Path(args.out_labels).resolve()
    out_labels.parent.mkdir(parents=True, exist_ok=True)
    labels_payload = {
        "created_at": datetime.now(timezone.utc).isoformat(),
        "source_manifests": [str(p) for p in input_paths],
        "labels_spec_version": spec.version,
        "min_motion_samples": int(args.min_motion_samples),
        "drop_missing_files": bool(args.drop_missing_files),
        "counts": {
            "rows_in": len(rows),
            "rows_out": len(cleaned_rows),
            "dropped_invalid": int(dropped_invalid),
            "dropped_missing": int(dropped_missing),
            "static_rows": int(sum(1 for r in cleaned_rows if r.get("task") == "static")),
            "motion_rows": int(sum(1 for r in cleaned_rows if r.get("task") == "motion")),
        },
        "static_labels": static_labels,
        "motion_labels": motion_labels,
    }
    with open(out_labels, "w", encoding="utf-8") as f:
        json.dump(labels_payload, f, indent=2)

    print("Saved cleaned manifest:", out_manifest)
    print("Saved cleaned labels:", out_labels)
    print("Rows:", labels_payload["counts"])
    print("Motion labels:", ", ".join(motion_labels) if motion_labels else "(none)")


if __name__ == "__main__":
    main()
