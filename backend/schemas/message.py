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
    client_message_id: Optional[str] = None  # for deduplication on retry


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
    is_deleted: bool = False
    edited_at: Optional[datetime] = None
    client_message_id: Optional[str] = None  # echo back for dedup
    created_at: datetime

    model_config = {"from_attributes": True}


# ── NEW: Message read receipt response ──────────────────────────
class MessageReadResponse(BaseModel):
    id: int
    message_id: int
    conversation_id: int
    user_id: int
    participant_type: str
    display_name: str
    read_at: datetime

    model_config = {"from_attributes": True}


# ── NEW: Notification preference schemas ────────────────────────
class NotificationPreferenceCreate(BaseModel):
    muted: bool = False
    mute_until: Optional[datetime] = None
    mention_only: bool = False
    push_enabled: bool = True


class NotificationPreferenceResponse(BaseModel):
    id: int
    user_id: int
    participant_type: str
    conversation_id: Optional[int] = None
    muted: bool
    mute_until: Optional[datetime] = None
    mention_only: bool
    push_enabled: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# ── NEW: Block list schemas ──────────────────────────────────────
class BlockUserRequest(BaseModel):
    user_id: int


class BlockedUserResponse(BaseModel):
    user_id: int
    display_name: Optional[str] = None
    blocked_at: Optional[datetime] = None