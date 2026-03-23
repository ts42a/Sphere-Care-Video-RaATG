from pydantic import BaseModel
from typing import Optional, List


class FlagCreate(BaseModel):
    resident_name: str
    resident_id: Optional[str] = None
    event_type: str
    description: str
    severity: str
    source: str = "AI"
    status: str = "Open"
    sev_desc: Optional[str] = None
    transcript: Optional[str] = None
    video_timestamp: Optional[str] = None
    ai_confidence: Optional[float] = None
    flagged_at: Optional[str] = None


class FlagCommentCreate(BaseModel):
    author: str
    body: str


class FlagCommentResponse(BaseModel):
    id: int
    flag_id: int
    author: str
    body: str
    created_at: str

    model_config = {"from_attributes": True}


class FlagResponse(BaseModel):
    id: int
    resident_name: str
    resident_id: Optional[str] = None
    event_type: str
    description: str
    severity: str
    source: str
    status: str
    sev_desc: Optional[str] = None
    transcript: Optional[str] = None
    video_timestamp: Optional[str] = None
    ai_confidence: Optional[float] = None
    flagged_at: str
    created_at: str
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