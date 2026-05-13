"""
notification_service.py  — additions / replacements

Add these two new functions to your existing notification_service.py.
They broadcast badge count updates over WebSocket so the sidebar
refreshes in real time without a page reload.

─────────────────────────────────────────────────────────────────────
USAGE IN flags.py  →  create_flag()
─────────────────────────────────────────────────────────────────────
    from backend.services import notification_service
    import asyncio

    def create_flag(flag_in: schemas.FlagCreate, db: Session = Depends(get_db)):
        ...
        db.add(flag)
        db.commit()
        db.refresh(flag)
        # Broadcast badge update (fire-and-forget from sync context)
        asyncio.create_task(
            notification_service.notify_flag_created(flag, admin_id=flag.admin_id)
        )
        return _fmt_flag(...)

─────────────────────────────────────────────────────────────────────
USAGE IN messages.py  →  after sending a message
─────────────────────────────────────────────────────────────────────
Already handled via notify_new_message — add badge broadcast there.

─────────────────────────────────────────────────────────────────────
MARK-READ BROADCASTS  (call from your read endpoints)
─────────────────────────────────────────────────────────────────────
    await notification_service.broadcast_badge_update(admin_id, db=db)

This recomputes all counts from DB and pushes { type: "badge_update", ... }
─────────────────────────────────────────────────────────────────────
"""

from __future__ import annotations

from typing import Optional
from sqlalchemy.orm import Session
from sqlalchemy import func

from backend import models
from backend.ws.ws_manager import ws_manager


# ── Badge helpers ─────────────────────────────────────────────────────────────

def _compute_badge_counts(db: Session, admin_id: int) -> dict:
    """Recompute all badge counts from DB (cheap indexed queries)."""
    messages = (
        db.query(func.count(models.Conversation.id))
        .filter(
            models.Conversation.admin_id == admin_id,
            models.Conversation.unread_count > 0,
        )
        .scalar()
    ) or 0

    alerts = (
        db.query(func.count(models.Alert.id))
        .filter(
            models.Alert.admin_id == admin_id,
            models.Alert.is_read == False,
        )
        .scalar()
    ) or 0

    flags = (
        db.query(func.count(models.Flag.id))
        .filter(models.Flag.status.in_(["new", "escalated"]))
        .scalar()
    ) or 0

    return {
        "type":     "badge_update",
        "messages": messages,
        "alerts":   alerts,
        "flags":    flags,
        "total":    messages + alerts + flags,
    }


async def broadcast_badge_update(admin_id: int, db: Session) -> None:
    """Recompute counts and push badge_update to all connected clients for this admin."""
    payload = _compute_badge_counts(db, admin_id)
    await ws_manager.broadcast(admin_id, payload)


# ── Per-event notifiers ───────────────────────────────────────────────────────

async def notify_flag_created(flag, admin_id: int, db: Optional[Session] = None) -> None:
    """Called after a new flag is persisted. Pushes a badge_update + flag_created event."""
    # 1. Specific event (so flags page can prepend without reload)
    await ws_manager.broadcast(admin_id, {
        "type":    "flag_created",
        "flag_id": flag.id,
        "event_type": getattr(flag, "event_type", ""),
        "severity":   getattr(flag, "severity", ""),
        "resident_name": getattr(flag, "resident_name", ""),
        "status":        getattr(flag, "status", "new"),
    })
    # 2. Badge refresh
    if db:
        await broadcast_badge_update(admin_id, db)


async def notify_flag_resolved(flag_id: int, admin_id: int, db: Optional[Session] = None) -> None:
    """Called after flag status moves to resolved/false_alarm. Decrements badge."""
    await ws_manager.broadcast(admin_id, {
        "type":    "flag_resolved",
        "flag_id": flag_id,
    })
    if db:
        await broadcast_badge_update(admin_id, db)


async def notify_alert_created(alert, admin_id: int, db: Optional[Session] = None) -> None:
    """Push real-time priority alert card + badge update."""
    await ws_manager.broadcast(admin_id, {
        "type": "ai_alert",
        "alert": {
            "id":          alert.id,
            "title":       alert.title,
            "description": alert.message,
            "alert_type":  "critical" if alert.level == "critical" else "warning",
        },
    })
    if db:
        await broadcast_badge_update(admin_id, db)


async def notify_alert_read(admin_id: int, db: Session) -> None:
    """Called when an alert is marked read. Pushes updated badge counts."""
    await broadcast_badge_update(admin_id, db)


async def notify_message_read(admin_id: int, db: Session) -> None:
    """Called when a conversation is opened / messages marked read."""
    await broadcast_badge_update(admin_id, db)

async def notify_conversation_changed(admin_id, deliveries=None):
    pass
