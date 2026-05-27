"""
Realtime notification service.

This module persists notifications in the `notifications` and
`notification_recipients` tables, then broadcasts realtime events over the
existing WebSocket manager.

Important event names used by the frontends:
- `schedule.updated`   updates the client booking schedule screen
- `booking_created`   creates a local appointment notification
- `booking_updated`   creates a local appointment notification
- `booking_deleted`   creates a local appointment notification
- `booking.updated`   refreshes the booking confirmation screen
- `badge_update`      refreshes unread counters on staff/admin pages
"""

from __future__ import annotations

import logging
from datetime import date, datetime, time
from typing import Iterable, Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from backend import models
from backend.ws.ws_manager import ws_manager

logger = logging.getLogger(__name__)


# ── Small formatting helpers ─────────────────────────────────────────────────

def _json_value(value):
    if isinstance(value, (datetime, date, time)):
        return value.isoformat()
    return value


def _time_text(value) -> str:
    if value is None:
        return ""
    if isinstance(value, time):
        return value.strftime("%H:%M")
    return str(value)


def _actor_key_for_user(user_id: Optional[int]) -> Optional[str]:
    if not user_id:
        return None
    return f"user:{int(user_id)}"


def _actor_key_for_admin(admin_id: Optional[int]) -> Optional[str]:
    if not admin_id:
        return None
    return f"admin:{int(admin_id)}"


def _unique_ints(values: Iterable[Optional[int]]) -> list[int]:
    result: list[int] = []
    seen: set[int] = set()

    for value in values:
        if value is None:
            continue
        try:
            normalized = int(value)
        except Exception:
            continue
        if normalized in seen:
            continue
        seen.add(normalized)
        result.append(normalized)

    return result


def _resident_client_user_id(booking) -> Optional[int]:
    resident = getattr(booking, "resident", None)
    value = getattr(resident, "client_user_id", None)
    if value:
        return int(value)
    return None


def _resident_name(booking) -> str:
    resident = getattr(booking, "resident", None)
    return (
        getattr(resident, "full_name", None)
        or getattr(booking, "resident_name", None)
        or f"Resident #{getattr(booking, 'resident_id', '')}".strip()
    )


def _booking_when(booking) -> str:
    appointment_date = _json_value(getattr(booking, "appointment_date", None))
    start_time = _time_text(getattr(booking, "start_time", None))
    if appointment_date and start_time:
        return f"{appointment_date} at {start_time}"
    return str(appointment_date or start_time or "")


def _serialize_booking(booking) -> dict:
    resident = getattr(booking, "resident", None)

    return {
        "id": int(getattr(booking, "id")),
        "admin_id": int(getattr(booking, "admin_id")),
        "resident_id": int(getattr(booking, "resident_id")),
        "resident": {
            "id": int(getattr(resident, "id", getattr(booking, "resident_id", 0)) or 0),
            "full_name": _resident_name(booking),
            "client_user_id": getattr(resident, "client_user_id", None),
        },
        "doctor_name": getattr(booking, "doctor_name", None),
        "doctor_specialty": getattr(booking, "doctor_specialty", None),
        "booking_type": getattr(booking, "booking_type", None),
        "appointment_date": _json_value(getattr(booking, "appointment_date", None)),
        "start_time": _time_text(getattr(booking, "start_time", None)),
        "end_time": _time_text(getattr(booking, "end_time", None)),
        "location": getattr(booking, "location", None),
        "status": getattr(booking, "status", None),
        "created_by": getattr(booking, "created_by", None),
        "created_at": _json_value(getattr(booking, "created_at", None)),
        "updated_at": _json_value(getattr(booking, "updated_at", None)),
    }


def _notification_payload(notification: models.Notification, is_read: bool = False) -> dict:
    return {
        "id": int(notification.id),
        "category": notification.category,
        "title": notification.title,
        "body": notification.body,
        "is_priority": bool(notification.is_priority),
        "is_read": bool(is_read),
        "related_entity_type": notification.related_entity_type,
        "related_entity_id": (
            int(notification.related_entity_id)
            if notification.related_entity_id is not None
            else None
        ),
        "created_at": _json_value(notification.created_at),
    }


# ── Badge helpers ─────────────────────────────────────────────────────────────

