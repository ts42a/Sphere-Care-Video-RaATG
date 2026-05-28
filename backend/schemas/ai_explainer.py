from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field


class ExplainerJobCreate(BaseModel):
    video_path: str = Field(min_length=1)
    camera_id: str = Field(default="camera_0", min_length=1, max_length=120)
    chunk_seconds: float = Field(default=8.0, ge=2.0, le=30.0)
    max_frames: int = Field(default=220, ge=10, le=3000)


class ExplainerJobResponse(BaseModel):
    run_id: str
    camera_id: str
    chunk_count: int
    selected_frames: int
    digest: str
    perception_backend: str


class ExplainerChunkResponse(BaseModel):
    id: int
    camera_id: str
    chunk_id: str
    zone: str
    start_ts: float
    end_ts: float
    headline: str
    summary: str
    details: List[str]
    severity: str
    confidence: float
    source_video: Optional[str] = None
    run_id: Optional[str] = None
    created_at: datetime

    model_config = {"from_attributes": True}


class ExplainerDigestResponse(BaseModel):
    camera_id: Optional[str] = None
    from_ts: Optional[datetime] = None
    to_ts: Optional[datetime] = None
    total_chunks: int
    notable_chunks: int
    incident_linked_chunks: int
    average_confidence: float
    summary: str
