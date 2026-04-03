from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from backend.api.deps import get_db
from backend import models, schemas
from backend.services import notification_service  # ── NEW ──

router = APIRouter(tags=["Bookings"])


@router.get("/", response_model=list[schemas.BookingResponse])
def get_bookings(db: Session = Depends(get_db)):
    from sqlalchemy.orm import joinedload
    return (
        db.query(models.Booking)
        .options(joinedload(models.Booking.resident))
        .all()
    )


@router.post("/", response_model=schemas.BookingResponse)
async def create_booking(  # ── NEW: async ──
    booking: schemas.BookingCreate,
    db: Session = Depends(get_db),
):
    resident = db.query(models.Resident).filter(models.Resident.id == booking.resident_id).first()
    if not resident:
        raise HTTPException(status_code=404, detail="Resident not found")

    new_booking = models.Booking(**booking.model_dump())
    db.add(new_booking)
    db.commit()
    db.refresh(new_booking)
    new_booking.resident = resident  # attach for WS payload

    # ── NEW: push real-time event ──
    await notification_service.notify_booking_created(new_booking, new_booking.admin_id)

    return new_booking


@router.patch("/{booking_id}/status", response_model=schemas.BookingResponse)
async def update_booking_status(  # ── NEW ──
    booking_id: int,
    status: str,
    db: Session = Depends(get_db),
):
    """Update booking status — triggers real-time calendar refresh on all tabs."""
    from sqlalchemy.orm import joinedload
    booking = (
        db.query(models.Booking)
        .options(joinedload(models.Booking.resident))
        .filter(models.Booking.id == booking_id)
        .first()
    )
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")

    booking.status = status
    db.commit()
    db.refresh(booking)

    # ── NEW: push real-time event ──
    await notification_service.notify_booking_updated(booking, booking.admin_id)

    return booking


@router.delete("/{booking_id}", status_code=204)
async def delete_booking(  # ── NEW ──
    booking_id: int,
    db: Session = Depends(get_db),
):
    """Delete a booking — removes it from calendar on all tabs."""
    booking = db.query(models.Booking).filter(models.Booking.id == booking_id).first()
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")

    admin_id = booking.admin_id
    db.delete(booking)
    db.commit()

    # ── NEW: push real-time event ──
    await notification_service.notify_booking_deleted(booking_id, admin_id)