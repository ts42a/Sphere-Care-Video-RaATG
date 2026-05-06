"""
flags.py — Flags & Reviews router

Status lifecycle:
  new → in_review → confirmed → escalated → resolved | false_alarm

Review actions:
  confirm      new/in_review  → in_review   (staff opens + confirms)
  false_alarm  any            → false_alarm  (AI was wrong)
  escalate     any            → escalated    (needs senior attention)
  resolve      any            → resolved     (fully handled)
  reopen       resolved/false → new          (needs re-examination)

Endpoints:
  GET    /flags/stats                  → FlagStats
  GET    /flags/                       → list[FlagResponse]
  GET    /flags/{id}                   → FlagResponse
  POST   /flags/                       → FlagResponse
  PATCH  /flags/{id}/status            → FlagResponse  (direct status override)
  DELETE /flags/{id}                   → 204

  POST   /flags/{id}/review            → FlagReviewResponse  ← NEW
  GET    /flags/{id}/reviews           → list[FlagReviewResponse]

  GET    /flags/{id}/comments          → list[FlagCommentResponse]
  POST   /flags/{id}/comments          → FlagCommentResponse
"""

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import func, or_
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, selectinload

from backend.api.deps import get_db
from backend import models, schemas

router = APIRouter(tags=["Flags & Reviews"])

VALID_STATUSES = ("new", "in_review", "confirmed", "escalated", "resolved", "false_alarm")

VALID_REVIEW_ACTIONS = ("confirm", "false_alarm", "escalate", "resolve", "reopen")

# Status after each review action
REVIEW_STATUS_MAP = {
    "confirm":     "in_review",
    "false_alarm": "false_alarm",
    "escalate":    "escalated",
    "resolve":     "resolved",
    "reopen":      "new",
}

# Notification messages for each action
REVIEW_NOTIFY = {
    "confirm":     ("info",     "Flag Under Review",     "A flag has been confirmed and is now under review."),
    "false_alarm": ("info",     "Flag Cleared",          "A flag was marked as a false alarm by staff."),
    "escalate":    ("critical", "Flag Escalated",        "A flag has been escalated and requires urgent attention."),
    "resolve":     ("info",     "Flag Resolved",         "A flag has been resolved by staff."),
    "reopen":      ("warning",  "Flag Reopened",         "A previously resolved flag has been reopened for review."),
}


# ── Helpers ───────────────────────────────────────────────────────────────────

def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _fmt(dt: Optional[datetime]) -> str:
    return dt.strftime("%b %d, %Y %I:%M %p") if dt else ""


