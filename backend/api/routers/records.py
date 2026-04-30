import base64
import json
import os
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from sqlalchemy import func, or_
from typing import Optional

from backend.api.deps import get_db
from backend.api.rbac import resolve_staff_admin_scope_id
from backend import models, schemas

router = APIRouter(tags=["Records Library"])


#helpers

def _fmt_record(r: models.Record) -> schemas.RecordResponse:
    return schemas.RecordResponse(
        id=r.id,
        resident_name=r.resident_name,
        category=r.category,
        record_type=r.record_type,
        file_url=r.file_url,
        thumbnail_url=r.thumbnail_url,
        duration=r.duration,
        notes=r.notes,
        recorded_at=r.recorded_at,
        created_at=r.created_at.strftime("%Y-%m-%d %H:%M"),
    )


def _fmt_insight(i: models.AiInsight) -> schemas.AiInsightResponse:
    return schemas.AiInsightResponse(
        id=i.id,
        resident_name=i.resident_name,
        title=i.title,
        body=i.body,
        priority=i.priority,
        is_new=i.is_new,
        created_at=i.created_at.strftime("%Y-%m-%d %H:%M"),
    )


def _resolve_encrypted_file_path(record: models.Record) -> Path:
    root = Path(os.getenv("VAULT_STORAGE_ROOT", "databases")).resolve()
    rel = Path(record.file_name or "")
    if not str(rel):
        raise HTTPException(status_code=404, detail="Encrypted file path not set for this record")
    abs_path = (root / rel).resolve()
    try:
        abs_path.relative_to(root)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid encrypted file path") from exc
    return abs_path


#Records

