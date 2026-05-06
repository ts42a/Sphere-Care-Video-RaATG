from datetime import datetime
from typing import List, Optional
from pydantic import BaseModel

VALID_REVIEW_ACTIONS = ("confirm", "false_alarm", "escalate", "resolve", "reopen")
REVIEW_STATUS_MAP = {
    "confirm":     "in_review",
    "false_alarm": "false_alarm",
    "escalate":    "escalated",
    "resolve":     "resolved",
    "reopen":      "new",
}

class FlagCreate(BaseModel):
    resident_name:   str
    resident_id:     Optional[int]   = None
    camera_id:       Optional[int]   = None
    event_type:      str
    description:     str
    severity:        str
    source:          str             = "ai"
    status:          str             = "new"
    sev_desc:        Optional[str]   = None
    transcript:      Optional[str]   = None
    video_timestamp: Optional[str]   = None
    ai_confidence:   Optional[float] = None
    flagged_at:      Optional[datetime] = None

class FlagStatusUpdate(BaseModel):
    status: str

class FlagReviewCreate(BaseModel):
    review_action:    str
    reviewer_name:    str
    reviewer_role:    Optional[str] = None
    reviewer_user_id: Optional[int] = None
    notes:            Optional[str] = None

class FlagReviewResponse(BaseModel):
    id:              int
    flag_id:         int
    reviewer_name:   str
    reviewer_role:   Optional[str]   = None
    review_action:   str
    previous_status: Optional[str]   = None
    new_status:      Optional[str]   = None
    notes:           Optional[str]   = None
    ai_confidence:   Optional[float] = None
    reviewed_at:     str
    model_config = {"from_attributes": True}

class FlagCommentCreate(BaseModel):
    author_name:     str
    author_user_id:  Optional[int] = None
    body:            str

class FlagCommentResponse(BaseModel):
    id:              int
    flag_id:         int
    author_name:     str
    author_user_id:  Optional[int] = None
    body:            str
    created_at:      str
    model_config = {"from_attributes": True}

class FlagResponse(BaseModel):
    id:               int
    resident_name:    str
    resident_id:      Optional[int]   = None
    camera_id:        Optional[int]   = None
    event_type:       str
    description:      str
    severity:         str
    source:           str
    status:           str
    sev_desc:         Optional[str]   = None
    transcript:       Optional[str]   = None
    video_timestamp:  Optional[str]   = None
    ai_confidence:    Optional[float] = None
    flagged_at:       str
    created_at:       str
    reviewed_by_name: Optional[str]   = None
    first_reviewed_at:Optional[str]   = None
    resolved_at:      Optional[str]   = None
    escalated_at:     Optional[str]   = None
    comments:         List[FlagCommentResponse] = []
    reviews:          List[FlagReviewResponse]  = []
    model_config = {"from_attributes": True}

class FlagStats(BaseModel):
    ai_flags_today: int
    manual_flags:   int
    pending_review: int
    resolved:       int
    total:          int
    in_review:      int
    escalated:      int
    false_alarms:   int