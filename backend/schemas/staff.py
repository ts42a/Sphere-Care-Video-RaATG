from datetime import date, datetime, time
from typing import Optional

from pydantic import BaseModel


class StaffCreate(BaseModel):
    staff_code: str
    full_name: str
    role: str
    department: Optional[str] = None
    shift_start: Optional[time] = None
    shift_end: Optional[time] = None
    assigned_unit: str
    hire_date: Optional[date] = None


class StaffUpdate(BaseModel):
    shift_start: Optional[time] = None
    shift_end: Optional[time] = None
    assigned_unit: Optional[str] = None
    status: Optional[str] = None
    role: Optional[str] = None
    department: Optional[str] = None


class StaffResponse(BaseModel):
    id: int
    user_id: Optional[int] = None   # ← ADDED: needed by frontend to initiate calls
    staff_code: str
    full_name: str
    role: str
    department: Optional[str] = None
    shift_start: Optional[time] = None
    shift_end: Optional[time] = None
    assigned_unit: str
    status: str
    approval_status: str
    hire_date: Optional[date] = None
    created_at: Optional[datetime] = None

    model_config = {"from_attributes": True}