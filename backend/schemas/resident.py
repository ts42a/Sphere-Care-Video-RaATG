from datetime import date, datetime
from typing import Optional

from pydantic import BaseModel


class ResidentCreate(BaseModel):
    full_name: str
    preferred_name: Optional[str] = None
    age: Optional[int] = None
    date_of_birth: Optional[date] = None
    gender: Optional[str] = None
    room: Optional[str] = None
    bed_no: Optional[str] = None
    status: str = "active"
    care_level: Optional[str] = None
    primary_diagnosis: Optional[str] = None
    mobility_status: Optional[str] = None
    consent_status: Optional[str] = None
    guardian_required: bool = False
    ai_summary: Optional[str] = None
    notes: Optional[str] = None
    admission_date: Optional[date] = None


class ResidentUpdate(BaseModel):
    full_name: Optional[str] = None
    preferred_name: Optional[str] = None
    age: Optional[int] = None
    date_of_birth: Optional[date] = None
    gender: Optional[str] = None
    room: Optional[str] = None
    bed_no: Optional[str] = None
    status: Optional[str] = None
    care_level: Optional[str] = None
    primary_diagnosis: Optional[str] = None
    mobility_status: Optional[str] = None
    consent_status: Optional[str] = None
    guardian_required: Optional[bool] = None
    ai_summary: Optional[str] = None
    notes: Optional[str] = None


class ResidentResponse(BaseModel):
    id: int
    unique_code: str
    full_name: str
    preferred_name: Optional[str] = None
    age: Optional[int] = None
    date_of_birth: Optional[date] = None
    gender: Optional[str] = None
    room: Optional[str] = None
    bed_no: Optional[str] = None
    status: str
    care_level: Optional[str] = None
    primary_diagnosis: Optional[str] = None
    mobility_status: Optional[str] = None
    consent_status: Optional[str] = None
    guardian_required: bool
    ai_summary: Optional[str] = None
    notes: Optional[str] = None
    admission_date: Optional[date] = None
    discharge_date: Optional[date] = None
    created_at: Optional[datetime] = None

    model_config = {"from_attributes": True}
