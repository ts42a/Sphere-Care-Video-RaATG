from datetime import datetime
from typing import Optional
from pydantic import BaseModel


class AppointmentTypeResponse(BaseModel):
    id: str
    title: str
    duration_minutes: int


class DoctorResponse(BaseModel):
    id: str
    name: str
    role: str
    available: bool
    rating: float
    experience: str
    price: str
    specialty: Optional[str] = None


class TimeSlotResponse(BaseModel):
    id: str
    label: str
    available: bool
    start: Optional[str] = None
    end: Optional[str] = None


class ScheduleResponse(BaseModel):
    doctor: DoctorResponse
    date: str
    available_dates: list[str]
    time_slots: list[TimeSlotResponse]
    version: int


class ClientBookingCreate(BaseModel):
    appointment_type_id: str
    doctor_id: str
    date: str
    time_slot_id: str


class BookingConfirmationResponse(BaseModel):
    booking_id: int
    status: str
    doctor: DoctorResponse
    appointment_type: AppointmentTypeResponse
    date: str
    time: str
    room: str
    created_at: Optional[datetime] = None
