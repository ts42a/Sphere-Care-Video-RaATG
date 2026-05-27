from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from backend import models
from backend.api.deps import get_db, get_current_auth_context
from backend.schemas.client_booking import (
    AppointmentTypeResponse,
    DoctorResponse,
    ScheduleResponse,
    TimeSlotResponse,
    ClientBookingCreate,
    BookingConfirmationResponse,
)
from backend.services import notification_service
from backend.services.booking_catalog import (
    get_appointment_types,
    get_appointment_type_by_id,
    get_doctors,
    get_doctor_by_id,
    get_slot_templates,
    get_slot_template_by_id,
    get_available_dates,
)

router = APIRouter(prefix="/client/bookings", tags=["Client Bookings"])


def parse_time_text(value: str):
    return datetime.strptime(value, "%H:%M").time()


def build_doctor_response(raw: dict) -> DoctorResponse:
    return DoctorResponse(
        id=raw["id"],
        name=raw["name"],
        role=raw["role"],
        available=raw["available"],
        rating=raw["rating"],
        experience=raw["experience"],
        price=raw["price"],
        specialty=raw.get("specialty"),
    )


def build_schedule_payload(db: Session, admin_id: int, doctor_id: str, date: str):
    doctor = get_doctor_by_id(doctor_id)
    if not doctor:
        raise HTTPException(status_code=404, detail="Doctor not found")

    bookings = db.query(models.Booking).filter(
        models.Booking.admin_id == admin_id,
        models.Booking.appointment_date == datetime.fromisoformat(date).date(),
        models.Booking.doctor_name == doctor["name"],
        models.Booking.is_deleted == False,
    ).all()

    occupied_start_times = {
        booking.start_time.strftime("%H:%M")
        for booking in bookings
        if booking.status.lower() not in {"cancelled", "canceled"}
    }

    time_slots = []
    for slot in get_slot_templates(doctor_id):
        time_slots.append(
            TimeSlotResponse(
                id=slot["id"],
                label=slot["label"],
                available=slot["start"] not in occupied_start_times,
                start=slot["start"],
                end=slot["end"],
            )
        )

    return {
        "doctor": build_doctor_response(doctor),
        "date": date,
        "available_dates": get_available_dates(doctor_id),
        "time_slots": time_slots,
        "version": int(datetime.utcnow().timestamp()),
    }


def build_confirmation_response(booking: models.Booking) -> BookingConfirmationResponse:
    doctor = next(
        (d for d in get_doctors() if d["name"] == booking.doctor_name),
        None,
    )
    appointment_type = next(
        (t for t in get_appointment_types() if t["title"] == booking.booking_type),
        None,
    )

    doctor_payload = build_doctor_response(doctor) if doctor else DoctorResponse(
        id="unknown",
        name=booking.doctor_name,
        role=booking.doctor_specialty or "General Practitioner",
        available=True,
        rating=0.0,
        experience="N/A",
        price="N/A",
        specialty=booking.doctor_specialty,
    )

    type_payload = AppointmentTypeResponse(
        id=appointment_type["id"] if appointment_type else "unknown",
        title=appointment_type["title"] if appointment_type else booking.booking_type,
        duration_minutes=appointment_type["duration_minutes"] if appointment_type else 30,
    )

    return BookingConfirmationResponse(
        booking_id=booking.id,
        status=booking.status,
        doctor=doctor_payload,
        appointment_type=type_payload,
        date=booking.appointment_date.isoformat(),
        time=f"{booking.start_time.strftime('%I:%M %p')} - {booking.end_time.strftime('%I:%M %p')}" if booking.end_time else booking.start_time.strftime('%I:%M %p'),
        room=booking.location or "TBC",
        created_at=booking.created_at,
    )


@router.get("/types", response_model=list[AppointmentTypeResponse])
def list_appointment_types():
    return get_appointment_types()


@router.get("/doctors", response_model=list[DoctorResponse])
def list_doctors(appointmentTypeId: str = Query(...)):
    doctors = get_doctors(appointmentTypeId)
    return [build_doctor_response(item) for item in doctors]


@router.get("/schedule", response_model=ScheduleResponse)
def get_schedule(
    doctorId: str = Query(...),
    date: str = Query(...),
    auth=Depends(get_current_auth_context),
    db: Session = Depends(get_db),
):
    admin_id = auth.get("admin_id")
    if not admin_id:
        raise HTTPException(status_code=403, detail="Missing admin scope")

    payload = build_schedule_payload(db, int(admin_id), doctorId, date)
    return ScheduleResponse(**payload)


