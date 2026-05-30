from __future__ import annotations

import json
import shutil
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path

from sqlalchemy.orm import Session

from backend import models
from backend.services.ai_flag_realtime import broadcast_ai_flag_created_sync
from backend.services.scvam import crypto as scvam_crypto
from backend.services.scvam import paths as scvam_paths
from backend.services.scvam.output_writer import write_scvam_output_folder
from backend.services.scvam.results import ScvamParsedResults, build_flag_candidates
from backend.services.scvam.runner import ScvamRunResult


def _sec_to_hhmmss(sec: float) -> str:
    t = max(0, int(sec))
    hh, mm, ss = t // 3600, (t % 3600) // 60, t % 60
    return f"{hh:02d}:{mm:02d}:{ss:02d}"


def apply_scvam_results(
    db: Session,
    *,
    job: models.ScvamJob,
    run_result: ScvamRunResult,
    parsed: ScvamParsedResults,
    source_video: Path | None = None,
) -> None:
    record = db.query(models.Record).filter(models.Record.id == job.db_record_id).first()
    admin = db.query(models.Admin).filter(models.Admin.id == job.admin_id).first()
    if not record or not admin:
        raise ValueError("Record or admin not found for SCVAM persist")

    summary = parsed.summary_text or parsed.summary_heading or "SCVAM analysis completed."
    record.ai_summary = summary
    record.scvam_status = "ready"

    job_meta: dict = {
        "vault_record_id": job.vault_record_id,
        "db_record_id": int(record.id),
        "duration_sec": job.duration_sec,
        "original_filename": job.vault_record_id,
        "video_name": job.vault_record_id,
    }
    staging_dir = scvam_paths.vault_root() / (job.staging_path or "")
    manifest_path = staging_dir / "manifest.json"
    if manifest_path.is_file():
        try:
            job_meta.update(json.loads(manifest_path.read_text(encoding="utf-8")))
        except Exception:
            pass

    video_name = str(job_meta.get("video_name") or job_meta.get("original_filename") or job.vault_record_id)
    out_folder = write_scvam_output_folder(
        org_id=int(job.organization_id),
        video_name=Path(str(job_meta.get("original_filename", video_name))).stem,
        source_video=source_video,
        run_result=run_result,
        parsed=parsed,
        job_meta=job_meta,
    )
    record.scvam_output_path = out_folder.relative_to(scvam_paths.vault_root()).as_posix()

    bundle = {
        "model": "scvam2.1",
        "vault_record_id": job.vault_record_id,
        "summary": parsed.llm_raw,
        "events": parsed.events_raw,
        "run_dir": str(run_result.run_dir),
    }
    enc_blob = scvam_crypto.encrypt_json_bundle(int(job.organization_id), bundle)
    enc_sidecar = scvam_paths.scvam_output_enc_path(record)
    if enc_sidecar.parent.exists() or record.file_name:
        try:
            enc_sidecar.parent.mkdir(parents=True, exist_ok=True)
            enc_sidecar.write_bytes(enc_blob)
        except Exception:
            pass

    now = datetime.now(timezone.utc)
    flag_candidates = build_flag_candidates(parsed, summary_text=summary)
    created_flag_ids: list[int] = []
    created_flags: list[models.Flag] = []
    for p in flag_candidates:
        f = models.Flag(
            admin_id=int(job.admin_id),
            resident_id=record.resident_id,
            resident_name=job.resident_name or record.resident_name or "This device",
            event_type=p.event_type,
            description=p.description,
            severity=p.severity,
            source="AI",
            status="Pending Review",
            sev_desc=p.sev_desc,
            transcript=p.transcript,
            video_timestamp=_sec_to_hhmmss(p.timestamp_sec),
            ai_confidence=Decimal(str(round(p.ai_confidence * 100.0, 2))),
            flagged_at=now,
            created_by=int(job.admin_id),
        )
        db.add(f)
        db.flush()
        created_flag_ids.append(int(f.id))
        created_flags.append(f)

    priority = "high" if flag_candidates and any(c.severity == "High" for c in flag_candidates) else "mid"
    db.add(
        models.AiInsight(
            admin_id=int(job.admin_id),
            resident_id=record.resident_id,
            resident_name=job.resident_name or record.resident_name or "This device",
            related_record_id=int(record.id),
            related_flag_id=created_flag_ids[0] if created_flag_ids else None,
            title=f"SCVAM Summary ({job.camera_id or 'camera'})",
            body=summary,
            category="cctv_visual",
            priority=priority,
            is_new=True,
            generated_by_model="scvam2.1",
        )
    )

    db.add(
        models.AuditLog(
            actor_admin_id=int(job.admin_id),
            organization_id=int(job.organization_id),
            actor_name=admin.full_name,
            actor_role="admin",
            action="scvam_analysis_completed",
            entity_type="record",
            entity_id=int(record.id),
            new_values={
                "flags_created": len(created_flag_ids),
                "events_count": len(parsed.events),
                "vault_record_id": job.vault_record_id,
                "scvam_output_path": record.scvam_output_path,
                "scvam_output_folder": str(out_folder),
            },
        )
    )

    meta_path = scvam_paths.vault_meta_path(record)
    if meta_path.is_file():
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
        except Exception:
            meta = {}
    else:
        meta = {}
    meta["scvam_status"] = "ready"
    meta["scvam_job_id"] = int(job.id)
    meta_path.write_text(json.dumps(meta, ensure_ascii=True, indent=2), encoding="utf-8")

    job.status = "done"
    job.finished_at = datetime.now(timezone.utc)
    job.error_message = None
    db.commit()

    for f in created_flags:
        try:
            broadcast_ai_flag_created_sync(f, db)
        except Exception:
            pass


def mark_job_failed(
    db: Session,
    *,
    job: models.ScvamJob,
    error_message: str,
    requeue: bool,
) -> None:
    job.error_message = error_message[:4000]
    if requeue:
        job.status = "pending"
    else:
        job.status = "failed"
        job.finished_at = datetime.now(timezone.utc)
        record = db.query(models.Record).filter(models.Record.id == job.db_record_id).first()
        if record:
            record.scvam_status = "failed"
            meta_path = scvam_paths.vault_meta_path(record)
            if meta_path.is_file():
                try:
                    meta = json.loads(meta_path.read_text(encoding="utf-8"))
                except Exception:
                    meta = {}
                meta["scvam_status"] = "failed"
                meta["scvam_error"] = error_message[:500]
                meta_path.write_text(json.dumps(meta, ensure_ascii=True, indent=2), encoding="utf-8")
    db.commit()


def cleanup_staging(staging_path: str | None) -> None:
    if not staging_path:
        return
    root = scvam_paths.vault_root()
    target = (root / staging_path).resolve()
    try:
        target.relative_to(root)
    except ValueError:
        return
    if target.is_dir():
        shutil.rmtree(target, ignore_errors=True)
