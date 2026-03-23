"""
flags.py — Flags & Reviews router

Endpoints:
  GET    /flags/stats              -> FlagStats
  GET    /flags/                   -> list[FlagResponse]
  GET    /flags/{id}               -> FlagResponse
  POST   /flags/                   -> FlagResponse
  PATCH  /flags/{id}/status        -> FlagResponse
  DELETE /flags/{id}               -> 204

  GET    /flags/{id}/comments      -> list[FlagCommentResponse]
  POST   /flags/{id}/comments      -> FlagCommentResponse
"""

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import func, or_
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, selectinload

from backend.api.deps import get_db
from backend import models, schemas

router = APIRouter(prefix="/flags", tags=["Flags & Reviews"])

VALID_STATUSES = ("Open", "Pending Review", "Resolved", "Escalated")


# ---------- helpers ----------

def _format_dt(dt: Optional[datetime]) -> str:
    return dt.strftime("%b %d, %Y %I:%M %p") if dt else ""


def _parse_flagged_at(value: Optional[str]) -> datetime:
    """
    Accept ISO datetime strings.
    Examples:
      2026-03-19T12:30:00
      2026-03-19T12:30:00Z
      2026-03-19 12:30:00
    Returns naive UTC-like datetime to stay compatible with existing app style.
    """
    if not value:
        return datetime.utcnow()

    cleaned = value.strip()

    # support trailing Z
    if cleaned.endswith("Z"):
        cleaned = cleaned[:-1] + "+00:00"

    try:
        parsed = datetime.fromisoformat(cleaned)
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail="Invalid flagged_at format. Use ISO format, e.g. 2026-03-19T12:30:00",
        )

    # if timezone-aware, convert to naive UTC
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone().replace(tzinfo=None)

    return parsed


def _fmt_comment(comment: models.FlagComment) -> schemas.FlagCommentResponse:
    return schemas.FlagCommentResponse(
        id=comment.id,
        flag_id=comment.flag_id,
        author=comment.author,
        body=comment.body,
        created_at=_format_dt(comment.created_at),
    )


def _fmt(flag: models.Flag) -> schemas.FlagResponse:
    return schemas.FlagResponse(
        id=flag.id,
        resident_name=flag.resident_name,
        resident_id=flag.resident_id,
        event_type=flag.event_type,
        description=flag.description,
        severity=flag.severity,
        source=flag.source,
        status=flag.status,
        sev_desc=flag.sev_desc,
        transcript=flag.transcript,
        video_timestamp=flag.video_timestamp,
        ai_confidence=flag.ai_confidence,
        flagged_at=_format_dt(flag.flagged_at),
        created_at=_format_dt(flag.created_at),
        comments=[_fmt_comment(c) for c in (flag.comments or [])],
    )


def _get_flag_or_404(db: Session, flag_id: int) -> models.Flag:
    flag = (
        db.query(models.Flag)
        .options(selectinload(models.Flag.comments))
        .filter(models.Flag.id == flag_id)
        .first()
    )
    if not flag:
        raise HTTPException(status_code=404, detail="Flag not found.")
    return flag


# ---------- routes ----------

@router.get("/stats", response_model=schemas.FlagStats)
def get_flag_stats(db: Session = Depends(get_db)):
    """
    Dashboard summary counts:
      - ai_flags_today  : AI-sourced flags created today (UTC-based)
      - manual_flags    : Staff-sourced flags (all time)
      - pending_review  : flags with status "Pending Review"
      - resolved        : flags with status "Resolved"
      - total           : all flags
    """
    today = datetime.utcnow().date()

    ai_flags_today = (
        db.query(func.count(models.Flag.id))
        .filter(
            models.Flag.source == "AI",
            func.date(models.Flag.created_at) == today,
        )
        .scalar()
        or 0
    )

    manual_flags = (
        db.query(func.count(models.Flag.id))
        .filter(models.Flag.source == "Staff")
        .scalar()
        or 0
    )

    pending_review = (
        db.query(func.count(models.Flag.id))
        .filter(models.Flag.status == "Pending Review")
        .scalar()
        or 0
    )

    resolved = (
        db.query(func.count(models.Flag.id))
        .filter(models.Flag.status == "Resolved")
        .scalar()
        or 0
    )

    total = db.query(func.count(models.Flag.id)).scalar() or 0

    return schemas.FlagStats(
        ai_flags_today=ai_flags_today,
        manual_flags=manual_flags,
        pending_review=pending_review,
        resolved=resolved,
        total=total,
    )


