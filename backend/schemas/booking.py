from datetime import date, datetime, time
from typing import Optional

from pydantic import BaseModel

from .resident import ResidentResponse


class BookingCreate(BaseModel):
    resident_id: int
    doctor_name: str
    doctor_specialty: Optional[str] = None
    booking_type: str
    appointment_date: date
    start_time: time
    end_time: Optional[time] = None
    location: Optional[str] = None
    notes: Optional[str] = None
    status: str = "requested"


class BookingResponse(BaseModel):
    id: int
    resident_id: int
    doctor_name: str
    doctor_specialty: Optional[str] = None
    booking_type: str
    appointment_date: date
    start_time: time
    end_time: Optional[time] = None
    location: Optional[str] = None
    notes: Optional[str] = None
    status: str
    created_at: Optional[datetime] = None
    resident: Optional[ResidentResponse] = None

    model_config = {"from_attributes": True}
