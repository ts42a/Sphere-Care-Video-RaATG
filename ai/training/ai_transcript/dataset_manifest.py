from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parent
DATASET_DIR = ROOT / "dataset"
RAW_CUSTOM_DIR = DATASET_DIR / "raw_custom"
RAW_CONVERTED_DIR = DATASET_DIR / "raw_converted"
RAW_LEGACY_DIR = DATASET_DIR / "raw"

STATIC_TRAIN_MANIFEST_PATH = DATASET_DIR / "sample_manifest_static_train.jsonl"
MOTION_TRAIN_MANIFEST_PATH = DATASET_DIR / "sample_manifest_motion_train.jsonl"
CAPTURE_META_PATH = DATASET_DIR / "capture_sessions.jsonl"

MANIFEST_PATHS = [STATIC_TRAIN_MANIFEST_PATH, MOTION_TRAIN_MANIFEST_PATH]
META_PATHS = [CAPTURE_META_PATH]


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _manifest_path_for_task(task: str) -> Path:
    if str(task).strip().lower() == "motion":
        return MOTION_TRAIN_MANIFEST_PATH
    return STATIC_TRAIN_MANIFEST_PATH


def data_roots() -> list[Path]:
    return [RAW_CUSTOM_DIR]


def append_sample_manifest(
    record: dict[str, Any],
    path: Path | None = None,
    *,
    dataset_kind: str = "custom",
) -> None:
    del dataset_kind  # single canonical dataset layout
    if path is None:
        path = _manifest_path_for_task(str(record.get("task", "static")))
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {"created_at": _utc_now(), **record}
    with open(path, "a", encoding="utf-8") as f:
        f.write(json.dumps(payload, ensure_ascii=False) + "\n")


def append_capture_metadata(
    record: dict[str, Any],
    path: Path | None = None,
    *,
    dataset_kind: str = "custom",
) -> None:
    del dataset_kind
    path = path or CAPTURE_META_PATH
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {"created_at": _utc_now(), **record}
    with open(path, "a", encoding="utf-8") as f:
        f.write(json.dumps(payload, ensure_ascii=False) + "\n")


def load_manifest_index(
    path: Path | None = None,
    *,
    paths: list[Path] | None = None,
) -> dict[str, dict[str, Any]]:
    target_paths = paths or ([path] if path is not None else MANIFEST_PATHS)
    out: dict[str, dict[str, Any]] = {}
    for manifest_path in target_paths:
        if not manifest_path.exists():
            continue
        with open(manifest_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    row = json.loads(line)
                except json.JSONDecodeError:
                    continue
                rel_path = str(row.get("sample_path", "")).replace("\\", "/")
                if rel_path:
                    out[rel_path] = row
    return out
