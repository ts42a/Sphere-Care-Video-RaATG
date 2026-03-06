from pydantic import BaseModel
from typing import Optional


class ResidentCreate(BaseModel):
    full_name: str
    age: int
    room: str
    status: str = "stable"
    ai_summary: Optional[str] = None


class ResidentResponse(BaseModel):
    id: int
    full_name: str
    age: int
    room: str
    status: str
    ai_summary: Optional[str] = None

    class Config:
        from_attributes = True


class BookingCreate(BaseModel):
    resident_id: int
    doctor_name: str
    booking_type: str
    date: str
    time: str
    status: str = "confirmed"


class BookingResponse(BaseModel):
    id: int
    resident_id: int
    doctor_name: str
    booking_type: str
    date: str
    time: str
    status: str

    class Config:
        from_attributes = True
