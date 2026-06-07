"""Remove a record row and related vault / SCVAM files on disk."""
from __future__ import annotations

import os
import shutil
from pathlib import Path

from sqlalchemy.orm import Session

from backend import models


def _vault_root() -> Path:
    return Path(os.getenv("VAULT_STORAGE_ROOT", "databases")).resolve()


def purge_record(db: Session, record: models.Record) -> None:
    """Hard-delete DB row, SCVAM jobs, encrypted blob, and output folder."""
    root = _vault_root()

    if record.file_name:
        try:
            enc_path = (root / record.file_name).resolve()
            enc_path.relative_to(root)
            if enc_path.is_file():
                enc_path.unlink()
            meta_path = enc_path.parent / f"{enc_path.stem}.meta.json"
            if meta_path.is_file():
                meta_path.unlink()
        except (ValueError, OSError):
            pass

    out_rel = getattr(record, "scvam_output_path", None) or ""
    if out_rel:
        try:
            out_dir = (root / out_rel).resolve()
            out_dir.relative_to(root)
            if out_dir.is_dir():
                shutil.rmtree(out_dir, ignore_errors=True)
        except (ValueError, OSError):
            pass

    # Staging records: file_name is org_X/scvam_input/jobs/{folder}/{video}.mp4
    if record.file_name:
        try:
            rel = Path(str(record.file_name))
            parts = rel.parts
            org_idx = next((i for i, p in enumerate(parts) if p.startswith("org_")), None)
            if org_idx is not None:
                org_id = int(parts[org_idx].replace("org_", ""))
                video_stem = rel.stem
                from backend.services.scvam.paths import scvam_output_dir

                out_dir = scvam_output_dir(org_id, video_stem)
                if out_dir.is_dir():
                    shutil.rmtree(out_dir, ignore_errors=True)
        except (ValueError, OSError):
            pass

    jobs = db.query(models.ScvamJob).filter(models.ScvamJob.db_record_id == record.id).all()
    for job in jobs:
        if job.staging_path:
            try:
                staging = (root / job.staging_path).resolve()
                staging.relative_to(root)
                if staging.is_dir():
                    shutil.rmtree(staging, ignore_errors=True)
            except (ValueError, OSError):
                pass
        db.delete(job)

    db.delete(record)