@router.get("/", response_model=list[schemas.RecordResponse])
def get_records(
    search: Optional[str] = Query(None, description="Search by resident name, category, or notes"),
    category: Optional[str] = Query(None, description="e.g. Medication Administration"),
    record_type: Optional[str] = Query(None, description="video | audio | document"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    admin_id: int = Depends(resolve_staff_admin_scope_id),
    db: Session = Depends(get_db),
):
    """
    Records Library grid.
    - search     → searches resident_name, category, notes
    - category   → Category filter dropdown
    - record_type → Format filter dropdown (video | audio | document)
    """
    q = (
        db.query(models.Record)
        .filter(models.Record.admin_id == admin_id, models.Record.is_deleted == False)  # noqa: E712
        .order_by(models.Record.created_at.desc())
    )

    if search:
        term = f"%{search}%"
        q = q.filter(
            or_(
                models.Record.resident_name.ilike(term),
                models.Record.category.ilike(term),
                models.Record.notes.ilike(term),
            )
        )
    if category:
        q = q.filter(models.Record.category == category)
    if record_type:
        q = q.filter(models.Record.record_type == record_type)

    return [_fmt_record(r) for r in q.offset(offset).limit(limit).all()]


@router.get("/categories", response_model=list[str])
def get_categories(admin_id: int = Depends(resolve_staff_admin_scope_id), db: Session = Depends(get_db)):
    """Return distinct categories for the Category dropdown filter."""
    rows = (
        db.query(models.Record.category)
        .filter(models.Record.admin_id == admin_id, models.Record.is_deleted == False)  # noqa: E712
        .distinct()
        .all()
    )
    return [r[0] for r in rows]


@router.post("/", response_model=schemas.RecordResponse, status_code=status.HTTP_201_CREATED)
def upload_record(
    record_in: schemas.RecordCreate,
    admin_id: int = Depends(resolve_staff_admin_scope_id),
    db: Session = Depends(get_db),
):
    """Upload / create a new record (Upload record button)."""
    payload = record_in.model_dump()
    payload["admin_id"] = admin_id
    payload["created_by"] = admin_id
    payload["file_url"] = payload.get("file_url") or "#"
    record = models.Record(**payload)
    db.add(record)
    db.commit()
    db.refresh(record)
    return _fmt_record(record)


@router.post("/vault/upload", response_model=schemas.VaultRecordingUploadOut, status_code=status.HTTP_201_CREATED)
def upload_vault_recording(
    payload: schemas.VaultRecordingUploadIn,
    admin_id: int = Depends(resolve_staff_admin_scope_id),
    db: Session = Depends(get_db),
):
    admin = db.query(models.Admin).filter(models.Admin.id == admin_id).first()
    if not admin:
        raise HTTPException(status_code=404, detail="Admin scope not found")

    try:
        cipher_bytes = base64.b64decode(payload.cipher_b64)
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid cipher_b64 payload") from exc

    root = Path(os.getenv("VAULT_STORAGE_ROOT", "databases"))
    now = payload.started_at or payload.ended_at
    if now is None:
        now = datetime.now(timezone.utc)
    if hasattr(now, "tzinfo") and now.tzinfo is not None:
        now_utc = now.astimezone(timezone.utc)
    else:
        # naive datetimes are interpreted as UTC for deterministic partitioning
        now_utc = now.replace(tzinfo=timezone.utc)

    rel_dir = Path(f"org_{int(admin.organization_id)}") / "vault_recordings" / now_utc.strftime("%Y/%m/%d")
    abs_dir = root / rel_dir
    abs_dir.mkdir(parents=True, exist_ok=True)

    safe_record_id = "".join(ch for ch in str(payload.record_id) if ch.isalnum() or ch in {"-", "_"})
    if not safe_record_id:
        raise HTTPException(status_code=400, detail="Invalid record_id")

    enc_name = f"{safe_record_id}.enc"
    meta_name = f"{safe_record_id}.meta.json"
    enc_path = abs_dir / enc_name
    meta_path = abs_dir / meta_name

    enc_path.write_bytes(cipher_bytes)
    meta_path.write_text(
        json.dumps(
            {
                "record_id": safe_record_id,
                "organization_id": int(admin.organization_id),
                "admin_id": int(admin_id),
                "iv_b64": payload.iv_b64,
                "mime_type": payload.mime_type,
                "duration": payload.duration,
                "started_at": payload.started_at.isoformat() if payload.started_at else None,
                "ended_at": payload.ended_at.isoformat() if payload.ended_at else None,
                "notes": payload.notes,
            },
            ensure_ascii=True,
        ),
        encoding="utf-8",
    )

    file_url = payload.file_url or f"localvault://{safe_record_id}"
    record = models.Record(
        admin_id=admin_id,
        created_by=admin_id,
        resident_name=payload.resident_name,
        category=payload.category or "Local camera recording",
        record_type=payload.record_type or "video",
        file_url=file_url,
        file_name=str((rel_dir / enc_name).as_posix()),
        mime_type=payload.mime_type,
        file_size=len(cipher_bytes),
        duration=payload.duration,
        notes=payload.notes or "Encrypted local vault recording",
        recorded_at=payload.started_at or payload.ended_at,
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return schemas.VaultRecordingUploadOut(
        ok=True,
        record_id=int(record.id),
        file_path=str((rel_dir / enc_name).as_posix()),
        file_url=file_url,
    )


@router.delete("/{record_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_record(record_id: int, admin_id: int = Depends(resolve_staff_admin_scope_id), db: Session = Depends(get_db)):
    """Delete a record by ID."""
    r = db.query(models.Record).filter(models.Record.id == record_id, models.Record.admin_id == admin_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Record not found.")
    db.delete(r)
    db.commit()


#AI Insights

@router.get("/ai-insights", response_model=schemas.AiInsightSummary)
def get_ai_insights(
    priority: Optional[str] = Query(None, description="high | mid | low"),
    limit: int = Query(20, ge=1, le=100),
    admin_id: int = Depends(resolve_staff_admin_scope_id),
    db: Session = Depends(get_db),
):
    """
    Right-panel AI Insight feed.
    Returns priority counts (1 HIGH / 12 MID / 4 LOW) + insight list.
    """
    base_q = (
        db.query(models.AiInsight)
        .filter(models.AiInsight.admin_id == admin_id)
        .order_by(models.AiInsight.created_at.desc())
    )

    high = (
        db.query(func.count(models.AiInsight.id))
        .filter(models.AiInsight.admin_id == admin_id, models.AiInsight.priority == "high")
        .scalar()
    )
    mid = (
        db.query(func.count(models.AiInsight.id))
        .filter(models.AiInsight.admin_id == admin_id, models.AiInsight.priority == "mid")
        .scalar()
    )
    low = (
        db.query(func.count(models.AiInsight.id))
        .filter(models.AiInsight.admin_id == admin_id, models.AiInsight.priority == "low")
        .scalar()
    )

    if priority:
        base_q = base_q.filter(models.AiInsight.priority == priority)

    insights = [_fmt_insight(i) for i in base_q.limit(limit).all()]

    return schemas.AiInsightSummary(high=high, mid=mid, low=low, insights=insights)


@router.post("/ai-insights", response_model=schemas.AiInsightResponse, status_code=status.HTTP_201_CREATED)
def create_ai_insight(
    insight_in: schemas.AiInsightCreate,
    admin_id: int = Depends(resolve_staff_admin_scope_id),
    db: Session = Depends(get_db),
):
    """Create a new AI insight entry."""
    insight = models.AiInsight(**insight_in.model_dump(), admin_id=admin_id)
    db.add(insight)
    db.commit()
    db.refresh(insight)
    return _fmt_insight(insight)


@router.patch("/ai-insights/{insight_id}/seen", response_model=schemas.AiInsightResponse)
def mark_insight_seen(insight_id: int, admin_id: int = Depends(resolve_staff_admin_scope_id), db: Session = Depends(get_db)):
    """Mark an AI insight as seen (clears the NEW badge)."""
    insight = (
        db.query(models.AiInsight)
        .filter(models.AiInsight.id == insight_id, models.AiInsight.admin_id == admin_id)
        .first()
    )
    if not insight:
        raise HTTPException(status_code=404, detail="AI Insight not found.")
    insight.is_new = False
    db.commit()
    db.refresh(insight)
    return _fmt_insight(insight)


@router.get("/{record_id}", response_model=schemas.RecordResponse)
def get_record(
    record_id: int,
    admin_id: int = Depends(resolve_staff_admin_scope_id),
    db: Session = Depends(get_db),
):
    """Get a single record by ID (View button)."""
    r = db.query(models.Record).filter(models.Record.id == record_id, models.Record.admin_id == admin_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Record not found.")
    return _fmt_record(r)


@router.get("/{record_id}/vault/encrypted")
def download_encrypted_record_file(
    record_id: int,
    admin_id: int = Depends(resolve_staff_admin_scope_id),
    db: Session = Depends(get_db),
):
    """
    Download the encrypted vault blob (.enc) for operational verification.
    Requires record ownership within current admin/staff scope.
    """
    record = (
        db.query(models.Record)
        .filter(models.Record.id == record_id, models.Record.admin_id == admin_id, models.Record.is_deleted == False)  # noqa: E712
        .first()
    )
    if not record:
        raise HTTPException(status_code=404, detail="Record not found.")

    enc_path = _resolve_encrypted_file_path(record)
    if not enc_path.exists() or not enc_path.is_file():
        raise HTTPException(status_code=404, detail="Encrypted file not found on server vault")

    admin = db.query(models.Admin).filter(models.Admin.id == admin_id).first()
    if admin:
        db.add(
            models.AuditLog(
                actor_admin_id=int(admin_id),
                organization_id=int(admin.organization_id),
                actor_name=admin.full_name,
                actor_role="admin",
                action="vault_encrypted_file_download",
                entity_type="record",
                entity_id=int(record_id),
                new_values={"file_name": record.file_name},
            )
        )
        db.commit()

    return FileResponse(
        path=str(enc_path),
        media_type="application/octet-stream",
        filename=enc_path.name,
    )


@router.get("/{record_id}/vault/meta")
def get_encrypted_record_meta(
    record_id: int,
    admin_id: int = Depends(resolve_staff_admin_scope_id),
    db: Session = Depends(get_db),
):
    """
    Return server-vault sidecar metadata JSON for a record.
    """
    record = (
        db.query(models.Record)
        .filter(models.Record.id == record_id, models.Record.admin_id == admin_id, models.Record.is_deleted == False)  # noqa: E712
        .first()
    )
    if not record:
        raise HTTPException(status_code=404, detail="Record not found.")

    enc_path = _resolve_encrypted_file_path(record)
    meta_path = enc_path.with_suffix(".meta.json")
    if not meta_path.exists() or not meta_path.is_file():
        raise HTTPException(status_code=404, detail="Encrypted metadata file not found on server vault")

    try:
        payload = json.loads(meta_path.read_text(encoding="utf-8"))
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Encrypted metadata file is invalid JSON") from exc

    admin = db.query(models.Admin).filter(models.Admin.id == admin_id).first()
    if admin:
        db.add(
            models.AuditLog(
                actor_admin_id=int(admin_id),
                organization_id=int(admin.organization_id),
                actor_name=admin.full_name,
                actor_role="admin",
                action="vault_encrypted_meta_read",
                entity_type="record",
                entity_id=int(record_id),
                new_values={"file_name": record.file_name},
            )
        )
        db.commit()

    return {
        "record_id": int(record_id),
        "file_name": record.file_name,
        "meta": payload,
    }
