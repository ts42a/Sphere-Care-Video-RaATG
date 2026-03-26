from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel


class FlagCreate(BaseModel):
    resident_name: str
    resident_id: Optional[int] = None
    camera_id: Optional[int] = None
    event_type: str
    description: str
    severity: str
    source: str = "ai"
    status: str = "open"
    sev_desc: Optional[str] = None
    transcript: Optional[str] = None
    video_timestamp: Optional[str] = None
    ai_confidence: Optional[float] = None
    flagged_at: Optional[datetime] = None


class FlagCommentCreate(BaseModel):
    author_name: str
    author_user_id: Optional[int] = None
    body: str


class FlagCommentResponse(BaseModel):
    id: int
    flag_id: int
    author_name: str
    author_user_id: Optional[int] = None
    body: str
    created_at: datetime

    model_config = {"from_attributes": True}


class FlagResponse(BaseModel):
    id: int
    resident_name: str
    resident_id: Optional[int] = None
    camera_id: Optional[int] = None
    event_type: str
    description: str
    severity: str
    source: str
    status: str
    sev_desc: Optional[str] = None
    transcript: Optional[str] = None
    video_timestamp: Optional[str] = None
    ai_confidence: Optional[float] = None
    flagged_at: datetime
    created_at: datetime
    comments: List[FlagCommentResponse] = []

    model_config = {"from_attributes": True}


class FlagStatusUpdate(BaseModel):
    status: str


class FlagStats(BaseModel):
    ai_flags_today: int
    manual_flags: int
    pending_review: int
    resolved: int
    total: int