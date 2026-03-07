from pydantic import BaseModel, EmailStr
from typing import Optional, List
from datetime import datetime


# ---------- AUTH ----------

class UserCreate(BaseModel):
    full_name: str
    email: EmailStr
    password: str
    role: str = "staff"


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class UserResponse(BaseModel):
    id: int
    full_name: str
    email: EmailStr
    role: str

    model_config = {"from_attributes": True}


class TokenResponse(BaseModel):
    access_token: str
    user: UserResponse


# ---------- RESIDENTS ----------

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

    model_config = {"from_attributes": True}


# ---------- BOOKINGS ----------

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

    model_config = {"from_attributes": True}


# ---------- STAFF ----------

class StaffCreate(BaseModel):
    staff_id: str
    full_name: str
    shift_time: str
    assigned_unit: str
    status: str = "active"
    role: str = "staff"


class StaffUpdate(BaseModel):
    shift_time: Optional[str] = None
    assigned_unit: Optional[str] = None
    status: Optional[str] = None
    role: Optional[str] = None


class StaffResponse(BaseModel):
    id: int
    staff_id: str
    full_name: str
    shift_time: str
    assigned_unit: str
    status: str
    role: str

    model_config = {"from_attributes": True}


# ---------- ALERTS ----------

class AlertCreate(BaseModel):
    level: str
    title: str
    message: str
    is_read: str = "false"


class AlertResponse(BaseModel):
    id: int
    level: str
    title: str
    message: str
    is_read: str
    created_at: datetime


# ---------- DASHBOARD ----------

class DashboardStats(BaseModel):
    active_staff: int
    pending_tasks: int
    shifts_today: int
    recent_alerts: List[AlertResponse]


# ---------- ANALYTICS ----------

class MonthlyActivityPoint(BaseModel):
    day: str
    value: int


class TaskTypeSlice(BaseModel):
    label: str
    value: int


class DepartmentPerformance(BaseModel):
    department: str
    performance_rate: int


class AnalyticsReport(BaseModel):
    monthly_activity: List[MonthlyActivityPoint]
    task_distribution: List[TaskTypeSlice]
    department_performance: List[DepartmentPerformance]


# ---------- NOTIFICATIONS ----------

class NotificationCreate(BaseModel):
    category: str
    title: str
    body: str
    is_priority: str = "false"


class NotificationResponse(BaseModel):
    id: int
    category: str
    title: str
    body: str
    is_read: str
    is_priority: str
    created_at: datetime


# ---------- MESSAGES ----------

class ConversationCreate(BaseModel):
    name: str
    category: str


class ConversationResponse(BaseModel):
    id: int
    name: str
    category: str
    last_message: Optional[str]
    unread_count: int
    created_at: datetime


class MessageCreate(BaseModel):
    conversation_id: int
    sender_name: str
    sender_role: str
    content: str


class MessageResponse(BaseModel):
    id: int
    conversation_id: int
    sender_name: str
    sender_role: str
    content: str
    is_self: str
    created_at: datetime


# ---------- RECORDS ----------

class RecordCreate(BaseModel):
    resident_name: str
    category: str
    record_type: str
    file_url: Optional[str] = None
    notes: Optional[str] = None


class RecordResponse(BaseModel):
    id: int
    resident_name: str
    category: str
    record_type: str
    file_url: Optional[str]
    notes: Optional[str]
    created_at: datetime


class AiInsightResponse(BaseModel):
    id: int
    resident_name: str
    title: str
    body: str
    priority: str
    is_new: str
    created_at: datetime

class AiInsightCreate(BaseModel):
    resident_name: str
    title: str
    body: str
    priority: str = "low"
    is_new: str = "true"

class AiInsightSummary(BaseModel):
    id: int
    resident_name: str
    title: str
    body: str
    priority: str
    is_new: str
    created_at: datetime

    model_config = {"from_attributes": True}
