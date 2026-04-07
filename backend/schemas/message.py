from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class ConversationParticipantCreate(BaseModel):
    user_id: int
    participant_type: str = "user"
    display_name: Optional[str] = None
    role: Optional[str] = None


class ConversationParticipantResponse(BaseModel):
    id: int
    user_id: Optional[int] = None
    participant_type: str = "user"
    display_name: str
    role: Optional[str] = None
    last_read_at: Optional[datetime] = None
    joined_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class ConversationCreate(BaseModel):
    name: str
    category: str = "direct"
    participants: list[ConversationParticipantCreate] = Field(default_factory=list)


class ConversationResponse(BaseModel):
    id: int
    name: str
    category: str
    last_message: Optional[str] = None
    last_message_at: Optional[datetime] = None
    unread_count: int
    created_at: Optional[datetime] = None
    participant_count: int = 0
    participants: list[ConversationParticipantResponse] = Field(default_factory=list)

    model_config = {"from_attributes": True}


class MessageCreate(BaseModel):
    conversation_id: int
    sender_name: Optional[str] = None
    sender_role: Optional[str] = None
    sender_user_id: Optional[int] = None
    sender_participant_type: Optional[str] = None
    content: str
    message_type: str = "text"
    is_self: bool = False


class MessageResponse(BaseModel):
    id: int
    conversation_id: int
    sender_name: str
    sender_role: Optional[str] = None
    sender_user_id: Optional[int] = None
    sender_participant_type: Optional[str] = None
    content: str
    message_type: str
    is_self: bool
    created_at: datetime

    model_config = {"from_attributes": True}