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

CUSTOM_MANIFEST_PATH = DATASET_DIR / "sample_manifest_custom.jsonl"
CONVERTED_MANIFEST_PATH = DATASET_DIR / "sample_manifest_converted.jsonl"
LEGACY_MANIFEST_PATH = DATASET_DIR / "sample_manifest.jsonl"
CUSTOM_META_PATH = DATASET_DIR / "metadata_custom.jsonl"
CONVERTED_META_PATH = DATASET_DIR / "metadata_converted.jsonl"

MANIFEST_PATHS = [CUSTOM_MANIFEST_PATH, CONVERTED_MANIFEST_PATH, LEGACY_MANIFEST_PATH]
META_PATHS = [CUSTOM_META_PATH, CONVERTED_META_PATH]


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _manifest_path_for_kind(dataset_kind: str) -> Path:
    if dataset_kind == "converted":
        return CONVERTED_MANIFEST_PATH
    return CUSTOM_MANIFEST_PATH


def _meta_path_for_kind(dataset_kind: str) -> Path:
    if dataset_kind == "converted":
        return CONVERTED_META_PATH
    return CUSTOM_META_PATH


def data_roots() -> list[Path]:
    return [RAW_CUSTOM_DIR, RAW_CONVERTED_DIR, RAW_LEGACY_DIR]


def append_sample_manifest(
    record: dict[str, Any],
    path: Path | None = None,
    *,
    dataset_kind: str = "custom",
) -> None:
    path = path or _manifest_path_for_kind(dataset_kind)
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
    path = path or _meta_path_for_kind(dataset_kind)
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
