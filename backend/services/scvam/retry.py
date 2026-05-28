from __future__ import annotations

from sqlalchemy.orm import Session

from backend import models
from backend.core import config as app_config
from backend.services.scvam import paths as scvam_paths
from backend.services.scvam.staging import ensure_staging_for_retry, vault_record_id_for_record


def requeue_scvam_for_record(
    db: Session,
    *,
    admin: models.Admin,
    record: models.Record,
    ai_plain_b64: str | None = None,
) -> tuple[models.Record, models.ScvamJob]:
    if not app_config.SCVAM_ENABLED:
        raise ValueError("SCVAM is disabled on this server.")

    job = (
        db.query(models.ScvamJob)
        .filter(models.ScvamJob.db_record_id == int(record.id))
        .order_by(models.ScvamJob.created_at.desc())
        .first()
    )

    vault_record_id = vault_record_id_for_record(record, job)
    segment_index = scvam_paths.parse_segment_index(vault_record_id)
    enc_relative_path = (job.enc_relative_path if job else None) or str(record.file_name or "")

    _staging_dir, staging_rel = ensure_staging_for_retry(
        record=record,
        admin=admin,
        job=job,
        ai_plain_b64=ai_plain_b64,
    )

    if not job:
        job = models.ScvamJob(
            organization_id=int(admin.organization_id),
            admin_id=int(admin.id),
            vault_record_id=vault_record_id,
            db_record_id=int(record.id),
            enc_relative_path=enc_relative_path,
            segment_index=segment_index,
            status="pending",
            staging_path=staging_rel,
            work_path=f"{staging_rel}/work",
            max_attempts=app_config.SCVAM_MAX_ATTEMPTS,
            duration_sec=int(record.duration or 0) or None,
            resident_name=record.resident_name,
        )
        db.add(job)
    else:
        job.status = "pending"
        job.attempts = 0
        job.error_message = None
        job.finished_at = None
        job.started_at = None
        job.staging_path = staging_rel
        job.work_path = f"{staging_rel}/work"

    record.scvam_status = "pending"
    record.ai_summary = None
    db.flush()

    try:
        meta_path = scvam_paths.vault_meta_path(record)
    except Exception:
        meta_path = None
    if meta_path and meta_path.is_file():
        import json

        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
        except Exception:
            meta = {}
        meta["scvam_status"] = "pending"
        meta.pop("scvam_error", None)
        if job.id:
            meta["scvam_job_id"] = int(job.id)
        meta_path.write_text(json.dumps(meta, ensure_ascii=True, indent=2), encoding="utf-8")

    db.commit()
    db.refresh(record)
    db.refresh(job)
    return record, job
