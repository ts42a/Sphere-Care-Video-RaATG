from pydantic import BaseModel
from datetime import datetime


class NotificationCreate(BaseModel):
    category: str
    title: str
    body: str
    is_priority: bool = False


class NotificationResponse(BaseModel):
    id: int
    category: str
    title: str
    body: str
    is_read: bool
    is_priority: bool
    created_at: datetime

    model_config = {"from_attributes": True}