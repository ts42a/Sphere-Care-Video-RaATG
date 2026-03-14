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
    created_at: str          # pre-formatted string e.g. "Mar 14, 2026 05:50 AM"

    model_config = {"from_attributes": True}


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

    model_config = {"from_attributes": True}


# ---------- MESSAGES ----------

class ConversationCreate(BaseModel):
    name: str
    category: str


class ConversationResponse(BaseModel):
    id: int
    name: str
    category: str
    last_message: Optional[str]
    last_message_at: Optional[str] = None
    unread_count: int
    created_at: Optional[str] = None

    model_config = {"from_attributes": True}


class MessageCreate(BaseModel):
    conversation_id: int
    sender_name: str
    sender_role: str
    content: str
    is_self: str = "false"


class MessageResponse(BaseModel):
    id: int
    conversation_id: int
    sender_name: str
    sender_role: str
    content: str
    is_self: str
    created_at: datetime

    model_config = {"from_attributes": True}


# ---------- RECORDS ----------

class RecordCreate(BaseModel):
    resident_name: str
    category: str
    record_type: str
    file_url: Optional[str] = None
    thumbnail_url: Optional[str] = None
    duration: Optional[str] = None
    notes: Optional[str] = None
    recorded_at: Optional[str] = None
    recorded_time: Optional[str] = None


class RecordResponse(BaseModel):
    id: int
    resident_name: str
    category: str
    record_type: str
    file_url: Optional[str]
    thumbnail_url: Optional[str]
    duration: Optional[str]
    notes: Optional[str]
    recorded_at: Optional[str]
    recorded_time: Optional[str]
    created_at: str

    model_config = {"from_attributes": True}


# ---------- AI INSIGHTS ----------

class AiInsightCreate(BaseModel):
    resident_name: str
    title: str
    body: str
    priority: str = "low"
    is_new: str = "true"


class AiInsightResponse(BaseModel):
    id: int
    resident_name: str
    title: str
    body: str
    priority: str
    is_new: str
    created_at: str

    model_config = {"from_attributes": True}


# Fixed: was incorrectly a single object, should be a summary wrapper
class AiInsightSummary(BaseModel):
    high: int
    mid: int
    low: int
    insights: List[AiInsightResponse]


# ---------- CAMERAS ----------

class CameraCreate(BaseModel):
    title: str
    resident_name: Optional[str] = None
    floor: Optional[str] = None
    status: str = "live"
    alert: str = "fine"
    description: Optional[str] = None
    stream_url: Optional[str] = None


class CameraStatusUpdate(BaseModel):
    status: Optional[str] = None       # "live" | "offline"
    alert: Optional[str] = None        # "critical" | "fine" | "none"
    description: Optional[str] = None


class CameraResponse(BaseModel):
    id: int
    title: str
    resident_name: Optional[str]
    floor: Optional[str]
    status: str
    alert: str
    description: Optional[str]
    stream_url: Optional[str]
    created_at: str

    model_config = {"from_attributes": True}


class CameraStats(BaseModel):
    total_cameras: int
    online: int
    active_alerts: int
    events_24h: int


# ---------- CAMERA ALERTS ----------

class CameraAlertCreate(BaseModel):
    camera_id: Optional[int] = None
    alert_type: str                    # "critical" | "warning" | "info"
    icon: str = "fall"                 # "fall" | "person" | "sound" | "motion"
    title: str
    description: str


class CameraAlertResponse(BaseModel):
    id: int
    camera_id: Optional[int]
    camera_title: Optional[str]
    alert_type: str
    icon: str
    title: str
    description: str
    resolved: bool
    created_at: str

    model_config = {"from_attributes": True}


# ---------- FLAGS ----------

class FlagCreate(BaseModel):
    resident_name:    str
    resident_id:      Optional[str] = None
    event_type:       str                        # Pain | Distress | Agitation | Crying | Fall Risk | Medication | Wandering
    description:      str
    severity:         str                        # High | Medium | Low
    source:           str = "AI"                 # AI | Staff
    status:           str = "Open"
    sev_desc:         Optional[str] = None
    transcript:       Optional[str] = None
    video_timestamp:  Optional[str] = None
    ai_confidence:    Optional[int] = None
    flagged_at:       Optional[str] = None       # ISO datetime string


class FlagStatusUpdate(BaseModel):
    status: str                                  # Open | Pending Review | Resolved | Escalated


class FlagCommentCreate(BaseModel):
    author: str
    body:   str


class FlagCommentResponse(BaseModel):
    id:         int
    flag_id:    int
    author:     str
    body:       str
    created_at: str

    model_config = {"from_attributes": True}


class FlagResponse(BaseModel):
    id:               int
    resident_name:    str
    resident_id:      Optional[str]
    event_type:       str
    description:      str
    severity:         str
    source:           str
    status:           str
    sev_desc:         Optional[str]
    transcript:       Optional[str]
    video_timestamp:  Optional[str]
    ai_confidence:    Optional[int]
    flagged_at:       str
    created_at:       str
    comments:         List[FlagCommentResponse] = []

    model_config = {"from_attributes": True}


class FlagStats(BaseModel):
    ai_flags_today:   int
    manual_flags:     int
    pending_review:   int
    resolved:         int
    total:            int
