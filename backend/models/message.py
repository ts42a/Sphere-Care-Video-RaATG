from sqlalchemy import BigInteger, Boolean, Column, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import relationship

from backend.db.base import Base


class Conversation(Base):
    __tablename__ = "conversations"

    id = Column(BigInteger, primary_key=True, index=True)
    admin_id = Column(BigInteger, nullable=False, index=True)
    name = Column(String(255), nullable=False)
    category = Column(String(50), nullable=False, default="direct")
    created_by = Column(BigInteger, nullable=True)
    last_message = Column(Text, nullable=True)
    last_message_at = Column(DateTime(timezone=True), nullable=True)
    unread_count = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())

    messages = relationship("Message", back_populates="conversation", cascade="all, delete-orphan")
    participants = relationship("ConversationParticipant", back_populates="conversation", cascade="all, delete-orphan")


class ConversationParticipant(Base):
    __tablename__ = "conversation_participants"

    id = Column(BigInteger, primary_key=True, index=True)
    conversation_id = Column(BigInteger, ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(BigInteger, nullable=True, index=True)
    participant_type = Column(String(20), nullable=False, default="user")
    display_name = Column(String(255), nullable=False)
    role = Column(String(80), nullable=True)
    last_read_at = Column(DateTime(timezone=True), nullable=True)
    notifications_muted = Column(Boolean, nullable=False, default=False)
    joined_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())

    conversation = relationship("Conversation", back_populates="participants")


class Message(Base):
    __tablename__ = "messages"

    id = Column(BigInteger, primary_key=True, index=True)
    admin_id = Column(BigInteger, nullable=False, index=True)
    conversation_id = Column(BigInteger, ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False, index=True)
    sender_user_id = Column(BigInteger, nullable=True, index=True)
    sender_participant_type = Column(String(20), nullable=False, default="user")
    sender_name = Column(String(255), nullable=False)
    sender_role = Column(String(80), nullable=True)
    content = Column(Text, nullable=False)
    message_type = Column(String(30), nullable=False, default="text")
    is_self = Column(Boolean, nullable=False, default=False)
    # ── NEW fields ──
    is_deleted = Column(Boolean, nullable=False, default=False)   # soft delete
    edited_at = Column(DateTime(timezone=True), nullable=True)    # last edited
    client_message_id = Column(String(64), nullable=True, index=True)  # dedup on retry
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())

    conversation = relationship("Conversation", back_populates="messages")
    read_receipts = relationship("MessageRead", back_populates="message", cascade="all, delete-orphan")


class MessageRead(Base):
    """
    Tracks exactly who read which message and when.
    One row per (message, user) pair — upserted on read.
    """
    __tablename__ = "message_reads"

    id = Column(BigInteger, primary_key=True, index=True)
    message_id = Column(BigInteger, ForeignKey("messages.id", ondelete="CASCADE"), nullable=False, index=True)
    conversation_id = Column(BigInteger, ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(BigInteger, nullable=False, index=True)
    participant_type = Column(String(20), nullable=False, default="user")
    display_name = Column(String(255), nullable=False, default="")
    read_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())

    message = relationship("Message", back_populates="read_receipts")


class NotificationPreference(Base):
    """
    Per-user notification settings per conversation.
    Extends ConversationParticipant.notifications_muted with richer options.
    """
    __tablename__ = "notification_preferences"

    id = Column(BigInteger, primary_key=True, index=True)
    user_id = Column(BigInteger, nullable=False, index=True)
    participant_type = Column(String(20), nullable=False, default="user")
    conversation_id = Column(BigInteger, ForeignKey("conversations.id", ondelete="CASCADE"), nullable=True, index=True)
    # NULL conversation_id = global default for this user
    muted = Column(Boolean, nullable=False, default=False)
    mute_until = Column(DateTime(timezone=True), nullable=True)  # NULL = forever
    mention_only = Column(Boolean, nullable=False, default=False)
    push_enabled = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())


class MessageDeliveryReceipt(Base):
    """
    Tracks delivered + read timestamps per message per recipient.
    One row per (message_id, participant_id).
    Updated in two stages:
      1. delivered_at — set when WS pushes message to recipient
      2. read_at      — set when recipient opens the conversation
    """
    __tablename__ = "message_delivery_receipts"

    id = Column(BigInteger, primary_key=True, index=True)
    message_id = Column(BigInteger, ForeignKey("messages.id", ondelete="CASCADE"), nullable=False, index=True)
    conversation_id = Column(BigInteger, ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False, index=True)
    recipient_user_id = Column(BigInteger, nullable=False, index=True)
    participant_type = Column(String(20), nullable=False, default="user")
    display_name = Column(String(255), nullable=False, default="")
    delivered_at = Column(DateTime(timezone=True), nullable=True)   # set on WS push
    read_at = Column(DateTime(timezone=True), nullable=True)        # set on open
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())


class MessageOutbox(Base):
    """Fan-out queue for WebSocket delivery with retry support."""
    __tablename__ = "message_outbox"

    id = Column(BigInteger, primary_key=True, index=True)
    message_id = Column(BigInteger, nullable=False, index=True)
    conversation_id = Column(BigInteger, nullable=False, index=True)
    admin_id = Column(BigInteger, nullable=False, index=True)
    actor_key = Column(String(80), nullable=False, index=True)
    payload = Column(Text, nullable=False)
    attempts = Column(Integer, nullable=False, default=0)
    max_attempts = Column(Integer, nullable=False, default=3)
    processed = Column(Boolean, nullable=False, default=False, index=True)
    failed = Column(Boolean, nullable=False, default=False)
    error = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    processed_at = Column(DateTime(timezone=True), nullable=True)