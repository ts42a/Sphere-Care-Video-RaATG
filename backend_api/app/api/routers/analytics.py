"""
analytics.py — Report And Analysis router

Endpoints:
  GET /analytics/report          
  GET /analytics/monthly-activity  
  GET /analytics/task-distribution 
  GET /analytics/department-performance 
"""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import func
from datetime import date, timedelta
from collections import defaultdict

from app.api.deps import get_db
from app import models, schemas

router = APIRouter(prefix="/analytics", tags=["Reports & Analytics"])

MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
          "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

# Departments derived from Staff assigned_unit values
DEPARTMENTS = [
    "Emergency Care",
    "Cardiology",
    "Neurology",
    "Pediatrics",
    "Orthopaedics",
]


#helpers

def _monthly_activity(db: Session, days: int) -> list[schemas.MonthlyActivityPoint]:
    """Count bookings created per calendar month within the last `days` days."""
    since = date.today() - timedelta(days=days)
    rows = (
        db.query(
            func.strftime("%m", models.Booking.created_at).label("month_num"),
            func.count(models.Booking.id).label("cnt"),
        )
        .filter(models.Booking.created_at >= since)
        .group_by("month_num")
        .order_by("month_num")
        .all()
    )
    # Build a full 12-month map (zero-fill missing months)
    counts: dict[str, int] = defaultdict(int)
    for month_num, cnt in rows:
        month_name = MONTHS[int(month_num) - 1]
        counts[month_name] = cnt

    # Return only months that appear in the result set (or all if empty)
    if not counts:
        return [schemas.MonthlyActivityPoint(month=m, count=0) for m in MONTHS]
    return [schemas.MonthlyActivityPoint(month=m, count=counts[m]) for m in MONTHS]


def _task_distribution(db: Session) -> list[schemas.TaskTypeSlice]:
    """Breakdown of bookings by status (maps to task types in the pie chart)."""
    rows = (
        db.query(models.Booking.status, func.count(models.Booking.id))
        .group_by(models.Booking.status)
        .all()
    )
    total = sum(cnt for _, cnt in rows) or 1
    label_map = {
        "confirmed": "Completed",
        "pending":   "Pending",
        "cancelled": "Cancelled",
        "escalated": "Escalated",
    }
    return [
        schemas.TaskTypeSlice(
            task_type=label_map.get(status.lower(), status.title()),
            count=cnt,
            percentage=round(cnt / total * 100, 1),
        )
        for status, cnt in rows
    ]


def _department_performance(db: Session) -> list[schemas.DepartmentPerformance]:
    """
    Score each department 0-100 based on ratio of active staff to total staff.
    Falls back to a proportional placeholder when no staff data exists.
    """
    results = []
    for dept in DEPARTMENTS:
        total = db.query(models.Staff).filter(models.Staff.assigned_unit == dept).count()
        active = (
            db.query(models.Staff)
            .filter(models.Staff.assigned_unit == dept, models.Staff.status == "active")
            .count()
        )
        score = round((active / total) * 100) if total > 0 else 0
        results.append(schemas.DepartmentPerformance(department=dept, score=score))
    return results


def _resolve_days(period: str) -> int:
    mapping = {"7d": 7, "30d": 30, "90d": 90, "1y": 365}
    return mapping.get(period, 30)


#routes

@router.get("/report", response_model=schemas.AnalyticsReport)
def get_full_report(
    period: str = Query(default="30d", description="7d | 30d | 90d | 1y"),
    db: Session = Depends(get_db),
):
    """
    Full analytics report for the Report And Analysis dashboard.
    Returns monthly activity, task distribution pie, and department performance bar chart.
    """
    days = _resolve_days(period)
    period_label = {7: "Last 7 Days", 30: "Last 30 Days",
                    90: "Last 90 Days", 365: "Last Year"}.get(days, "Last 30 Days")

    return schemas.AnalyticsReport(
        period=period_label,
        monthly_activity=_monthly_activity(db, days),
        task_distribution=_task_distribution(db),
        department_performance=_department_performance(db),
    )


@router.get("/monthly-activity", response_model=list[schemas.MonthlyActivityPoint])
def get_monthly_activity(
    period: str = Query(default="30d", description="7d | 30d | 90d | 1y"),
    db: Session = Depends(get_db),
):
    """Monthly Activity Metrics — bar chart data."""
    return _monthly_activity(db, _resolve_days(period))


@router.get("/task-distribution", response_model=list[schemas.TaskTypeSlice])
def get_task_distribution(db: Session = Depends(get_db)):
    """Task Distribution by Type — pie chart data."""
    return _task_distribution(db)


@router.get("/department-performance", response_model=list[schemas.DepartmentPerformance])
def get_department_performance(db: Session = Depends(get_db)):
    """Department Performance Ratio — horizontal bar chart data."""
    return _department_performance(db)