def _compute_badge_counts(db: Session, admin_id: int) -> dict:
    """Recompute all badge counts from DB."""
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
            models.Alert.is_read == False,  # noqa: E712
        )
        .scalar()
    ) or 0

    flags = (
        db.query(func.count(models.Flag.id))
        .filter(models.Flag.status.in_(["new", "escalated"]))
        .scalar()
    ) or 0

    appointments = (
        db.query(func.count(models.NotificationRecipient.id))
        .join(models.Notification)
        .filter(
            models.Notification.admin_id == admin_id,
            models.Notification.category == "appointment",
            models.NotificationRecipient.is_read == False,  # noqa: E712
        )
        .scalar()
    ) or 0

    return {
        "type": "badge_update",
        "messages": int(messages),
        "alerts": int(alerts),
        "flags": int(flags),
        "appointments": int(appointments),
        "total": int(messages + alerts + flags + appointments),
    }


async def broadcast_badge_update(admin_id: int, db: Session) -> None:
    payload = _compute_badge_counts(db, admin_id)
    await ws_manager.broadcast(int(admin_id), payload)


# ── Persistence helpers ───────────────────────────────────────────────────────

def _create_notification(
    db: Session,
    *,
    admin_id: int,
    category: str,
    title: str,
    body: str,
    related_entity_type: Optional[str] = None,
    related_entity_id: Optional[int] = None,
    is_priority: bool = False,
    recipient_user_ids: Optional[Iterable[Optional[int]]] = None,
) -> models.Notification:
    notification = models.Notification(
        admin_id=int(admin_id),
        category=category,
        title=title,
        body=body,
        related_entity_type=related_entity_type,
        related_entity_id=related_entity_id,
        is_priority=is_priority,
    )
    db.add(notification)
    db.flush()

    recipients = _unique_ints(recipient_user_ids or [])

    # Keep at least one recipient row so unread queries can surface it.
    # Admin ids are also user ids in the seeded demo data.
    if not recipients:
        recipients = [int(admin_id)]

    for user_id in recipients:
        db.add(
            models.NotificationRecipient(
                notification_id=notification.id,
                user_id=user_id,
                is_read=False,
            )
        )

    db.flush()
    db.refresh(notification)
    return notification


async def _broadcast_notification_to_recipients(
    notification: models.Notification,
    *,
    admin_id: int,
    recipient_user_ids: Iterable[Optional[int]],
) -> None:
    payload = {
        "type": "notification.created",
        "notification": _notification_payload(notification, is_read=False),
    }

    deliveries: dict[str, dict] = {}

    admin_actor = _actor_key_for_admin(admin_id)
    if admin_actor:
        deliveries[admin_actor] = payload

    for user_id in _unique_ints(recipient_user_ids):
        actor = _actor_key_for_user(user_id)
        if actor:
            deliveries[actor] = payload

    if deliveries:
        await ws_manager.broadcast_many(deliveries)


def _booking_recipient_user_ids(booking, admin_id: int) -> list[int]:
    return _unique_ints(
        [
            admin_id,
            getattr(booking, "created_by", None),
            _resident_client_user_id(booking),
        ]
    )


# ── Schedule and booking notifiers ────────────────────────────────────────────

async def notify_schedule_updated(
    *,
    admin_id: int,
    doctor_id: str,
    date: str,
    schedule_payload: dict,
) -> None:
    """Broadcast updated schedule slots to schedule screen watchers."""
    try:
        payload = {
            "type": "schedule.updated",
            "doctorId": doctor_id,
            "date": date,
            "availableDates": schedule_payload.get("available_dates")
            or schedule_payload.get("availableDates")
            or [],
            "timeSlots": schedule_payload.get("time_slots")
            or schedule_payload.get("timeSlots")
            or [],
            "version": schedule_payload.get("version") or int(datetime.utcnow().timestamp()),
        }

        await ws_manager.broadcast_schedule_update(
            int(admin_id),
            str(doctor_id),
            str(date),
            payload,
        )

        # Also notify admin/staff pages that schedules may need refresh.
        await ws_manager.broadcast(
            int(admin_id),
            {
                "type": "schedule.updated",
                **payload,
            },
        )
    except Exception:
        logger.exception("[notifications] failed to broadcast schedule update")


