from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from backend.api.deps import get_db
from backend.api.rbac import resolve_staff_admin_scope_id
from backend import models, schemas

router = APIRouter(tags=["Dashboard"])


@router.get("/stats", response_model=schemas.DashboardStats)
def get_dashboard_stats(
    admin_id: int = Depends(resolve_staff_admin_scope_id),
    db: Session = Depends(get_db),
):
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
        .filter(models.Alert.admin_id == admin_id, models.Alert.is_read == False)
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
            source=a.source,
            is_read=a.is_read,
            created_at=a.created_at,
        )
        for a in raw_alerts
    ]

    if len(recent_alerts) < 5:
        linked_flag_ids = {
            int(a.related_entity_id)
            for a in raw_alerts
            if a.related_entity_type == "flag" and a.related_entity_id
        }
        pending_flags = (
            db.query(models.Flag)
            .filter(
                models.Flag.admin_id == admin_id,
                models.Flag.is_deleted == False,  # noqa: E712
                models.Flag.status.in_(["Pending Review", "Open"]),
            )
            .order_by(models.Flag.flagged_at.desc())
            .limit(5)
            .all()
        )
        for flag in pending_flags:
            if int(flag.id) in linked_flag_ids:
                continue
            if len(recent_alerts) >= 5:
                break
            level = "critical" if str(flag.severity or "").lower() == "high" else "warning"
            recent_alerts.append(
                schemas.AlertResponse(
                    id=int(flag.id),
                    level=level,
                    title=f"{flag.event_type} — {flag.resident_name or 'Resident'}",
                    message=(flag.description or flag.sev_desc or "")[:500],
                    source="SCVAM",
                    is_read=False,
                    created_at=flag.flagged_at,
                )
            )

    return schemas.DashboardStats(
        active_staff=active_staff,
        pending_tasks=pending_tasks,
        shifts_today=shifts_today,
        recent_alerts=recent_alerts,
    )