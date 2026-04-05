# backend/services/notification_service.py
# Was empty — now pushes WebSocket events

from __future__ import annotations
from typing import Optional
from sqlalchemy.orm import Session
from backend import models
from backend.ws.ws_manager import ws_manager


def _resident_name_from_booking(booking) -> str:
    resident = getattr(booking, "resident", None)
    if resident and getattr(resident, "full_name", None):
        return resident.full_name
    return f"Resident #{getattr(booking, 'resident_id', 'Unknown')}"


def _build_booking_summary(booking, *, prefix: str) -> tuple[str, str]:
    resident_name = _resident_name_from_booking(booking)
    date_text = str(getattr(booking, "appointment_date", ""))
    time_text = str(getattr(booking, "start_time", ""))
    doctor_name = getattr(booking, "doctor_name", "")
    booking_type = getattr(booking, "booking_type", "Appointment")
    status = getattr(booking, "status", "")

    title = f"{prefix}: {booking_type}"
    body = " · ".join(
        part
        for part in [resident_name, doctor_name, f"{date_text} at {time_text}" if date_text and time_text else date_text or time_text, status]
        if part
    )
    return title, body


def _persist_notification(
    db: Optional[Session],
    *,
    admin_id: int,
    category: str,
    title: str,
    body: str,
    related_entity_type: Optional[str] = None,
    related_entity_id: Optional[int] = None,
    is_priority: bool = False,
) -> Optional[models.Notification]:
    if db is None:
        return None

    notification = models.Notification(
        admin_id=admin_id,
        category=category,
        title=title,
        body=body,
        related_entity_type=related_entity_type,
        related_entity_id=related_entity_id,
        is_priority=is_priority,
    )
    db.add(notification)
    db.commit()
    db.refresh(notification)
    return notification


async def notify_booking_created(booking, admin_id: int, db: Optional[Session] = None):
    title, body = _build_booking_summary(booking, prefix="New booking")
    _persist_notification(
        db,
        admin_id=admin_id,
        category="appointment",
        title=title,
        body=body,
        related_entity_type="booking",
        related_entity_id=booking.id,
    )

    await ws_manager.broadcast(admin_id, {
        "type": "booking_created",
        "booking": {
            "id": booking.id,
            "appointment_date": str(booking.appointment_date),
            "start_time": str(booking.start_time),
            "doctor_name": booking.doctor_name,
            "booking_type": booking.booking_type,
            "status": booking.status,
            "resident_id": booking.resident_id,
            "resident": {"full_name": _resident_name_from_booking(booking)},
        }
    })


async def notify_booking_updated(booking, admin_id: int, db: Optional[Session] = None):
    prefix = "Booking cancelled" if str(getattr(booking, "status", "")).lower() in {"cancelled", "canceled"} else "Booking updated"
    title, body = _build_booking_summary(booking, prefix=prefix)
    _persist_notification(
        db,
        admin_id=admin_id,
        category="appointment",
        title=title,
        body=body,
        related_entity_type="booking",
        related_entity_id=booking.id,
    )

    await ws_manager.broadcast(admin_id, {
        "type": "booking_updated",
        "booking": {
            "id": booking.id,
            "status": booking.status,
            "appointment_date": str(booking.appointment_date),
            "start_time": str(booking.start_time),
            "doctor_name": booking.doctor_name,
            "booking_type": booking.booking_type,
            "resident_id": booking.resident_id,
            "resident": {"full_name": _resident_name_from_booking(booking)},
        }
    })


async def notify_booking_deleted(
    booking_id: int,
    admin_id: int,
    db: Optional[Session] = None,
    *,
    booking_title: Optional[str] = None,
    booking_body: Optional[str] = None,
):
    _persist_notification(
        db,
        admin_id=admin_id,
        category="appointment",
        title=booking_title or "Booking cancelled",
        body=booking_body or f"Booking #{booking_id} was removed.",
        related_entity_type="booking",
        related_entity_id=booking_id,
    )

    await ws_manager.broadcast(admin_id, {
        "type": "booking_deleted",
        "booking_id": booking_id,
    })


async def notify_alert_created(alert, admin_id: int):
    await ws_manager.broadcast(admin_id, {
        "type": "ai_alert",
        "alert": {
            "id": alert.id,
            "title": alert.title,
            "description": alert.message,
            "alert_type": "critical" if alert.level == "critical" else "warning",
        }
    })


async def notify_new_message(message, admin_id: int):
    await ws_manager.broadcast(admin_id, {
        "type": "new_message",
        "conversation_id": message.conversation_id,
        "message": {
            "id": message.id,
            "conversation_id": message.conversation_id,
            "sender_name": message.sender_name,
            "sender_role": message.sender_role or "",
            "content": message.content,
            "is_self": message.is_self,
            "created_at": message.created_at.strftime("%I:%M %p"),
        }
    })


async def notify_schedule_updated(admin_id: int, doctor_id: str, date: str, schedule_payload: dict):
    await ws_manager.broadcast_schedule_update(
        admin_id,
        doctor_id,
        date,
        {
            "type": "schedule.updated",
            "payload": {
                "doctorId": doctor_id,
                "date": date,
                "version": schedule_payload["version"],
                "availableDates": schedule_payload["available_dates"],
                "timeSlots": [
                    {
                        "id": slot.id,
                        "label": slot.label,
                        "available": slot.available,
                    }
                    for slot in schedule_payload["time_slots"]
                ],
            },
        }
    )


async def notify_client_booking_updated(admin_id: int, booking_id: int, status: str):
    await ws_manager.broadcast(
        admin_id,
        {
            "type": "booking.updated",
            "payload": {
                "bookingId": booking_id,
                "status": status,
            },
        }
    )