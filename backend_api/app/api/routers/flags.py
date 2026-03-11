"""
flags.py — Flags & Reviews router

Endpoints:
  GET    /flags/stats              → FlagStats (counts for dashboard)
  GET    /flags/                   → list[FlagResponse]  (with filters)
  GET    /flags/{id}               → FlagResponse
  POST   /flags/                   → FlagResponse  (create flag)
  PATCH  /flags/{id}/status        → FlagResponse  (update status)
  DELETE /flags/{id}               → 204

  GET    /flags/{id}/comments      → list[FlagCommentResponse]
  POST   /flags/{id}/comments      → FlagCommentResponse
"""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import Optional
from datetime import datetime, date

from app.api.deps import get_db
from app import models, schemas

router = APIRouter(prefix="/flags", tags=["Flags & Reviews"])


#helpers

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
        flagged_at=flag.flagged_at.strftime("%b %d, %Y %I:%M %p") if flag.flagged_at else "",
        created_at=flag.created_at.strftime("%b %d, %Y %I:%M %p") if flag.created_at else "",
        comments=[
            schemas.FlagCommentResponse(
                id=c.id,
                flag_id=c.flag_id,
                author=c.author,
                body=c.body,
                created_at=c.created_at.strftime("%b %d, %Y %I:%M %p"),
            )
            for c in (flag.comments or [])
        ],
    )


#routes

@router.get("/stats", response_model=schemas.FlagStats)
def get_flag_stats(db: Session = Depends(get_db)):
    """
    Dashboard summary counts:
      - ai_flags_today  : AI-sourced flags created today
      - manual_flags    : Staff-sourced flags (all time)
      - pending_review  : flags with status "Pending Review"
      - resolved        : flags with status "Resolved"
      - total           : all flags
    """
    today = date.today()

    ai_today = (
        db.query(models.Flag)
        .filter(
            models.Flag.source == "AI",
            func.date(models.Flag.created_at) == today,
        )
        .count()
    )
    manual = db.query(models.Flag).filter(models.Flag.source == "Staff").count()
    pending = db.query(models.Flag).filter(models.Flag.status == "Pending Review").count()
    resolved = db.query(models.Flag).filter(models.Flag.status == "Resolved").count()
    total = db.query(models.Flag).count()

    return schemas.FlagStats(
        ai_flags_today=ai_today,
        manual_flags=manual,
        pending_review=pending,
        resolved=resolved,
        total=total,
    )


@router.get("/", response_model=list[schemas.FlagResponse])
def list_flags(
    resident_name: Optional[str] = Query(None),
    resident_id:   Optional[str] = Query(None),
    event_type:    Optional[str] = Query(None),
    severity:      Optional[str] = Query(None),
    status:        Optional[str] = Query(None),
    source:        Optional[str] = Query(None),
    search:        Optional[str] = Query(None),   # searches resident_name + description
    limit:  int = Query(50, le=200),
    offset: int = Query(0),
    db: Session = Depends(get_db),
):
    """
    List all flags with optional filters.
    Returns newest first.
    """
    q = db.query(models.Flag).order_by(models.Flag.flagged_at.desc())

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
        term = f"%{search}%"
        q = q.filter(
            models.Flag.resident_name.ilike(term) |
            models.Flag.description.ilike(term) |
            models.Flag.event_type.ilike(term)
        )

    flags = q.offset(offset).limit(limit).all()

    # fallback: return empty list (frontend uses demo data when empty)
    return [_fmt(f) for f in flags]


@router.get("/{flag_id}", response_model=schemas.FlagResponse)
def get_flag(flag_id: int, db: Session = Depends(get_db)):
    """Get a single flag by ID (includes comments)."""
    flag = db.query(models.Flag).filter(models.Flag.id == flag_id).first()
    if not flag:
        raise HTTPException(status_code=404, detail="Flag not found.")
    return _fmt(flag)


@router.post("/", response_model=schemas.FlagResponse, status_code=status.HTTP_201_CREATED)
def create_flag(flag_in: schemas.FlagCreate, db: Session = Depends(get_db)):
    """
    Create a new flag (AI or Staff).
    flagged_at defaults to now if not provided.
    """
    flagged_at = datetime.utcnow()
    if flag_in.flagged_at:
        try:
            flagged_at = datetime.fromisoformat(flag_in.flagged_at)
        except ValueError:
            pass

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
    db.add(flag)
    db.commit()
    db.refresh(flag)
    return _fmt(flag)


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
    valid = {"Open", "Pending Review", "Resolved", "Escalated"}
    if body.status not in valid:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid status. Must be one of: {', '.join(valid)}",
        )
    flag = db.query(models.Flag).filter(models.Flag.id == flag_id).first()
    if not flag:
        raise HTTPException(status_code=404, detail="Flag not found.")
    flag.status = body.status
    db.commit()
    db.refresh(flag)
    return _fmt(flag)


@router.delete("/{flag_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_flag(flag_id: int, db: Session = Depends(get_db)):
    """Delete a flag and all its comments."""
    flag = db.query(models.Flag).filter(models.Flag.id == flag_id).first()
    if not flag:
        raise HTTPException(status_code=404, detail="Flag not found.")
    db.delete(flag)
    db.commit()


#comments
@router.get("/{flag_id}/comments", response_model=list[schemas.FlagCommentResponse])
def get_comments(flag_id: int, db: Session = Depends(get_db)):
    """Get all comments for a flag."""
    flag = db.query(models.Flag).filter(models.Flag.id == flag_id).first()
    if not flag:
        raise HTTPException(status_code=404, detail="Flag not found.")
    return [
        schemas.FlagCommentResponse(
            id=c.id,
            flag_id=c.flag_id,
            author=c.author,
            body=c.body,
            created_at=c.created_at.strftime("%b %d, %Y %I:%M %p"),
        )
        for c in flag.comments
    ]


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
    flag = db.query(models.Flag).filter(models.Flag.id == flag_id).first()
    if not flag:
        raise HTTPException(status_code=404, detail="Flag not found.")
    comment = models.FlagComment(flag_id=flag_id, author=body.author, body=body.body)
    db.add(comment)
    db.commit()
    db.refresh(comment)
    return schemas.FlagCommentResponse(
        id=comment.id,
        flag_id=comment.flag_id,
        author=comment.author,
        body=comment.body,
        created_at=comment.created_at.strftime("%b %d, %Y %I:%M %p"),
    )
