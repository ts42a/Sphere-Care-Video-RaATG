from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from backend.api.deps import get_db, get_current_auth_context
from backend import models, schemas
from backend.services.notifications.incoming_alerts import collect_incoming_alerts
from . import unread_counts

router = APIRouter(tags=["Notifications"])
router.include_router(unread_counts.router)


def _fmt(n: models.Notification) -> schemas.NotificationResponse:
    return schemas.NotificationResponse(
        id=n.id,
        category=n.category,
        title=n.title,
        body=n.body,
        is_priority=n.is_priority,
        related_entity_type=n.related_entity_type,
        related_entity_id=n.related_entity_id,
        created_at=n.created_at,
    )


@router.get("/", response_model=list[schemas.NotificationResponse])
def get_notifications(
    category: Optional[str] = Query(None, description="appointment | alert | reminder"),
    limit: int = Query(50, ge=1, le=200),
    auth=Depends(get_current_auth_context),
    db: Session = Depends(get_db),
):
    admin_id = auth.get("admin_id")
    if not admin_id:
        raise HTTPException(status_code=403, detail="Missing admin scope")

    q = db.query(models.Notification).filter(models.Notification.admin_id == admin_id)

    # Clients should only see notifications that were addressed to them.
    # Message notifications are persisted with NotificationRecipient rows.
    # Admin/staff users can still see center-wide notifications by admin scope.
    role = auth.get("role")
    user_id = auth.get("user_id")
    if role == "client" and user_id:
        q = (
            q.join(models.NotificationRecipient)
            .filter(models.NotificationRecipient.user_id == int(user_id))
        )

    if category:
        q = q.filter(models.Notification.category == category)

    q = q.order_by(models.Notification.created_at.desc())
    return [_fmt(n) for n in q.limit(limit).all()]


@router.get("/priority", response_model=list[schemas.NotificationResponse])
def get_priority_alerts(
    limit: int = Query(5, ge=1, le=20),
    auth=Depends(get_current_auth_context),
    db: Session = Depends(get_db),
):
    admin_id = auth.get("admin_id")
    if not admin_id:
        raise HTTPException(status_code=403, detail="Missing admin scope")

    rows = (
        db.query(models.Notification)
        .filter(
            models.Notification.admin_id == admin_id,
            models.Notification.is_priority == True,
        )
        .order_by(models.Notification.created_at.desc())
        .limit(limit)
        .all()
    )
    return [_fmt(n) for n in rows]


@router.get("/incoming-alerts", response_model=list[schemas.IncomingAlertOut])
def get_incoming_alerts(
    limit: int = Query(30, ge=1, le=100),
    auth=Depends(get_current_auth_context),
    db: Session = Depends(get_db),
):
    """Poll for new dashboard / flag / camera alerts (staff notification modal)."""
    admin_id = auth.get("admin_id")
    if not admin_id:
        return []
    return collect_incoming_alerts(db, int(admin_id), limit=limit)


@router.post("/", response_model=schemas.NotificationResponse, status_code=status.HTTP_201_CREATED)
def create_notification(
    notification_in: schemas.NotificationCreate,
    auth=Depends(get_current_auth_context),
    db: Session = Depends(get_db),
):
    admin_id = auth.get("admin_id")
    if not admin_id:
        raise HTTPException(status_code=403, detail="Missing admin scope")

    n = models.Notification(
        admin_id=admin_id,
        **notification_in.model_dump(),
    )
    db.add(n)
    db.commit()
    db.refresh(n)
    return _fmt(n)


@router.delete("/{notification_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_notification(
    notification_id: int,
    auth=Depends(get_current_auth_context),
    db: Session = Depends(get_db),
):
    admin_id = auth.get("admin_id")
    if not admin_id:
        raise HTTPException(status_code=403, detail="Missing admin scope")

    n = db.query(models.Notification).filter(
        models.Notification.id == notification_id,
        models.Notification.admin_id == admin_id,
    ).first()
    if not n:
        raise HTTPException(status_code=404, detail="Notification not found.")
    db.delete(n)
    db.commit()
