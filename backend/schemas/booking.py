from pydantic import BaseModel
from typing import Optional
from .resident import ResidentResponse


class BookingCreate(BaseModel):
    resident_id: int
    doctor_name: str
    booking_type: str
    date: str
    time: str
    status: str = "pending"


class BookingResponse(BaseModel):
    id: int
    resident_id: int
    doctor_name: str
    booking_type: str
    date: str
    time: str
    status: str
    resident: Optional[ResidentResponse]

    model_config = {"from_attributes": True}
