from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class NotificationCreate(BaseModel):
    category: str
    title: str
    body: str
    is_priority: bool = False
    related_entity_type: Optional[str] = None
    related_entity_id: Optional[int] = None


class NotificationResponse(BaseModel):
    id: int
    category: str
    title: str
    body: str
    is_priority: bool
    is_read: bool = False
    related_entity_type: Optional[str] = None
    related_entity_id: Optional[int] = None
    created_at: datetime

    model_config = {"from_attributes": True}
