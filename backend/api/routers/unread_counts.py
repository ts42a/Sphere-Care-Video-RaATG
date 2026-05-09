"""
GET /notifications/unread-counts

Returns unread badge counts for:
  - messages  : conversations with unread_count > 0
  - alerts    : unread Alerts (is_read=False)
  - flags     : flags with status in ('new', 'escalated')

Add this router to your notifications router or as a standalone router.
Mount at: router.include_router(unread_counts_router, prefix="/notifications")
"""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func

from backend.api.deps import get_db, get_current_auth_context
from backend import models

router = APIRouter(tags=["Notifications"])


@router.get("/unread-counts")
def get_unread_counts(
    auth=Depends(get_current_auth_context),
    db: Session = Depends(get_db),
):
    """
    Returns badge counts for the sidebar navigation icons.

    Response shape:
    {
        "messages": 3,   // conversations with unread_count > 0
        "alerts":   2,   // Alert rows where is_read=False
        "flags":    5,   // Flag rows where status in ('new','escalated')
        "total":    10
    }
    """
    admin_id = auth.get("admin_id")
    if not admin_id:
        return {"messages": 0, "alerts": 0, "flags": 0, "total": 0}

    # ── Messages: sum all unread_count across conversations ──────
    msg_result = (
        db.query(func.count(models.Conversation.id))
        .filter(
            models.Conversation.admin_id == admin_id,
            models.Conversation.unread_count > 0,
        )
        .scalar()
    ) or 0

    # ── Alerts: unread Alert rows for this admin ──────────────────
    alert_result = (
        db.query(func.count(models.Alert.id))
        .filter(
            models.Alert.admin_id == admin_id,
            models.Alert.is_read == False,
        )
        .scalar()
    ) or 0

    # ── Flags: active (new or escalated) — need attention ─────────
    flag_result = (
        db.query(func.count(models.Flag.id))
        .filter(
            models.Flag.status.in_(["new", "escalated"]),
        )
        .scalar()
    ) or 0

    total = msg_result + alert_result + flag_result

    return {
        "messages": msg_result,
        "alerts":   alert_result,
        "flags":    flag_result,
        "total":    total,
    }