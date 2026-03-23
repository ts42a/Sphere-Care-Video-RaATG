from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from backend.api.deps import get_db
from backend import models, schemas

router = APIRouter(prefix="/dashboard", tags=["Dashboard"])


@router.get("/stats", response_model=schemas.DashboardStats)
def get_dashboard_stats(db: Session = Depends(get_db)):
    """
    Returns aggregated Quick Stats for the Dashboard:
      - active_staff:   staff with status = 'active'
      - pending_tasks:  bookings with status = 'pending'
      - shifts_today:   currently same as active staff
      - recent_alerts:  latest 5 unread alerts
    """

    active_staff = (
        db.query(models.Staff)
        .filter(models.Staff.status == "active")
        .count()
    )

    pending_tasks = (
        db.query(models.Booking)
        .filter(models.Booking.status == "pending")
        .count()
    )

    # Until Staff has a shift_date column, use active staff count
    shifts_today = active_staff

    raw_alerts = (
        db.query(models.Alert)
        .filter(models.Alert.is_read == "false")
        .order_by(models.Alert.created_at.desc())
        .limit(5)
        .all()
    )

    recent_alerts = [
        schemas.AlertResponse(
            id=a.id,
            level=a.level,
            title=a.title,
            message=a.message,
            is_read=a.is_read,
            created_at=a.created_at,
        )
        for a in raw_alerts
    ]

    return schemas.DashboardStats(
        active_staff=active_staff,
        pending_tasks=pending_tasks,
        shifts_today=shifts_today,
        recent_alerts=recent_alerts,
    )