from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Optional

from sqlalchemy.orm import Session

from backend import models
from backend.ws.ws_manager import ws_manager


def _dt_to_iso(value) -> Optional[str]:
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value) if value else None


def _number(value):
    if isinstance(value, Decimal):
        return float(value)
    return value


def serialize_flag(flag: models.Flag) -> dict:
    return {
        "id": int(flag.id),
        "resident_name": flag.resident_name,
        "resident_id": int(flag.resident_id) if flag.resident_id is not None else None,
        "camera_id": int(flag.camera_id) if getattr(flag, "camera_id", None) is not None else None,
        "event_type": flag.event_type,
        "description": flag.description,
        "severity": flag.severity,
        "source": flag.source,
        "status": flag.status,
        "sev_desc": flag.sev_desc,
        "transcript": flag.transcript,
        "video_timestamp": flag.video_timestamp,
        "ai_confidence": _number(flag.ai_confidence),
        "flagged_at": _dt_to_iso(flag.flagged_at),
        "created_at": _dt_to_iso(flag.created_at),
    }


def _severity_to_alert_type(severity: Optional[str]) -> str:
    normalized = (severity or "").strip().lower()
    return "critical" if normalized in {"critical", "high"} else "warning"


def _resolve_client_user_id(db: Session, flag: models.Flag) -> Optional[int]:
    if not flag.resident_id:
        return None

    resident = (
        db.query(models.Resident)
        .filter(
            models.Resident.id == int(flag.resident_id),
            models.Resident.admin_id == int(flag.admin_id),
            models.Resident.is_deleted == False,
        )
        .first()
    )

    if resident and resident.client_user_id:
        return int(resident.client_user_id)
    return None


def _staff_actor_keys(db: Session, admin_id: int) -> list[str]:
    rows = (
        db.query(models.Staff)
        .filter(
            models.Staff.admin_id == int(admin_id),
            models.Staff.user_id.isnot(None),
        )
        .all()
    )
    return [f"user:{int(row.user_id)}" for row in rows if row.user_id]


def _persist_client_notification(
    db: Session,
    *,
    flag: models.Flag,
    client_user_id: Optional[int],
) -> Optional[models.Notification]:
    title = f"AI Flag: {flag.event_type or 'Resident alert'}"
    body = flag.description or "A new AI flag needs attention."
    is_priority = _severity_to_alert_type(flag.severity) == "critical"

    notification = models.Notification(
        admin_id=int(flag.admin_id),
        category="alert",
        title=title,
        body=body,
        related_entity_type="flag",
        related_entity_id=int(flag.id),
        is_priority=is_priority,
    )
    db.add(notification)
    db.flush()

    if client_user_id:
        db.add(
            models.NotificationRecipient(
                notification_id=notification.id,
                user_id=int(client_user_id),
            )
        )

    db.commit()
    db.refresh(notification)
    return notification


def _notification_payload(notification: Optional[models.Notification]) -> Optional[dict]:
    if not notification:
        return None
    return {
        "id": int(notification.id),
        "category": notification.category,
        "title": notification.title,
        "body": notification.body,
        "related_entity_type": notification.related_entity_type,
        "related_entity_id": int(notification.related_entity_id) if notification.related_entity_id is not None else None,
        "is_priority": notification.is_priority,
        "created_at": _dt_to_iso(notification.created_at),
    }


async def broadcast_ai_flag_created(flag: models.Flag, db: Session) -> None:
    """
    Broadcast an AI flag to staff/admin dashboards and to the resident's linked
    mobile client only. It also persists a client-visible notification so the
    mobile Notifications page can still show the alert after refresh/relogin.
    """
    if not flag or not flag.id:
        return

    client_user_id = _resolve_client_user_id(db, flag)
    notification = _persist_client_notification(
        db,
        flag=flag,
        client_user_id=client_user_id,
    )

    flag_payload = serialize_flag(flag)
    payload = {
        "type": "ai_alert",
        "alert": {
            "id": int(flag.id),
            "flag_id": int(flag.id),
            "title": f"AI Flag: {flag.event_type or 'Resident alert'}",
            "description": flag.description or "A new AI flag needs attention.",
            "alert_type": _severity_to_alert_type(flag.severity),
            "severity": flag.severity,
            "resident_id": flag_payload.get("resident_id"),
            "resident_name": flag.resident_name,
            "event_type": flag.event_type,
            "ai_confidence": flag_payload.get("ai_confidence"),
            "created_at": flag_payload.get("created_at"),
            "related_entity_type": "flag",
            "related_entity_id": int(flag.id),
        },
        "flag": flag_payload,
        "notification": _notification_payload(notification),
    }

    deliveries: dict[str, dict] = {f"admin:{int(flag.admin_id)}": payload}

    for actor_key in _staff_actor_keys(db, int(flag.admin_id)):
        deliveries[actor_key] = payload

    if client_user_id:
        deliveries[f"user:{client_user_id}"] = payload

    await ws_manager.broadcast_many(deliveries)


def broadcast_ai_flag_created_sync(flag: models.Flag, db: Session) -> None:
    """Synchronous wrapper for AI pipelines/workers that are not async."""
    import asyncio

    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        asyncio.run(broadcast_ai_flag_created(flag, db))
        return

    loop.create_task(broadcast_ai_flag_created(flag, db))