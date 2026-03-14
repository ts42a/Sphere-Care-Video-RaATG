from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import Optional

from app.api.deps import get_db
from app import models, schemas

router = APIRouter(prefix="/alerts", tags=["Alerts"])


def _fmt(alert: models.Alert) -> schemas.AlertResponse:
    return schemas.AlertResponse(
        id=alert.id,
        level=alert.level,
        title=alert.title,
        message=alert.message,
        is_read=alert.is_read,
        created_at=alert.created_at.strftime("%b %d, %Y %I:%M %p"),
    )


@router.get("/", response_model=list[schemas.AlertResponse])
def get_alerts(
    level: Optional[str] = None,
    is_read: Optional[str] = None,
    limit: int = 20,
    db: Session = Depends(get_db),
):
    """
    Get all alerts, newest first.
    Optional filters:
      - level: warning | critical | info
      - is_read: "true" | "false"
      - limit: max results (default 20)
    """
    query = db.query(models.Alert).order_by(models.Alert.created_at.desc())
    if level:
        query = query.filter(models.Alert.level == level)
    if is_read is not None:
        query = query.filter(models.Alert.is_read == is_read)
    return [_fmt(a) for a in query.limit(limit).all()]


@router.post("/", response_model=schemas.AlertResponse, status_code=status.HTTP_201_CREATED)
def create_alert(alert_in: schemas.AlertCreate, db: Session = Depends(get_db)):
    """Create a new alert (warning / critical / info)."""
    alert = models.Alert(**alert_in.model_dump())
    db.add(alert)
    db.commit()
    db.refresh(alert)
    return _fmt(alert)


@router.patch("/{alert_id}/read", response_model=schemas.AlertResponse)
def mark_alert_read(alert_id: int, db: Session = Depends(get_db)):
    """Mark a single alert as read."""
    alert = db.query(models.Alert).filter(models.Alert.id == alert_id).first()
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found.")
    alert.is_read = "true"
    db.commit()
    db.refresh(alert)
    return _fmt(alert)


@router.patch("/read-all", response_model=dict)
def mark_all_read(db: Session = Depends(get_db)):
    """Mark all unread alerts as read."""
    updated = (
        db.query(models.Alert)
        .filter(models.Alert.is_read == "false")
        .update({"is_read": "true"})
    )
    db.commit()
    return {"marked_read": updated}


@router.delete("/{alert_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_alert(alert_id: int, db: Session = Depends(get_db)):
    """Delete an alert by ID."""
    alert = db.query(models.Alert).filter(models.Alert.id == alert_id).first()
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found.")
    db.delete(alert)
    db.commit()
