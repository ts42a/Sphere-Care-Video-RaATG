from pydantic import BaseModel
from typing import Optional


class CameraCreate(BaseModel):
    title: str
    resident_name: Optional[str] = None
    floor: Optional[str] = None
    description: Optional[str] = None
    stream_url: Optional[str] = None


class CameraResponse(BaseModel):
    id: int
    title: str
    resident_name: Optional[str] = None
    floor: Optional[str] = None
    status: str
    alert: str
    description: Optional[str] = None
    stream_url: Optional[str] = None
    created_at: str

    model_config = {"from_attributes": True}


class CameraStats(BaseModel):
    total_cameras: int
    online: int
    active_alerts: int
    events_24h: int


class CameraStatusUpdate(BaseModel):
    status: Optional[str] = None
    alert: Optional[str] = None
    description: Optional[str] = None


class CameraAlertCreate(BaseModel):
    camera_id: Optional[int] = None
    alert_type: str
    icon: Optional[str] = None
    title: str
    description: Optional[str] = None


class CameraAlertResponse(BaseModel):
    id: int
    camera_id: Optional[int] = None
    camera_title: Optional[str] = None
    alert_type: str
    icon: Optional[str] = None
    title: str
    description: Optional[str] = None
    resolved: bool
    created_at: str

    model_config = {"from_attributes": True}