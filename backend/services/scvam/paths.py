from __future__ import annotations

import re
from pathlib import Path

from backend import models
from backend.core import config as app_config


def vault_root() -> Path:
    return Path(app_config.VAULT_STORAGE_ROOT).resolve()


def scvam_input_root(org_id: int) -> Path:
    return vault_root() / f"org_{int(org_id)}" / "scvam_input"


def raw_inbox_dir(org_id: int) -> Path:
    """Drop zone: place source videos here before SCVAM runs."""
    return scvam_input_root(org_id) / "RAW"


def scvam_output_root(org_id: int) -> Path:
    return vault_root() / f"org_{int(org_id)}" / "scvam_output"


def scvam_output_dir(org_id: int, video_stem: str) -> Path:
    safe = _safe_folder_name(video_stem)
    return scvam_output_root(org_id) / safe


def scvam_output_dir_relative(org_id: int, video_stem: str) -> str:
    return scvam_output_dir(org_id, video_stem).relative_to(vault_root()).as_posix()


def staging_job_dir(org_id: int, vault_record_id: str) -> Path:
    safe_id = _safe_vault_id(vault_record_id)
    return scvam_input_root(org_id) / "jobs" / safe_id


def staging_job_dir_relative(org_id: int, vault_record_id: str) -> str:
    return staging_job_dir(org_id, vault_record_id).relative_to(vault_root()).as_posix()


def vault_enc_path(record: models.Record) -> Path:
    rel = Path(record.file_name or "")
    if not str(rel):
        raise ValueError("Encrypted file path not set for this record")
    root = vault_root()
    abs_path = (root / rel).resolve()
    abs_path.relative_to(root)
    return abs_path


def scvam_output_enc_path(record: models.Record) -> Path:
    enc = vault_enc_path(record)
    return enc.with_suffix(".scvam.enc")


def scvam_output_enc_relative(record: models.Record) -> str:
    return scvam_output_enc_path(record).relative_to(vault_root()).as_posix()


def vault_meta_path(record: models.Record) -> Path:
    enc = vault_enc_path(record)
    return enc.with_suffix(".meta.json")


def parse_segment_index(vault_record_id: str) -> int:
    m = re.search(r"_s(\d+)$", vault_record_id)
    if m:
        return int(m.group(1))
    return 1


def _safe_vault_id(vault_record_id: str) -> str:
    safe = "".join(ch for ch in str(vault_record_id) if ch.isalnum() or ch in {"-", "_"})
    if not safe:
        raise ValueError("Invalid vault_record_id")
    return safe


def _safe_folder_name(stem: str) -> str:
    safe = re.sub(r"[^a-zA-Z0-9_-]+", "_", str(stem)).strip("_")
    return safe[:80] or "video"
