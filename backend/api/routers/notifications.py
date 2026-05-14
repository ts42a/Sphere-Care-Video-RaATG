from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from backend.api.deps import get_db, get_current_auth_context
from backend import models, schemas

router = APIRouter(tags=["Notifications"])


def _fmt(n: models.Notification) -> schemas.NotificationResponse:
    return schemas.NotificationResponse(
        id=n.id,
        category=n.category,
        title=n.title,
        body=n.body,
        is_priority=n.is_priority,
        is_read=bool(getattr(n, 'is_read', False)),
        related_entity_type=n.related_entity_type,
        related_entity_id=n.related_entity_id,
        created_at=n.created_at,
    )


@router.get("/", response_model=list[schemas.NotificationResponse])
def get_notifications(
    category: Optional[str] = Query(None, description="appointment | alert | reminder | message | call"),
    unread_only: bool = Query(True, description="Only return unread notifications (default true)"),
    limit: int = Query(50, ge=1, le=200),
    auth=Depends(get_current_auth_context),
    db: Session = Depends(get_db),
):
    admin_id = auth.get("admin_id")
    user_id  = auth.get("user_id")
    if not admin_id:
        raise HTTPException(status_code=403, detail="Missing admin scope")

    q = (
        db.query(models.Notification)
        .filter(models.Notification.admin_id == admin_id)
        .order_by(models.Notification.created_at.desc())
    )

    if category:
        q = q.filter(models.Notification.category == category)

    if unread_only:
        q = q.filter(models.Notification.is_read == False)  # noqa: E712

    role = auth.get("role")
    if role == "client" and user_id:
        q = (
            q.join(models.NotificationRecipient)
            .filter(models.NotificationRecipient.user_id == int(user_id))
        )

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
    return [_fmt(n, is_read=_is_read_for_user(n, None)) for n in rows]


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
    return _fmt(n, is_read=False)


@router.patch("/{notification_id}/read", status_code=status.HTTP_204_NO_CONTENT)
def mark_notification_read(
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

    n.is_read = True
    db.commit()


@router.patch("/read-all", status_code=status.HTTP_204_NO_CONTENT)
def mark_all_notifications_read(
    category: Optional[str] = Query(None),
    auth=Depends(get_current_auth_context),
    db: Session = Depends(get_db),
):
    admin_id = auth.get("admin_id")
    if not admin_id:
        raise HTTPException(status_code=403, detail="Missing admin scope")

    q = db.query(models.Notification).filter(
        models.Notification.admin_id == admin_id,
        models.Notification.is_read == False,  # noqa: E712
    )
    if category:
        q = q.filter(models.Notification.category == category)
    q.update({"is_read": True}, synchronize_session=False)
    db.commit()


@router.get("/unread-counts")
def get_unread_counts(
    auth=Depends(get_current_auth_context),
    db: Session = Depends(get_db),
):
    admin_id = auth.get("admin_id")
    if not admin_id:
        raise HTTPException(status_code=403, detail="Missing admin scope")

    base = db.query(models.Notification).filter(
        models.Notification.admin_id == admin_id,
        models.Notification.is_read == False,  # noqa: E712
    )

    def _count(cat):
        return base.filter(models.Notification.category == cat).count()

    alerts       = _count("alert")
    messages     = _count("message")
    appointments = _count("appointment")
    calls        = _count("call")
    total        = alerts + messages + appointments + calls

    return {
        "total":        total,
        "alerts":       alerts,
        "messages":     messages,
        "appointments": appointments,
        "calls":        calls,
    }


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
