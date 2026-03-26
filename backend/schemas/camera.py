from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class CameraCreate(BaseModel):
    title: str
    resident_id: Optional[int] = None
    resident_name: Optional[str] = None
    floor: Optional[str] = None
    room: Optional[str] = None
    location_note: Optional[str] = None
    description: Optional[str] = None
    stream_url: Optional[str] = None


class CameraResponse(BaseModel):
    id: int
    title: str
    resident_id: Optional[int] = None
    resident_name: Optional[str] = None
    floor: Optional[str] = None
    room: Optional[str] = None
    location_note: Optional[str] = None
    status: str
    stream_status: str
    description: Optional[str] = None
    stream_url: Optional[str] = None
    thumbnail_url: Optional[str] = None
    installed_at: Optional[datetime] = None
    last_seen_at: Optional[datetime] = None
    created_at: datetime

    model_config = {"from_attributes": True}


class CameraStats(BaseModel):
    total_cameras: int
    online: int
    active_alerts: int
    events_24h: int


class CameraStatusUpdate(BaseModel):
    status: Optional[str] = None
    stream_status: Optional[str] = None
    description: Optional[str] = None


class CameraAlertCreate(BaseModel):
    camera_id: Optional[int] = None
    resident_id: Optional[int] = None
    alert_type: str
    severity: str = "medium"
    icon: Optional[str] = None
    title: str
    description: Optional[str] = None
    snapshot_url: Optional[str] = None
    video_timestamp: Optional[str] = None


class CameraAlertResponse(BaseModel):
    id: int
    camera_id: Optional[int] = None
    camera_title: Optional[str] = None
    resident_id: Optional[int] = None
    alert_type: str
    severity: str
    icon: Optional[str] = None
    title: str
    description: Optional[str] = None
    snapshot_url: Optional[str] = None
    video_timestamp: Optional[str] = None
    resolved: bool
    resolved_by: Optional[int] = None
    resolved_at: Optional[datetime] = None
    created_at: datetime

    model_config = {"from_attributes": True}