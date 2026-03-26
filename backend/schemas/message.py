from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class ConversationCreate(BaseModel):
    name: str
    category: str = "direct"


class ConversationResponse(BaseModel):
    id: int
    name: str
    category: str
    last_message: Optional[str] = None
    last_message_at: Optional[datetime] = None
    unread_count: int
    created_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class MessageCreate(BaseModel):
    conversation_id: int
    sender_name: str
    sender_role: str
    sender_user_id: Optional[int] = None
    content: str
    message_type: str = "text"
    is_self: bool = False


class MessageResponse(BaseModel):
    id: int
    conversation_id: int
    sender_name: str
    sender_role: str
    sender_user_id: Optional[int] = None
    content: str
    message_type: str
    is_self: bool
    created_at: datetime

    model_config = {"from_attributes": True}