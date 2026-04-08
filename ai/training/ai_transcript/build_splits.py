from __future__ import annotations

import argparse
import json
from collections import defaultdict
from pathlib import Path
from typing import Any

from dataset_manifest import MANIFEST_PATHS


ROOT = Path(__file__).resolve().parent
SPLITS_DIR = ROOT / "dataset" / "splits"
SPLITS_PATH = SPLITS_DIR / "signer_splits.json"


def _load_rows(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    rows: list[dict[str, Any]] = []
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


def _load_rows_many(paths: list[Path]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for path in paths:
        rows.extend(_load_rows(path))
    return rows


def _unique_in_order(values: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for v in values:
        if v in seen:
            continue
        seen.add(v)
        out.append(v)
    return out


def _build_task_splits(rows: list[dict[str, Any]], task: str) -> dict[str, Any]:
    filtered = [r for r in rows if str(r.get("task", "")).lower() == task]
    signer_ids = _unique_in_order(
        [str(r.get("signer_id", "unknown")).strip() or "unknown" for r in filtered]
    )
    by_signer: dict[str, list[str]] = defaultdict(list)
    for r in filtered:
        signer = str(r.get("signer_id", "unknown")).strip() or "unknown"
        by_signer[signer].append(str(r.get("sample_path", "")).replace("\\", "/"))

    folds = []
    for signer in signer_ids:
        test_samples = sorted(by_signer.get(signer, []))
        train_samples: list[str] = []
        for other in signer_ids:
            if other == signer:
                continue
            train_samples.extend(by_signer.get(other, []))
        folds.append(
            {
                "held_out_signer": signer,
                "train_count": len(train_samples),
                "test_count": len(test_samples),
                "train_samples": sorted(train_samples),
                "test_samples": test_samples,
            }
        )
    return {
        "task": task,
        "total_samples": len(filtered),
        "total_signers": len(signer_ids),
        "signers": signer_ids,
        "folds": folds,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Build reproducible signer-based dataset split manifests.")
    parser.add_argument(
        "--manifest",
        action="append",
        default=[],
        help="Manifest file path. Pass multiple times to merge; defaults to custom + converted + legacy manifests.",
    )
    parser.add_argument("--out", type=str, default=str(SPLITS_PATH))
    args = parser.parse_args()

    manifest_paths = [Path(p).resolve() for p in args.manifest] if args.manifest else MANIFEST_PATHS
    rows = _load_rows_many(manifest_paths)
    payload = {
        "source_manifests": [str(p.resolve()) for p in manifest_paths],
        "tasks": {
            "static": _build_task_splits(rows, "static"),
            "motion": _build_task_splits(rows, "motion"),
        },
    }

    out_path = Path(args.out).resolve()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)
    print("Saved signer split file:", out_path)


if __name__ == "__main__":
    main()
