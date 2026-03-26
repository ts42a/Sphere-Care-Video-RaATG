from sqlalchemy import BigInteger, Boolean, Column, DateTime, ForeignKey, String, Text, func
from sqlalchemy.orm import relationship

from backend.db.base import Base


class Notification(Base):
    __tablename__ = "notifications"

    id = Column(BigInteger, primary_key=True, index=True)
    admin_id = Column(BigInteger, nullable=False, index=True)
    category = Column(String(100), nullable=False)
    title = Column(String(255), nullable=False)
    body = Column(Text, nullable=False)
    related_entity_type = Column(String(80), nullable=True)
    related_entity_id = Column(BigInteger, nullable=True)
    is_priority = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())

    recipients = relationship("NotificationRecipient", back_populates="notification", cascade="all, delete-orphan")


class NotificationRecipient(Base):
    __tablename__ = "notification_recipients"

    id = Column(BigInteger, primary_key=True, index=True)
    notification_id = Column(BigInteger, ForeignKey("notifications.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(BigInteger, nullable=True, index=True)
    is_read = Column(Boolean, nullable=False, default=False)
    read_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())

    notification = relationship("Notification", back_populates="recipients")