@router.post("/", response_model=BookingConfirmationResponse)
async def create_client_booking(
    booking: ClientBookingCreate,
    auth=Depends(get_current_auth_context),
    db: Session = Depends(get_db),
):
    admin_id = auth.get("admin_id")
    resident_id = auth.get("resident_id")
    user_id = auth.get("user_id")
    role = auth.get("role")

    if role != "client":
        raise HTTPException(status_code=403, detail="Client access only")

    if not admin_id or not resident_id:
        raise HTTPException(status_code=403, detail="Missing resident context")

    resident = db.query(models.Resident).filter(
        models.Resident.id == resident_id,
        models.Resident.admin_id == admin_id,
        models.Resident.is_deleted == False,
    ).first()
    if not resident:
        raise HTTPException(status_code=404, detail="Resident not found")

    doctor = get_doctor_by_id(booking.doctor_id)
    if not doctor:
        raise HTTPException(status_code=404, detail="Doctor not found")

    appointment_type = get_appointment_type_by_id(booking.appointment_type_id)
    if not appointment_type:
        raise HTTPException(status_code=404, detail="Appointment type not found")

    if booking.appointment_type_id not in doctor["appointment_type_ids"]:
        raise HTTPException(status_code=400, detail="Doctor does not support this appointment type")

    slot = get_slot_template_by_id(booking.time_slot_id, booking.doctor_id)
    if not slot:
        raise HTTPException(status_code=404, detail="Time slot not found")

    appointment_date = datetime.fromisoformat(booking.date).date()
    slot_start = parse_time_text(slot["start"])

    existing = db.query(models.Booking).filter(
        models.Booking.admin_id == admin_id,
        models.Booking.appointment_date == appointment_date,
        models.Booking.doctor_name == doctor["name"],
        models.Booking.start_time == slot_start,
        models.Booking.is_deleted == False,
    ).first()

    if existing and existing.status.lower() not in {"cancelled", "canceled"}:
        raise HTTPException(status_code=409, detail="Selected time slot is no longer available.")

    new_booking = models.Booking(
        admin_id=admin_id,
        resident_id=resident_id,
        doctor_name=doctor["name"],
        doctor_specialty=doctor.get("specialty"),
        booking_type=appointment_type["title"],
        appointment_date=appointment_date,
        start_time=parse_time_text(slot["start"]),
        end_time=parse_time_text(slot["end"]),
        location=doctor.get("room"),
        notes=None,
        status="confirmed",
        created_by=user_id,
    )

    db.add(new_booking)
    db.commit()
    db.refresh(new_booking)
    new_booking.resident = resident

    schedule_payload = build_schedule_payload(db, int(admin_id), booking.doctor_id, booking.date)
    await notification_service.notify_schedule_updated(
        admin_id=int(admin_id),
        doctor_id=booking.doctor_id,
        date=booking.date,
        schedule_payload=schedule_payload,
    )

    await notification_service.notify_booking_created(new_booking, int(admin_id), db=db)
    await notification_service.notify_client_booking_updated(
        admin_id=int(admin_id),
        booking_id=new_booking.id,
        status=new_booking.status,
    )

    return build_confirmation_response(new_booking)


@router.get("/my", response_model=list[BookingConfirmationResponse])
def list_my_client_bookings(
    auth=Depends(get_current_auth_context),
    db: Session = Depends(get_db),
):
    admin_id = auth.get("admin_id")
    resident_id = auth.get("resident_id")
    role = auth.get("role")

    if role != "client":
        raise HTTPException(status_code=403, detail="Client access only")

    if not admin_id or not resident_id:
        raise HTTPException(status_code=403, detail="Missing resident context")

    bookings = db.query(models.Booking).filter(
        models.Booking.admin_id == admin_id,
        models.Booking.resident_id == resident_id,
        models.Booking.is_deleted == False,
    ).order_by(
        models.Booking.appointment_date.desc(),
        models.Booking.start_time.desc(),
    ).all()

    return [build_confirmation_response(booking) for booking in bookings]


@router.get("/{booking_id}", response_model=BookingConfirmationResponse)
def get_client_booking_confirmation(
    booking_id: int,
    auth=Depends(get_current_auth_context),
    db: Session = Depends(get_db),
):
    admin_id = auth.get("admin_id")
    resident_id = auth.get("resident_id")

    booking = db.query(models.Booking).filter(
        models.Booking.id == booking_id,
        models.Booking.admin_id == admin_id,
        models.Booking.resident_id == resident_id,
        models.Booking.is_deleted == False,
    ).first()

    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")

    return build_confirmation_response(booking)


@router.patch("/{booking_id}/cancel")
async def cancel_client_booking(
    booking_id: int,
    auth=Depends(get_current_auth_context),
    db: Session = Depends(get_db),
):
    admin_id = auth.get("admin_id")
    resident_id = auth.get("resident_id")

    booking = db.query(models.Booking).filter(
        models.Booking.id == booking_id,
        models.Booking.admin_id == admin_id,
        models.Booking.resident_id == resident_id,
        models.Booking.is_deleted == False,
    ).first()

    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")

    booking.status = "cancelled"
    db.commit()
    db.refresh(booking)

    resident = db.query(models.Resident).filter(
        models.Resident.id == booking.resident_id,
        models.Resident.admin_id == admin_id,
        models.Resident.is_deleted == False,
    ).first()
    if resident:
        booking.resident = resident

    doctor = next((d for d in get_doctors() if d["name"] == booking.doctor_name), None)
    doctor_id = doctor["id"] if doctor else "unknown"

    schedule_payload = build_schedule_payload(
        db,
        int(admin_id),
        doctor_id,
        booking.appointment_date.isoformat(),
    )

    await notification_service.notify_schedule_updated(
        admin_id=int(admin_id),
        doctor_id=doctor_id,
        date=booking.appointment_date.isoformat(),
        schedule_payload=schedule_payload,
    )

    await notification_service.notify_booking_updated(booking, int(admin_id), db=db)
    await notification_service.notify_client_booking_updated(
        admin_id=int(admin_id),
        booking_id=booking.id,
        status=booking.status,
    )

    return {"bookingId": booking.id, "status": "cancelled"}