async def notify_booking_created(
    booking,
    admin_id: Optional[int] = None,
    db: Optional[Session] = None,
) -> None:
    """Persist and broadcast a real booking-created notification."""
    admin_id = int(admin_id or getattr(booking, "admin_id"))
    recipient_user_ids = _booking_recipient_user_ids(booking, admin_id)

    try:
        booking_payload = _serialize_booking(booking)
        event_payload = {
            "type": "booking_created",
            "booking": booking_payload,
        }

        deliveries = {_actor_key_for_admin(admin_id): event_payload}
        for user_id in recipient_user_ids:
            actor = _actor_key_for_user(user_id)
            if actor:
                deliveries[actor] = event_payload
        deliveries = {k: v for k, v in deliveries.items() if k}

        await ws_manager.broadcast_many(deliveries)

        if db:
            title = f"New booking: {getattr(booking, 'booking_type', 'Appointment')}"
            body = " · ".join(
                part
                for part in [
                    _resident_name(booking),
                    getattr(booking, "doctor_name", None),
                    _booking_when(booking),
                    getattr(booking, "status", None),
                ]
                if part
            )

            notification = _create_notification(
                db,
                admin_id=admin_id,
                category="appointment",
                title=title,
                body=body,
                related_entity_type="booking",
                related_entity_id=int(getattr(booking, "id")),
                is_priority=False,
                recipient_user_ids=recipient_user_ids,
            )
            db.commit()
            await _broadcast_notification_to_recipients(
                notification,
                admin_id=admin_id,
                recipient_user_ids=recipient_user_ids,
            )
            await broadcast_badge_update(admin_id, db)
    except Exception:
        if db:
            db.rollback()
        logger.exception("[notifications] failed to notify booking created")


async def notify_booking_updated(
    booking,
    admin_id: Optional[int] = None,
    db: Optional[Session] = None,
) -> None:
    """Persist and broadcast a real booking-updated notification."""
    admin_id = int(admin_id or getattr(booking, "admin_id"))
    recipient_user_ids = _booking_recipient_user_ids(booking, admin_id)

    try:
        booking_payload = _serialize_booking(booking)
        event_payload = {
            "type": "booking_updated",
            "booking": booking_payload,
        }

        deliveries = {_actor_key_for_admin(admin_id): event_payload}
        for user_id in recipient_user_ids:
            actor = _actor_key_for_user(user_id)
            if actor:
                deliveries[actor] = event_payload
        deliveries = {k: v for k, v in deliveries.items() if k}

        await ws_manager.broadcast_many(deliveries)

        if db:
            title = f"Booking updated: {getattr(booking, 'booking_type', 'Appointment')}"
            body = " · ".join(
                part
                for part in [
                    _resident_name(booking),
                    getattr(booking, "doctor_name", None),
                    _booking_when(booking),
                    getattr(booking, "status", None),
                ]
                if part
            )

            notification = _create_notification(
                db,
                admin_id=admin_id,
                category="appointment",
                title=title,
                body=body,
                related_entity_type="booking",
                related_entity_id=int(getattr(booking, "id")),
                is_priority=False,
                recipient_user_ids=recipient_user_ids,
            )
            db.commit()
            await _broadcast_notification_to_recipients(
                notification,
                admin_id=admin_id,
                recipient_user_ids=recipient_user_ids,
            )
            await broadcast_badge_update(admin_id, db)
    except Exception:
        if db:
            db.rollback()
        logger.exception("[notifications] failed to notify booking updated")


async def notify_booking_deleted(
    booking_id: int,
    admin_id: int,
    db: Optional[Session] = None,
    booking_title: Optional[str] = None,
    booking_body: Optional[str] = None,
) -> None:
    """Persist and broadcast a real booking-deleted notification."""
    try:
        event_payload = {
            "type": "booking_deleted",
            "booking_id": int(booking_id),
        }
        await ws_manager.broadcast(int(admin_id), event_payload)
        await ws_manager.broadcast_actor(_actor_key_for_admin(admin_id), event_payload)

        if db:
            notification = _create_notification(
                db,
                admin_id=int(admin_id),
                category="appointment",
                title=booking_title or "Booking cancelled",
                body=booking_body or f"Booking #{booking_id} was cancelled.",
                related_entity_type="booking",
                related_entity_id=int(booking_id),
                is_priority=False,
                recipient_user_ids=[admin_id],
            )
            db.commit()
            await _broadcast_notification_to_recipients(
                notification,
                admin_id=int(admin_id),
                recipient_user_ids=[admin_id],
            )
            await broadcast_badge_update(int(admin_id), db)
    except Exception:
        if db:
            db.rollback()
        logger.exception("[notifications] failed to notify booking deleted")


