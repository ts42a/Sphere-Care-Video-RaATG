from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from typing import Optional

from backend.api.deps import get_db
from backend import models, schemas

router = APIRouter(tags=["Notifications"])


def _fmt(n: models.Notification) -> schemas.NotificationResponse:
    return schemas.NotificationResponse(
        id=n.id,
        category=n.category,
        title=n.title,
        body=n.body,
        is_priority=n.is_priority,
        created_at=n.created_at,
    )


@router.get("/", response_model=list[schemas.NotificationResponse])
def get_notifications(
    category: Optional[str] = Query(None, description="appointment | alert | reminder"),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
):
    """
    Get all notifications, newest first.
    - No filter  → 'All' tab
    - category=appointment → 'Appointments' tab
    """
    q = db.query(models.Notification).order_by(models.Notification.created_at.desc())
    if category:
        q = q.filter(models.Notification.category == category)
    return [_fmt(n) for n in q.limit(limit).all()]


@router.get("/priority", response_model=list[schemas.NotificationResponse])
def get_priority_alerts(
    limit: int = Query(5, ge=1, le=20),
    db: Session = Depends(get_db),
):
    """Priority Alerts panel — unread high-priority notifications."""
    rows = (
        db.query(models.Notification)
        .filter(
            models.Notification.is_priority == True,
        )
        .order_by(models.Notification.created_at.desc())
        .limit(limit)
        .all()
    )
    return [_fmt(n) for n in rows]


@router.post("/", response_model=schemas.NotificationResponse, status_code=status.HTTP_201_CREATED)
def create_notification(
    notification_in: schemas.NotificationCreate,
    db: Session = Depends(get_db),
):
    """Create a new notification (appointment / alert / reminder)."""
    n = models.Notification(**notification_in.model_dump())
    db.add(n)
    db.commit()
    db.refresh(n)
    return _fmt(n)


@router.delete("/{notification_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_notification(notification_id: int, db: Session = Depends(get_db)):
    """Delete a notification by ID."""
    n = db.query(models.Notification).filter(models.Notification.id == notification_id).first()
    if not n:
        raise HTTPException(status_code=404, detail="Notification not found.")
    db.delete(n)
    db.commit()
