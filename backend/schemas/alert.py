from pydantic import BaseModel
from datetime import datetime


class AlertCreate(BaseModel):
    level: str
    title: str
    message: str


class AlertResponse(BaseModel):
    id: int
    level: str
    title: str
    message: str
    is_read: bool
    created_at: datetime

    model_config = {"from_attributes": True}
