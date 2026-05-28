from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload

from backend.api.deps import get_db
from backend import models, schemas
from backend.services import notification_service

router = APIRouter(tags=["Bookings"])


@router.get("/", response_model=list[schemas.BookingResponse])
def get_bookings(db: Session = Depends(get_db)):
    return (
        db.query(models.Booking)
        .options(joinedload(models.Booking.resident))
        .all()
    )


@router.post("/", response_model=schemas.BookingResponse)
async def create_booking(
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
    new_booking.resident = resident

    await notification_service.notify_booking_created(new_booking, new_booking.admin_id, db=db)

    return new_booking


@router.patch("/{booking_id}/status", response_model=schemas.BookingResponse)
async def update_booking_status(
    booking_id: int,
    status: str,
    db: Session = Depends(get_db),
):
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

    await notification_service.notify_booking_updated(booking, booking.admin_id, db=db)

    return booking


@router.delete("/{booking_id}", status_code=204)
async def delete_booking(
    booking_id: int,
    db: Session = Depends(get_db),
):
    booking = (
        db.query(models.Booking)
        .options(joinedload(models.Booking.resident))
        .filter(models.Booking.id == booking_id)
        .first()
    )
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")

    admin_id = booking.admin_id
    resident_name = booking.resident.full_name if booking.resident else f"Resident #{booking.resident_id}"
    booking_type = booking.booking_type
    doctor_name = booking.doctor_name
    appointment_date = str(booking.appointment_date)
    start_time = str(booking.start_time)

    db.delete(booking)
    db.commit()

    await notification_service.notify_booking_deleted(
        booking_id,
        admin_id,
        db=db,
        booking_title=f"Booking cancelled: {booking_type}",
        booking_body=" · ".join(
            part
            for part in [resident_name, doctor_name, f"{appointment_date} at {start_time}"]
            if part
        ),
    )