@router.get("/", response_model=list[schemas.FlagResponse])
def list_flags(
    resident_name: Optional[str] = Query(None),
    resident_id: Optional[str] = Query(None),
    event_type: Optional[str] = Query(None),
    severity: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    source: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    """
    List all flags with optional filters.
    Returns newest first.
    """
    q = (
        db.query(models.Flag)
        .options(selectinload(models.Flag.comments))
        .order_by(models.Flag.flagged_at.desc(), models.Flag.id.desc())
    )

    if resident_name:
        q = q.filter(models.Flag.resident_name.ilike(f"%{resident_name}%"))
    if resident_id:
        q = q.filter(models.Flag.resident_id == resident_id)
    if event_type:
        q = q.filter(models.Flag.event_type == event_type)
    if severity:
        q = q.filter(models.Flag.severity == severity)
    if status:
        q = q.filter(models.Flag.status == status)
    if source:
        q = q.filter(models.Flag.source == source)
    if search:
        term = f"%{search.strip()}%"
        q = q.filter(
            or_(
                models.Flag.resident_name.ilike(term),
                models.Flag.description.ilike(term),
                models.Flag.event_type.ilike(term),
            )
        )

    flags = q.offset(offset).limit(limit).all()
    return [_fmt(f) for f in flags]


@router.get("/{flag_id}", response_model=schemas.FlagResponse)
def get_flag(flag_id: int, db: Session = Depends(get_db)):
    """Get a single flag by ID (includes comments)."""
    flag = _get_flag_or_404(db, flag_id)
    return _fmt(flag)


@router.post("/", response_model=schemas.FlagResponse, status_code=status.HTTP_201_CREATED)
def create_flag(flag_in: schemas.FlagCreate, db: Session = Depends(get_db)):
    """
    Create a new flag (AI or Staff).
    flagged_at defaults to now if not provided.
    """
    flagged_at = _parse_flagged_at(flag_in.flagged_at)

    flag = models.Flag(
        resident_name=flag_in.resident_name,
        resident_id=flag_in.resident_id,
        event_type=flag_in.event_type,
        description=flag_in.description,
        severity=flag_in.severity,
        source=flag_in.source,
        status=flag_in.status,
        sev_desc=flag_in.sev_desc,
        transcript=flag_in.transcript,
        video_timestamp=flag_in.video_timestamp,
        ai_confidence=flag_in.ai_confidence,
        flagged_at=flagged_at,
    )

    try:
        db.add(flag)
        db.commit()
        db.refresh(flag)
        flag = _get_flag_or_404(db, flag.id)
        return _fmt(flag)
    except SQLAlchemyError:
        db.rollback()
        raise HTTPException(status_code=500, detail="Failed to create flag.")


@router.patch("/{flag_id}/status", response_model=schemas.FlagResponse)
def update_flag_status(
    flag_id: int,
    body: schemas.FlagStatusUpdate,
    db: Session = Depends(get_db),
):
    """
    Update the status of a flag.
    Valid values: Open | Pending Review | Resolved | Escalated
    """
    if body.status not in VALID_STATUSES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid status. Must be one of: {', '.join(VALID_STATUSES)}",
        )

    flag = _get_flag_or_404(db, flag_id)
    flag.status = body.status

    try:
        db.commit()
        db.refresh(flag)
        flag = _get_flag_or_404(db, flag.id)
        return _fmt(flag)
    except SQLAlchemyError:
        db.rollback()
        raise HTTPException(status_code=500, detail="Failed to update flag status.")


@router.delete("/{flag_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_flag(flag_id: int, db: Session = Depends(get_db)):
    """Delete a flag."""
    flag = db.query(models.Flag).filter(models.Flag.id == flag_id).first()
    if not flag:
        raise HTTPException(status_code=404, detail="Flag not found.")

    try:
        db.delete(flag)
        db.commit()
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    except SQLAlchemyError:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail="Failed to delete flag. Check comment relationship cascade settings.",
        )


# ---------- comments ----------

@router.get("/{flag_id}/comments", response_model=list[schemas.FlagCommentResponse])
def get_comments(flag_id: int, db: Session = Depends(get_db)):
    """Get all comments for a flag."""
    flag = _get_flag_or_404(db, flag_id)
    return [_fmt_comment(c) for c in flag.comments]


@router.post(
    "/{flag_id}/comments",
    response_model=schemas.FlagCommentResponse,
    status_code=status.HTTP_201_CREATED,
)
def add_comment(
    flag_id: int,
    body: schemas.FlagCommentCreate,
    db: Session = Depends(get_db),
):
    """Add a staff comment to a flag."""
    _get_flag_or_404(db, flag_id)

    comment = models.FlagComment(
        flag_id=flag_id,
        author=body.author,
        body=body.body,
    )

    try:
        db.add(comment)
        db.commit()
        db.refresh(comment)
        return _fmt_comment(comment)
    except SQLAlchemyError:
        db.rollback()
        raise HTTPException(status_code=500, detail="Failed to add comment.")