def _parse_flagged_at(value: Optional[str]) -> datetime:
    if not value:
        return _now_utc()
    cleaned = value.strip()
    if cleaned.endswith("Z"):
        cleaned = cleaned[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(cleaned)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid flagged_at format. Use ISO, e.g. 2026-03-19T12:30:00")
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone(timezone.utc).replace(tzinfo=None)
    return parsed


def _fmt_review(r: models.FlagReview) -> schemas.FlagReviewResponse:
    return schemas.FlagReviewResponse(
        id=r.id,
        flag_id=r.flag_id,
        reviewer_name=r.reviewer_name,
        reviewer_role=r.reviewer_role,
        review_action=r.review_action,
        previous_status=r.previous_status,
        new_status=r.new_status,
        notes=r.notes,
        ai_confidence=float(r.ai_confidence) if r.ai_confidence else None,
        reviewed_at=_fmt(r.reviewed_at),
    )


def _fmt_comment(c: models.FlagComment) -> schemas.FlagCommentResponse:
    return schemas.FlagCommentResponse(
        id=c.id,
        flag_id=c.flag_id,
        author_name=c.author_name,
        body=c.body,
        created_at=_fmt(c.created_at),
    )


def _fmt_flag(flag: models.Flag) -> schemas.FlagResponse:
    return schemas.FlagResponse(
        id=flag.id,
        resident_name=flag.resident_name,
        resident_id=flag.resident_id,
        camera_id=flag.camera_id,
        event_type=flag.event_type,
        description=flag.description,
        severity=flag.severity,
        source=flag.source,
        status=flag.status,
        sev_desc=flag.sev_desc,
        transcript=flag.transcript,
        video_timestamp=flag.video_timestamp,
        ai_confidence=float(flag.ai_confidence) if flag.ai_confidence else None,
        flagged_at=_fmt(flag.flagged_at),
        created_at=_fmt(flag.created_at),
        reviewed_by_name=flag.reviewed_by_name,
        first_reviewed_at=_fmt(flag.first_reviewed_at) if flag.first_reviewed_at else None,
        resolved_at=_fmt(flag.resolved_at) if flag.resolved_at else None,
        escalated_at=_fmt(flag.escalated_at) if flag.escalated_at else None,
        comments=[_fmt_comment(c) for c in (flag.comments or [])],
        reviews=[_fmt_review(r) for r in (flag.reviews or [])],
    )


def _get_flag_or_404(db: Session, flag_id: int) -> models.Flag:
    flag = (
        db.query(models.Flag)
        .options(
            selectinload(models.Flag.comments),
            selectinload(models.Flag.reviews),
        )
        .filter(models.Flag.id == flag_id)
        .first()
    )
    if not flag:
        raise HTTPException(status_code=404, detail="Flag not found.")
    return flag


def _send_notification(
    db: Session,
    admin_id: int,
    level: str,
    title: str,
    message: str,
    flag_id: int,
) -> None:
    """Create an Alert notification for the relevant admin/staff."""
    try:
        alert = models.Alert(
            admin_id=admin_id,
            level=level,
            title=title,
            message=message,
            source="flag_review",
            related_entity_type="flag",
            related_entity_id=flag_id,
            is_read=False,
            created_at=_now_utc(),
        )
        db.add(alert)
    except Exception:
        pass  # Never let notification failure break the review flow


# ── Stats ─────────────────────────────────────────────────────────────────────

@router.get("/stats", response_model=schemas.FlagStats)
def get_flag_stats(db: Session = Depends(get_db)):
    today = _now_utc().date()

    def _count(filters) -> int:
        q = db.query(func.count(models.Flag.id))
        for f in filters:
            q = q.filter(f)
        return q.scalar() or 0

    return schemas.FlagStats(
        ai_flags_today=_count([models.Flag.source == "AI", func.date(models.Flag.created_at) == today]),
        manual_flags=_count([models.Flag.source == "Staff"]),
        pending_review=_count([models.Flag.status == "new"]),
        in_review=_count([models.Flag.status == "in_review"]),
        escalated=_count([models.Flag.status == "escalated"]),
        resolved=_count([models.Flag.status == "resolved"]),
        false_alarms=_count([models.Flag.status == "false_alarm"]),
        total=_count([]),
    )


# ── List flags ────────────────────────────────────────────────────────────────

@router.get("/", response_model=list[schemas.FlagResponse])
def list_flags(
    resident_name: Optional[str] = Query(None),
    resident_id:   Optional[int] = Query(None),
    event_type:    Optional[str] = Query(None),
    severity:      Optional[str] = Query(None),
    status:        Optional[str] = Query(None),
    source:        Optional[str] = Query(None),
    search:        Optional[str] = Query(None),
    limit:  int = Query(50, ge=1, le=200),
    offset: int = Query(0,  ge=0),
    db: Session = Depends(get_db),
):
    q = (
        db.query(models.Flag)
        .options(
            selectinload(models.Flag.comments),
            selectinload(models.Flag.reviews),
        )
        .filter(models.Flag.is_deleted == False)  # noqa: E712
        .order_by(models.Flag.flagged_at.desc(), models.Flag.id.desc())
    )

    if resident_name: q = q.filter(models.Flag.resident_name.ilike(f"%{resident_name}%"))
    if resident_id:   q = q.filter(models.Flag.resident_id == resident_id)
    if event_type:    q = q.filter(models.Flag.event_type == event_type)
    if severity:      q = q.filter(models.Flag.severity == severity)
    if status:        q = q.filter(models.Flag.status == status)
    if source:        q = q.filter(models.Flag.source == source)
    if search:
        term = f"%{search.strip()}%"
        q = q.filter(or_(
            models.Flag.resident_name.ilike(term),
            models.Flag.description.ilike(term),
            models.Flag.event_type.ilike(term),
        ))

    return [_fmt_flag(f) for f in q.offset(offset).limit(limit).all()]


# ── Get single flag ───────────────────────────────────────────────────────────

@router.get("/{flag_id}", response_model=schemas.FlagResponse)
def get_flag(flag_id: int, db: Session = Depends(get_db)):
    return _fmt_flag(_get_flag_or_404(db, flag_id))


# ── Create flag ───────────────────────────────────────────────────────────────

@router.post("/", response_model=schemas.FlagResponse, status_code=status.HTTP_201_CREATED)
def create_flag(flag_in: schemas.FlagCreate, db: Session = Depends(get_db)):
    flagged_at = _parse_flagged_at(flag_in.flagged_at)
    flag = models.Flag(
        resident_name=flag_in.resident_name,
        resident_id=flag_in.resident_id,
        camera_id=flag_in.camera_id,
        event_type=flag_in.event_type,
        description=flag_in.description,
        severity=flag_in.severity,
        source=flag_in.source,
        status=flag_in.status or "new",
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
        return _fmt_flag(_get_flag_or_404(db, flag.id))
    except SQLAlchemyError:
        db.rollback()
        raise HTTPException(status_code=500, detail="Failed to create flag.")


# ── Direct status update (admin override) ────────────────────────────────────

@router.patch("/{flag_id}/status", response_model=schemas.FlagResponse)
def update_flag_status(
    flag_id: int,
    body: schemas.FlagStatusUpdate,
    db: Session = Depends(get_db),
):
    if body.status not in VALID_STATUSES:
        raise HTTPException(status_code=400, detail=f"Invalid status. Must be one of: {', '.join(VALID_STATUSES)}")
    flag = _get_flag_or_404(db, flag_id)
    flag.status = body.status
    try:
        db.commit()
        db.refresh(flag)
        return _fmt_flag(_get_flag_or_404(db, flag.id))
    except SQLAlchemyError:
        db.rollback()
        raise HTTPException(status_code=500, detail="Failed to update flag status.")


# ── Delete flag ───────────────────────────────────────────────────────────────

@router.delete("/{flag_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_flag(flag_id: int, db: Session = Depends(get_db)):
    flag = db.query(models.Flag).filter(models.Flag.id == flag_id).first()
    if not flag:
        raise HTTPException(status_code=404, detail="Flag not found.")
    try:
        db.delete(flag)
        db.commit()
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    except SQLAlchemyError:
        db.rollback()
        raise HTTPException(status_code=500, detail="Failed to delete flag.")


# ══════════════════════════════════════════════════════════════════════════════
# REVIEW WORKFLOW
# ══════════════════════════════════════════════════════════════════════════════

@router.post("/{flag_id}/review", response_model=schemas.FlagReviewResponse, status_code=status.HTTP_201_CREATED)
def submit_review(
    flag_id: int,
    body: schemas.FlagReviewCreate,
    db: Session = Depends(get_db),
):
    """
    Staff submits a review action on a flag.

    Actions:
      confirm      → status becomes in_review  (staff opens & confirms genuine)
      false_alarm  → status becomes false_alarm (AI was wrong)
      escalate     → status becomes escalated   (needs senior/admin)
      resolve      → status becomes resolved    (fully handled)
      reopen       → status becomes new         (re-examine)

    Side effects:
      - Flag status updated
      - Lifecycle timestamps set (first_reviewed_at, resolved_at, escalated_at)
      - reviewed_by_name updated
      - Alert notification created
    """
    if body.review_action not in VALID_REVIEW_ACTIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid review_action. Must be one of: {', '.join(VALID_REVIEW_ACTIONS)}"
        )

    flag = _get_flag_or_404(db, flag_id)
    now  = _now_utc()

    previous_status = flag.status
    new_status      = REVIEW_STATUS_MAP[body.review_action]

    # ── Update flag ──────────────────────────────────────────────
    flag.status          = new_status
    flag.reviewed_by_name= body.reviewer_name
    flag.reviewed_by_id  = body.reviewer_user_id

    if not flag.first_reviewed_at:
        flag.first_reviewed_at = now

    if body.review_action == "resolve":
        flag.resolved_at = now
    elif body.review_action == "escalate":
        flag.escalated_at = now
    elif body.review_action == "reopen":
        flag.resolved_at  = None
        flag.escalated_at = None

    # ── Create review record ──────────────────────────────────────
    review = models.FlagReview(
        flag_id=flag_id,
        admin_id=getattr(flag, "admin_id", 0),
        reviewer_user_id=body.reviewer_user_id,
        reviewer_name=body.reviewer_name,
        reviewer_role=body.reviewer_role,
        review_action=body.review_action,
        previous_status=previous_status,
        new_status=new_status,
        notes=body.notes,
        ai_confidence=flag.ai_confidence,
        reviewed_at=now,
    )
    db.add(review)

    # ── Notification ──────────────────────────────────────────────
    notify_cfg = REVIEW_NOTIFY.get(body.review_action)
    if notify_cfg:
        level, title, msg_template = notify_cfg
        message = (
            f"{msg_template}\n"
            f"Flag: {flag.event_type} · Resident: {flag.resident_name or 'Unknown'}\n"
            f"Reviewed by: {body.reviewer_name}"
            + (f"\nNotes: {body.notes}" if body.notes else "")
        )
        _send_notification(db, flag.admin_id, level, title, message, flag_id)

    try:
        db.commit()
        db.refresh(review)
        return _fmt_review(review)
    except SQLAlchemyError:
        db.rollback()
        raise HTTPException(status_code=500, detail="Failed to submit review.")


@router.get("/{flag_id}/reviews", response_model=list[schemas.FlagReviewResponse])
def get_reviews(flag_id: int, db: Session = Depends(get_db)):
    """Get full review history for a flag."""
    _get_flag_or_404(db, flag_id)
    reviews = (
        db.query(models.FlagReview)
        .filter(models.FlagReview.flag_id == flag_id)
        .order_by(models.FlagReview.reviewed_at.asc())
        .all()
    )
    return [_fmt_review(r) for r in reviews]


# ══════════════════════════════════════════════════════════════════════════════
# COMMENTS
# ══════════════════════════════════════════════════════════════════════════════

@router.get("/{flag_id}/comments", response_model=list[schemas.FlagCommentResponse])
def get_comments(flag_id: int, db: Session = Depends(get_db)):
    flag = _get_flag_or_404(db, flag_id)
    return [_fmt_comment(c) for c in flag.comments]


@router.post("/{flag_id}/comments", response_model=schemas.FlagCommentResponse, status_code=status.HTTP_201_CREATED)
def add_comment(flag_id: int, body: schemas.FlagCommentCreate, db: Session = Depends(get_db)):
    _get_flag_or_404(db, flag_id)
    comment = models.FlagComment(
        flag_id=flag_id,
        author_name=body.author_name,
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