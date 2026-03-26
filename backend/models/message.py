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
    display_name = Column(String(255), nullable=False)
    role = Column(String(80), nullable=True)
    joined_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())

    conversation = relationship("Conversation", back_populates="participants")


class Message(Base):
    __tablename__ = "messages"

    id = Column(BigInteger, primary_key=True, index=True)
    admin_id = Column(BigInteger, nullable=False, index=True)
    conversation_id = Column(BigInteger, ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False, index=True)
    sender_user_id = Column(BigInteger, nullable=True, index=True)
    sender_name = Column(String(255), nullable=False)
    sender_role = Column(String(80), nullable=True)
    content = Column(Text, nullable=False)
    message_type = Column(String(30), nullable=False, default="text")
    is_self = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())

    conversation = relationship("Conversation", back_populates="messages")
