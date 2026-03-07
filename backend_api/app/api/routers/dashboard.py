from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from datetime import date

from app.api.deps import get_db
from app import models, schemas

router = APIRouter(prefix="/dashboard", tags=["Dashboard"])


@router.get("/stats", response_model=schemas.DashboardStats)
def get_dashboard_stats(db: Session = Depends(get_db)):
    """
    Returns aggregated Quick Stats for the Dashboard:
      - active_staff:   staff with status = 'active'
      - pending_tasks:  bookings with status = 'pending'
      - shifts_today:   staff shifts scheduled for today's date
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

    today_str = date.today().strftime("%Y-%m-%d")
    shifts_today = (
        db.query(models.Staff)
        .filter(models.Staff.status == "active")
        .count()
        # NOTE: if Staff gains a `shift_date` column later, filter by that instead.
        # For now, shifts_today = all active staff (one shift per active staff per day).
    )

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
            created_at=a.created_at.strftime("%b %d, %Y %I:%M %p"),
        )
        for a in raw_alerts
    ]

    return schemas.DashboardStats(
        active_staff=active_staff,
        pending_tasks=pending_tasks,
        shifts_today=shifts_today,
        recent_alerts=recent_alerts,
    )