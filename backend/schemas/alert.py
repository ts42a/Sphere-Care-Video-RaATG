from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class AlertCreate(BaseModel):
    level: str
    title: str
    message: str
    source: str = "system"
    related_entity_type: Optional[str] = None
    related_entity_id: Optional[int] = None


class AlertResponse(BaseModel):
    id: int
    level: str
    title: str
    message: str
    source: str
    related_entity_type: Optional[str] = None
    related_entity_id: Optional[int] = None
    is_read: bool
    read_at: Optional[datetime] = None
    created_at: datetime

    model_config = {"from_attributes": True}
