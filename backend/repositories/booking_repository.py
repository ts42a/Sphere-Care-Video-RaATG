# backend/repositories/booking_repository.py
# Modified — calls notification_service after create / update / delete
# Only 3 lines added per method (the await notify_* calls)

from backend.models.booking import Booking
from backend.services import notification_service


class BookingRepository:
    def __init__(self, db):
        self.db = db

    async def create(self, booking: Booking):
        self.db.add(booking)
        self.db.commit()
        self.db.refresh(booking)
        # ── NEW: push real-time event to all connected frontend clients ──
        await notification_service.notify_booking_created(booking)
        return booking

    async def update_status(self, booking_id: int, status: str):
        booking = self.db.query(Booking).filter(Booking.id == booking_id).first()
        if not booking:
            return None
        booking.status = status
        self.db.commit()
        self.db.refresh(booking)
        # ── NEW: push real-time event ──
        await notification_service.notify_booking_updated(booking)
        return booking

    async def delete(self, booking_id: int, admin_id: int):
        booking = self.db.query(Booking).filter(Booking.id == booking_id).first()
        if not booking:
            return None
        self.db.delete(booking)
        self.db.commit()
        # ── NEW: push real-time event ──
        await notification_service.notify_booking_deleted(booking_id, admin_id)
        return True

    def get_all(self):
        return self.db.query(Booking).all()

    def get_by_id(self, booking_id: int):
        return self.db.query(Booking).filter(Booking.id == booking_id).first()