async def notify_client_booking_updated(
    *,
    admin_id: int,
    booking_id: int,
    status: str,
) -> None:
    """
    Broadcast lightweight booking update for the client confirmation screen.

    The mobile confirmed page listens to `booking.updated`.
    """
    try:
        payload = {
            "type": "booking.updated",
            "bookingId": int(booking_id),
            "status": status,
        }
        await ws_manager.broadcast(int(admin_id), payload)
        await ws_manager.broadcast_actor(_actor_key_for_admin(admin_id), payload)
    except Exception:
        logger.exception("[notifications] failed to broadcast client booking update")


# ── Flag, alert and message notifiers ─────────────────────────────────────────

async def notify_flag_created(flag, admin_id: int, db: Optional[Session] = None) -> None:
    try:
        await ws_manager.broadcast(int(admin_id), {
            "type": "flag_created",
            "flag_id": flag.id,
            "event_type": getattr(flag, "event_type", ""),
            "severity": getattr(flag, "severity", ""),
            "resident_name": getattr(flag, "resident_name", ""),
            "status": getattr(flag, "status", "new"),
        })
        if db:
            await broadcast_badge_update(int(admin_id), db)
    except Exception:
        logger.exception("[notifications] failed to notify flag created")


async def notify_flag_resolved(flag_id: int, admin_id: int, db: Optional[Session] = None) -> None:
    try:
        await ws_manager.broadcast(int(admin_id), {
            "type": "flag_resolved",
            "flag_id": flag_id,
        })
        if db:
            await broadcast_badge_update(int(admin_id), db)
    except Exception:
        logger.exception("[notifications] failed to notify flag resolved")


async def notify_alert_created(alert, admin_id: int, db: Optional[Session] = None) -> None:
    try:
        await ws_manager.broadcast(int(admin_id), {
            "type": "ai_alert",
            "alert": {
                "id": alert.id,
                "title": alert.title,
                "description": alert.message,
                "alert_type": "critical" if getattr(alert, "level", "") == "critical" else "warning",
            },
        })
        if db:
            await broadcast_badge_update(int(admin_id), db)
    except Exception:
        logger.exception("[notifications] failed to notify alert created")


async def notify_alert(alert) -> None:
    admin_id = int(getattr(alert, "admin_id", 0) or 0)
    if admin_id:
        await notify_alert_created(alert, admin_id)


async def notify_ai_insight(insight) -> None:
    admin_id = int(getattr(insight, "admin_id", 0) or 0)
    if not admin_id:
        return

    await ws_manager.broadcast(admin_id, {
        "type": "ai_alert",
        "alert": {
            "id": getattr(insight, "id", None),
            "title": getattr(insight, "title", None) or "AI Insight",
            "description": getattr(insight, "summary", None)
            or getattr(insight, "description", None)
            or "A new AI insight is available.",
            "alert_type": "warning",
        },
    })


async def notify_alert_read(admin_id: int, db: Session) -> None:
    await broadcast_badge_update(int(admin_id), db)


async def notify_message_read(admin_id: int, db: Session) -> None:
    await broadcast_badge_update(int(admin_id), db)


async def notify_new_message(message, admin_id: int, deliveries: Optional[dict] = None) -> None:
    try:
        payload = {
            "type": "new_message",
            "message_id": int(getattr(message, "id", 0) or 0),
            "conversation_id": int(getattr(message, "conversation_id", 0) or 0),
            "sender_user_id": getattr(message, "sender_user_id", None),
            "created_at": _json_value(getattr(message, "created_at", None)),
        }

        if deliveries:
            merged = {
                actor_key: {**data, **payload}
                for actor_key, data in deliveries.items()
            }
            await ws_manager.broadcast_many(merged)
        else:
            await ws_manager.broadcast(int(admin_id), payload)
    except Exception:
        logger.exception("[notifications] failed to notify new message")


async def notify_conversation_changed(admin_id, deliveries=None):
    try:
        if deliveries:
            await ws_manager.broadcast_many(deliveries)
        else:
            await ws_manager.broadcast(int(admin_id), {"type": "conversations_update"})
    except Exception:
        logger.exception("[notifications] failed to notify conversation changed")

