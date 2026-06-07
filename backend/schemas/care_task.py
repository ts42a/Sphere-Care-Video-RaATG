from datetime import date, datetime, time
from typing import Optional

from pydantic import BaseModel, Field


class CareTaskBase(BaseModel):
    resident_id: int
    title: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None
    task_type: str = "activity"
    priority: str = "medium"
    due_date: Optional[date] = None
    due_time: Optional[time] = None
    assigned_staff_id: Optional[int] = None


class CareTaskCreate(CareTaskBase):
    pass


class CareTaskUpdate(BaseModel):
    title: Optional[str] = Field(default=None, max_length=255)
    description: Optional[str] = None
    task_type: Optional[str] = None
    priority: Optional[str] = None
    due_date: Optional[date] = None
    due_time: Optional[time] = None
    assigned_staff_id: Optional[int] = None
    status: Optional[str] = None
    notes: Optional[str] = None


class CareTaskStatusUpdate(BaseModel):
    status: str
    notes: Optional[str] = None


class CareTaskResponse(BaseModel):
    id: int
    admin_id: int
    resident_id: int
    assigned_staff_id: Optional[int] = None
    title: str
    description: Optional[str] = None
    task_type: str
    priority: str
    due_date: Optional[date] = None
    due_time: Optional[time] = None
    status: str
    completed_at: Optional[datetime] = None
    completed_by: Optional[int] = None
    notes: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    resident_name: Optional[str] = None
    assigned_staff_name: Optional[str] = None

    model_config = {"from_attributes": True}
