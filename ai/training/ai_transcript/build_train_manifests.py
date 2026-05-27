"""
Build deduplicated static and motion training manifests from canonical raw_custom data.
"""
from __future__ import annotations

import json
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np

from label_spec import canonicalize_motion_label_relaxed, canonicalize_static_label, load_label_spec
from motion_gru import _fixed_seq_and_length

ROOT = Path(__file__).resolve().parent
MOTION_SEQ_LEN = 10
DATASET_DIR = ROOT / "dataset"
STATIC_OUT = DATASET_DIR / "sample_manifest_static_train.jsonl"
MOTION_OUT = DATASET_DIR / "sample_manifest_motion_train.jsonl"
LABELS_OUT = DATASET_DIR / "labels_train.json"
MOTION_ROOT = DATASET_DIR / "raw_custom" / "motion"

# Labels used by the trained motion GRU (artifacts/gesture/motion_labels.json).
TRAIN_MOTION_LABELS = {
    "BUSY",
    "DEAF",
    "DRINK",
    "FINE",
    "GOODBYE",
    "GREAT",
    "HAPPY",
    "HELLO",
    "HELP",
    "HOWAREYOU",
    "HUNGRY",
    "I",
    "NAME",
    "NO",
    "NOTHING",
    "OK",
    "PLEASE",
    "SAD",
    "SEEYOULATER",
    "SORRY",
    "THANKYOU",
    "WATER",
    "WHAT",
    "YES",
    "YOU",
    "YOUR",
}


def _load_jsonl(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    if not path.exists():
        return rows
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


def _sample_exists(rel: str) -> bool:
    rel = rel.replace("\\", "/").strip()
    return bool(rel) and (ROOT / rel).exists()


def _qc_score(row: dict[str, Any]) -> float:
    qc = row.get("qc")
    if isinstance(qc, dict) and "qc_score" in qc:
        try:
            return float(qc["qc_score"])
        except (TypeError, ValueError):
            pass
    try:
        return float(row.get("qc_score", 0.0))
    except (TypeError, ValueError):
        return 0.0


def _dedupe_rows(rows: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], int]:
    """Keep best row per sample_path (highest qc_score, then last seen)."""
    by_path: dict[str, dict[str, Any]] = {}
    skipped = 0
    for row in rows:
        rel = str(row.get("sample_path", "")).replace("\\", "/").strip()
        if not rel:
            skipped += 1
            continue
        prev = by_path.get(rel)
        if prev is None or _qc_score(row) >= _qc_score(prev):
            by_path[rel] = row
    return list(by_path.values()), skipped


def _write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")


def _normalize_static_row(row: dict[str, Any]) -> dict[str, Any] | None:
    try:
        label = canonicalize_static_label(str(row.get("label", "")))
    except ValueError:
        return None
    rel = str(row.get("sample_path", "")).replace("\\", "/").strip()
    if not rel or not _sample_exists(rel):
        return None
    out = dict(row)
    out["task"] = "static"
    out["label"] = label
    out["sample_path"] = rel
    return out


def _motion_npz_valid(rel: str) -> bool:
    fp = ROOT / rel.replace("\\", "/").strip()
    if not fp.exists():
        return False
    try:
        data = np.load(fp)
        if "seq" not in data:
            return False
        _fixed_seq_and_length(data["seq"].astype(np.float32), MOTION_SEQ_LEN)
        return True
    except Exception:
        return False


def _normalize_motion_row(row: dict[str, Any]) -> dict[str, Any] | None:
    try:
        label = canonicalize_motion_label_relaxed(str(row.get("label", "")))
    except ValueError:
        return None
    if label not in TRAIN_MOTION_LABELS:
        return None
    rel = str(row.get("sample_path", "")).replace("\\", "/").strip()
    if not rel or not _motion_npz_valid(rel):
        return None
    out = dict(row)
    out["task"] = "motion"
    out["label"] = label
    out["sample_path"] = rel
    return out


