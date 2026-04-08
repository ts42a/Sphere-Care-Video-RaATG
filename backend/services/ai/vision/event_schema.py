from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel, Field


class BoundingBox(BaseModel):
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    w: float = Field(ge=0, le=1)
    h: float = Field(ge=0, le=1)


class Detection(BaseModel):
    label: str
    confidence: float = Field(ge=0, le=1)
    bbox: BoundingBox


class FrameAnalysis(BaseModel):
    frame_index: int
    timestamp_sec: float
    camera_id: Optional[int] = None
    detections: List[Detection] = Field(default_factory=list)
    motion_score: float = 0.0
    zone_hits: List[str] = Field(default_factory=list)


class RuleHit(BaseModel):
    event_type: str
    severity: str
    description: str
    video_timestamp: str
    ai_confidence: float
    transcript_hint: str = ""
    insight_category: str = "safety"
    insight_priority: str = "mid"
