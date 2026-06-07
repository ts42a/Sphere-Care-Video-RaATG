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
    related_entity_type: Optional[str] = None
    related_entity_id: Optional[int] = None
    created_at: datetime

    model_config = {"from_attributes": True}


class IncomingAlertOut(BaseModel):
    key: str
    alert_type: str
    title: str
    message: str
    severity: str
    action_url: Optional[str] = None
    created_at: str
    entity_id: Optional[int] = None