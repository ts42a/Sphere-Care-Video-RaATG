from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class ConversationCreate(BaseModel):
    name: str
    category: str


class ConversationResponse(BaseModel):
    id: int
    name: str
    category: str
    last_message: Optional[str] = None
    last_message_at: Optional[str] = None
    unread_count: int
    created_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class MessageCreate(BaseModel):
    conversation_id: int
    sender_name: str
    sender_role: str
    content: str
    is_self: str = "false"


class MessageResponse(BaseModel):
    id: int
    conversation_id: int
    sender_name: str
    sender_role: str
    content: str
    is_self: str
    created_at: datetime

    model_config = {"from_attributes": True}