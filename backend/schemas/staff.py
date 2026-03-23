from pydantic import BaseModel
from typing import Optional


class StaffCreate(BaseModel):
    staff_id: str
    full_name: str
    shift_time: str
    assigned_unit: str


class StaffUpdate(BaseModel):
    shift_time: Optional[str]
    assigned_unit: Optional[str]
    status: Optional[str]
    role: Optional[str]


class StaffResponse(BaseModel):
    id: int
    staff_id: str
    full_name: str
    shift_time: str
    assigned_unit: str
    status: str
    role: str

    model_config = {"from_attributes": True}
