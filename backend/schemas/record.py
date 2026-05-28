from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel


class RecordCreate(BaseModel):
    resident_name: str
    resident_id: Optional[int] = None
    category: str
    record_type: str
    file_url: Optional[str] = None
    file_name: Optional[str] = None
    mime_type: Optional[str] = None
    file_size: Optional[int] = None
    thumbnail_url: Optional[str] = None
    duration: Optional[int] = None
    transcript_text: Optional[str] = None
    ai_summary: Optional[str] = None
    notes: Optional[str] = None
    recorded_at: Optional[datetime] = None


class VaultRecordingUploadIn(BaseModel):
    record_id: str
    resident_name: Optional[str] = "This device"
    category: Optional[str] = "Local camera recording"
    record_type: str = "video"
    mime_type: Optional[str] = "video/webm"
    duration: Optional[int] = None
    started_at: Optional[datetime] = None
    ended_at: Optional[datetime] = None
    iv_b64: str
    cipher_b64: str
    ai_plain_b64: Optional[str] = None
    ai_analyze: bool = False
    room: Optional[str] = None
    camera_id: Optional[str] = None
    notes: Optional[str] = "Encrypted local vault recording"
    file_url: Optional[str] = None


class VaultRecordingUploadOut(BaseModel):
    ok: bool
    record_id: int
    file_path: str
    file_url: str


class RecordResponse(BaseModel):
    id: int
    resident_name: str
    resident_id: Optional[int] = None
    category: str
    record_type: str
    file_url: Optional[str] = None
    file_name: Optional[str] = None
    mime_type: Optional[str] = None
    file_size: Optional[int] = None
    thumbnail_url: Optional[str] = None
    duration: Optional[int] = None
    transcript_text: Optional[str] = None
    ai_summary: Optional[str] = None
    scvam_status: Optional[str] = "none"
    notes: Optional[str] = None
    recorded_at: Optional[datetime] = None
    created_at: datetime

    model_config = {"from_attributes": True}


class ScvamRetryIn(BaseModel):
    ai_plain_b64: Optional[str] = None


class ScvamStatusOut(BaseModel):
    record_id: int
    scvam_status: str
    ai_summary_preview: Optional[str] = None
    job_status: Optional[str] = None
    error_message: Optional[str] = None


class ScvamScriptMinuteBlock(BaseModel):
    minute: int
    label: str
    lines: list[str]


class ScvamScriptOut(BaseModel):
    record_id: Optional[int] = None
    scvam_status: str = "none"
    duration_sec: Optional[int] = None
    title: Optional[str] = None
    heading: Optional[str] = None
    summary_text: Optional[str] = None
    message: Optional[str] = None
    timeline: list[ScvamScriptMinuteBlock] = []
    source: Optional[str] = None
    video_name: Optional[str] = None


class AiInsightCreate(BaseModel):
    resident_name: str
    resident_id: Optional[int] = None
    related_record_id: Optional[int] = None
    related_flag_id: Optional[int] = None
    title: str
    body: str
    category: str
    priority: str = "medium"
    is_new: bool = True
    generated_by_model: Optional[str] = None


class AiInsightResponse(BaseModel):
    id: int
    resident_name: str
    resident_id: Optional[int] = None
    title: str
    body: str
    category: str
    priority: str
    is_new: bool
    generated_by_model: Optional[str] = None
    created_at: datetime

    model_config = {"from_attributes": True}


class AiInsightSummary(BaseModel):
    high: int
    mid: int
    low: int
    insights: List[AiInsightResponse]