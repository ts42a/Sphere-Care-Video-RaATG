from __future__ import annotations

import base64
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from sqlalchemy.orm import Session

from backend import models
from backend.core import config as app_config
from backend.services.scvam import paths as scvam_paths


def _ai_policy_allows(db: Session, organization_id: int) -> bool:
    policy = (
        db.query(models.VaultAiAccessPolicy)
        .filter(models.VaultAiAccessPolicy.organization_id == int(organization_id))
        .first()
    )
    if policy is None:
        return True
    return bool(policy.enabled)


def maybe_enqueue_scvam_job(
    db: Session,
    *,
    admin: models.Admin,
    record: models.Record,
    vault_record_id: str,
    enc_relative_path: str,
    meta_path: Path,
    ai_analyze: bool,
    ai_plain_b64: Optional[str],
    duration_sec: Optional[int],
    camera_id: Optional[str],
    resident_name: Optional[str],
    room: Optional[str],
    iv_b64: str,
    mime_type: Optional[str],
    started_at: Optional[datetime],
    ended_at: Optional[datetime],
) -> Optional[models.ScvamJob]:
    if not app_config.SCVAM_ENABLED:
        return None
    if not ai_analyze:
        record.scvam_status = "none"
        return None
    if not _ai_policy_allows(db, int(admin.organization_id)):
        record.scvam_status = "skipped"
        return None

    duration = int(duration_sec or 0)
    if duration < app_config.SCVAM_MIN_DURATION_SEC:
        record.scvam_status = "skipped"
        record.ai_summary = (
            f"Recording saved. AI analysis skipped because clip duration is under "
            f"{app_config.SCVAM_MIN_DURATION_SEC} seconds."
        )
        return None

    if not ai_plain_b64:
        record.scvam_status = "failed"
        record.notes = (record.notes or "") + " [SCVAM: missing plaintext for staging]"
        return None

    try:
        plain_bytes = base64.b64decode(ai_plain_b64)
    except Exception:
        record.scvam_status = "failed"
        return None

    org_id = int(admin.organization_id)
    from backend.services.scvam.staging import write_staging_input

    _staging_dir, staging_rel = write_staging_input(
        org_id=org_id,
        vault_record_id=vault_record_id,
        plain_bytes=plain_bytes,
        record=record,
        admin=admin,
        enc_relative_path=enc_relative_path,
        iv_b64=iv_b64,
        mime_type=mime_type,
        duration_sec=duration,
        camera_id=camera_id,
        resident_name=resident_name,
        room=room,
        started_at=started_at,
        ended_at=ended_at,
        source="vault_upload",
    )
    segment_index = scvam_paths.parse_segment_index(vault_record_id)

    existing = (
        db.query(models.ScvamJob)
        .filter(
            models.ScvamJob.vault_record_id == vault_record_id,
            models.ScvamJob.segment_index == segment_index,
        )
        .first()
    )
    if existing:
        if existing.status in {"pending", "running"}:
            record.scvam_status = existing.status if existing.status != "running" else "processing"
            return existing
        existing.status = "pending"
        existing.attempts = 0
        existing.error_message = None
        existing.staging_path = staging_rel
        existing.work_path = f"{staging_rel}/work"
        existing.duration_sec = duration
        job = existing
    else:
        job = models.ScvamJob(
            organization_id=org_id,
            admin_id=int(admin.id),
            vault_record_id=vault_record_id,
            db_record_id=int(record.id),
            enc_relative_path=enc_relative_path,
            segment_index=segment_index,
            status="pending",
            staging_path=staging_rel,
            work_path=f"{staging_rel}/work",
            max_attempts=app_config.SCVAM_MAX_ATTEMPTS,
            duration_sec=duration,
            camera_id=camera_id,
            resident_name=resident_name,
            room=room,
        )
        db.add(job)

    record.scvam_status = "pending"
    db.flush()

    meta_data = {}
    if meta_path.is_file():
        try:
            meta_data = json.loads(meta_path.read_text(encoding="utf-8"))
        except Exception:
            meta_data = {}
    meta_data["scvam_status"] = "pending"
    meta_data["scvam_job_id"] = int(job.id) if job.id else None
    meta_path.write_text(json.dumps(meta_data, ensure_ascii=True, indent=2), encoding="utf-8")

    return job
