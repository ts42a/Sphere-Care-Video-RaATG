# backend/services/notification_service.py
# Was empty — now pushes WebSocket events

from backend.ws.ws_manager import ws_manager


async def notify_booking_created(booking, admin_id: int):
    await ws_manager.broadcast(admin_id, {
        "type": "booking_created",
        "booking": {
            "id":               booking.id,
            "appointment_date": str(booking.appointment_date),
            "start_time":       str(booking.start_time),
            "doctor_name":      booking.doctor_name,
            "booking_type":     booking.booking_type,
            "status":           booking.status,
            "resident_id":      booking.resident_id,
            "resident": {"full_name": booking.resident.full_name} if booking.resident else None,
        }
    })


async def notify_booking_updated(booking, admin_id: int):
    await ws_manager.broadcast(admin_id, {
        "type": "booking_updated",
        "booking": {
            "id":               booking.id,
            "status":           booking.status,
            "appointment_date": str(booking.appointment_date),
            "start_time":       str(booking.start_time),
            "doctor_name":      booking.doctor_name,
            "booking_type":     booking.booking_type,
        }
    })


async def notify_booking_deleted(booking_id: int, admin_id: int):
    await ws_manager.broadcast(admin_id, {
        "type": "booking_deleted",
        "booking_id": booking_id,
    })


async def notify_alert_created(alert, admin_id: int):
    """Alert model: title, message, level → frontend expects title, description, alert_type"""
    await ws_manager.broadcast(admin_id, {
        "type": "ai_alert",
        "alert": {
            "id":          alert.id,
            "title":       alert.title,
            "description": alert.message,
            "alert_type":  "critical" if alert.level == "critical" else "warning",
        }
    })


async def notify_new_message(message, admin_id: int):
    await ws_manager.broadcast(admin_id, {
        "type": "new_message",
        "conversation_id": message.conversation_id,
        "message": {
            "id":              message.id,
            "conversation_id": message.conversation_id,
            "sender_name":     message.sender_name,
            "sender_role":     message.sender_role or "",
            "content":         message.content,
            "is_self":         message.is_self,
            "created_at":      message.created_at.strftime("%I:%M %p"),
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