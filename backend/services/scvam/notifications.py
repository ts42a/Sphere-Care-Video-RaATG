"""Dashboard alerts and camera alerts when SCVAM creates flags."""

from __future__ import annotations

from pathlib import Path

from sqlalchemy.orm import Session

from backend import models
from backend.services.scvam.flag_utils import primary_scvam_flag
from backend.services.scvam.inbox import parse_staging_vault_id


def scvam_subject_labels(job: models.ScvamJob, record: models.Record) -> tuple[str, str]:
    """Resident display name and room label (test videos use Test · {video} / TEST-{folder})."""
    vault_id = str(job.vault_record_id or "")
    if not vault_id.startswith("rec_"):
        folder, _ = parse_staging_vault_id(vault_id)
        stem = Path(record.file_name).stem if record and record.file_name else folder
        return f"Test · {stem}", f"TEST-{folder}"
    return (
        job.resident_name or record.resident_name or "This device",
        job.room or "—",
    )


def _resolve_camera_id(db: Session, job: models.ScvamJob, admin_id: int) -> int | None:
    if job.camera_id:
        try:
            cid = int(job.camera_id)
            if db.query(models.Camera).filter(models.Camera.id == cid).first():
                return cid
        except (TypeError, ValueError):
            pass
    cam = (
        db.query(models.Camera)
        .filter(models.Camera.admin_id == admin_id)
        .order_by(models.Camera.id.asc())
        .first()
    )
    return int(cam.id) if cam else None


def create_scvam_notifications(
    db: Session,
    *,
    job: models.ScvamJob,
    record: models.Record,
    flags: list[models.Flag],
    summary: str,
) -> None:
    """Insert dashboard Alert + recording-console CameraAlert for SCVAM flags."""
    if not flags:
        return

    admin_id = int(job.admin_id)
    resident_label, room_label = scvam_subject_labels(job, record)

    for flag in flags:
        level = "critical" if str(flag.severity or "").lower() == "high" else "warning"
        db.add(
            models.Alert(
                admin_id=admin_id,
                level=level,
                title=f"{flag.event_type} — {resident_label}",
                message=(flag.description or flag.sev_desc or summary or "")[:900],
                source="SCVAM",
                related_entity_type="flag",
                related_entity_id=int(flag.id),
                is_read=False,
            )
        )

    cam_id = _resolve_camera_id(db, job, admin_id)
    if not cam_id:
        return

    top = primary_scvam_flag(flags) or flags[0]
    event_lower = str(top.event_type or "").lower()
    icon = "fall" if "fall" in event_lower else "person"
    db.add(
        models.CameraAlert(
            admin_id=admin_id,
            camera_id=cam_id,
            resident_id=record.resident_id,
            alert_type=top.event_type,
            severity=top.severity,
            icon=icon,
            title=f"{top.event_type} — {resident_label}",
            description=f"Room {room_label}: {(top.description or summary or '')[:400]}",
            video_timestamp=top.video_timestamp,
            resolved=False,
        )
    )
