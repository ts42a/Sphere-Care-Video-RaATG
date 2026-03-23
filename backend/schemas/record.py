from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime


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
    file_url: Optional[str] = None
    thumbnail_url: Optional[str] = None
    duration: Optional[str] = None
    notes: Optional[str] = None
    recorded_at: Optional[str] = None
    recorded_time: Optional[str] = None
    created_at: datetime

    model_config = {"from_attributes": True}


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
    created_at: datetime

    model_config = {"from_attributes": True}


class AiInsightSummary(BaseModel):
    high: int
    mid: int
    low: int
    insights: List[AiInsightResponse]