def _motion_row_from_disk(npz_path: Path) -> dict[str, Any] | None:
    rel = str(npz_path.relative_to(ROOT)).replace("\\", "/")
    label = npz_path.parent.name.upper()
    if label not in TRAIN_MOTION_LABELS or not _motion_npz_valid(rel):
        return None
    return {
        "created_at": datetime.now(timezone.utc).isoformat(),
        "sample_path": rel,
        "task": "motion",
        "label": label,
        "source": "disk_index",
        "domain": "custom",
        "signer_id": "unknown",
    }


def _static_row_from_disk(npy_path: Path) -> dict[str, Any] | None:
    rel = str(npy_path.relative_to(ROOT)).replace("\\", "/")
    label = npy_path.parent.name.upper()
    row = {
        "created_at": datetime.now(timezone.utc).isoformat(),
        "sample_path": rel,
        "task": "static",
        "label": label,
        "source": "disk_index",
        "domain": "custom",
        "signer_id": "unknown",
    }
    return _normalize_static_row(row)


def build_static_manifest() -> tuple[list[dict[str, Any]], dict[str, int]]:
    stats = Counter()
    cleaned: list[dict[str, Any]] = []
    static_root = DATASET_DIR / "raw_custom" / "static"
    if not static_root.exists():
        return [], dict(stats)
    for npy in sorted(static_root.rglob("*.npy")):
        stats["rows_in"] += 1
        norm = _static_row_from_disk(npy)
        if norm is None:
            stats["dropped"] += 1
            continue
        cleaned.append(norm)
    deduped, _ = _dedupe_rows(cleaned)
    stats["rows_out"] = len(deduped)
    return deduped, dict(stats)


def build_motion_manifest() -> tuple[list[dict[str, Any]], dict[str, int]]:
    stats = Counter()
    merged: list[dict[str, Any]] = []

    if MOTION_ROOT.exists():
        for npz in sorted(MOTION_ROOT.rglob("*.npz")):
            stats["rows_in"] += 1
            disk_row = _motion_row_from_disk(npz)
            if disk_row is None:
                stats["dropped"] += 1
                continue
            merged.append(disk_row)

    deduped, _ = _dedupe_rows(merged)
    stats["rows_out"] = len(deduped)
    return deduped, dict(stats)


def main() -> None:
    spec = load_label_spec()
    static_rows, static_stats = build_static_manifest()
    motion_rows, motion_stats = build_motion_manifest()

    _write_jsonl(STATIC_OUT, static_rows)
    _write_jsonl(MOTION_OUT, motion_rows)

    static_counts = Counter(r["label"] for r in static_rows)
    motion_counts = Counter(r["label"] for r in motion_rows)

    labels_payload = {
        "created_at": datetime.now(timezone.utc).isoformat(),
        "labels_spec_version": spec.version,
        "static_manifest": str(STATIC_OUT.relative_to(ROOT)),
        "motion_manifest": str(MOTION_OUT.relative_to(ROOT)),
        "motion_train_label_set": sorted(TRAIN_MOTION_LABELS),
        "static": {
            "total": len(static_rows),
            "labels": len(static_counts),
            "class_counts": dict(sorted(static_counts.items())),
            "build_stats": static_stats,
        },
        "motion": {
            "total": len(motion_rows),
            "labels": len(motion_counts),
            "class_counts": dict(sorted(motion_counts.items())),
            "build_stats": motion_stats,
        },
    }
    with open(LABELS_OUT, "w", encoding="utf-8") as f:
        json.dump(labels_payload, f, indent=2)

    print("Wrote", STATIC_OUT.relative_to(ROOT), "->", len(static_rows), "static samples")
    print("Wrote", MOTION_OUT.relative_to(ROOT), "->", len(motion_rows), "motion samples")
    print("Wrote", LABELS_OUT.relative_to(ROOT))
    print()
    print("=== STATIC BY LABEL ===")
    for label, count in sorted(static_counts.items()):
        print(f"  {label}: {count}")
    print(f"  TOTAL: {sum(static_counts.values())}")
    print()
    print("=== MOTION BY LABEL ===")
    for label, count in sorted(motion_counts.items()):
        print(f"  {label}: {count}")
    print(f"  TOTAL: {sum(motion_counts.values())}")


if __name__ == "__main__":
    main()
