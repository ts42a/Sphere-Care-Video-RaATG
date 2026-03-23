from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from backend.api.deps import get_db
from backend import models, schemas

router = APIRouter(prefix="/bookings", tags=["Bookings"])


@router.get("/", response_model=list[schemas.BookingResponse])
def get_bookings(db: Session = Depends(get_db)):
    from sqlalchemy.orm import joinedload
    return (
        db.query(models.Booking)
        .options(joinedload(models.Booking.resident))
        .all()
    )


@router.post("/", response_model=schemas.BookingResponse)
def create_booking(booking: schemas.BookingCreate, db: Session = Depends(get_db)):
    resident = db.query(models.Resident).filter(models.Resident.id == booking.resident_id).first()
    if not resident:
        raise HTTPException(status_code=404, detail="Resident not found")

    new_booking = models.Booking(**booking.model_dump())
    db.add(new_booking)
    db.commit()
    db.refresh(new_booking)
    return new_booking
