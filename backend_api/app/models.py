from datetime import datetime

from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Text
from sqlalchemy.orm import relationship

from app.db.base import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    full_name = Column(String, nullable=False)
    email = Column(String, unique=True, nullable=False, index=True)
    password_hash = Column(String, nullable=False)
    role = Column(String, default="staff")
    created_at = Column(DateTime, default=datetime.utcnow)


class Resident(Base):
    __tablename__ = "residents"

    id = Column(Integer, primary_key=True, index=True)
    full_name = Column(String, nullable=False)
    age = Column(Integer, nullable=False)
    room = Column(String, nullable=False)
    status = Column(String, default="stable")
    ai_summary = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    bookings = relationship("Booking", back_populates="resident")


class Booking(Base):
    __tablename__ = "bookings"

    id = Column(Integer, primary_key=True, index=True)
    resident_id = Column(Integer, ForeignKey("residents.id"), nullable=False)
    doctor_name = Column(String, nullable=False)
    booking_type = Column(String, nullable=False)
    date = Column(String, nullable=False)
    time = Column(String, nullable=False)
    status = Column(String, default="pending")
    created_at = Column(DateTime, default=datetime.utcnow)

    resident = relationship("Resident", back_populates="bookings")


class Staff(Base):
    __tablename__ = "staff"

    id = Column(Integer, primary_key=True, index=True)
    staff_id = Column(String, unique=True, nullable=False, index=True)
    full_name = Column(String, nullable=False)
    shift_time = Column(String, nullable=False)
    assigned_unit = Column(String, nullable=False)
    status = Column(String, default="active")
    role = Column(String, default="staff")
    created_at = Column(DateTime, default=datetime.utcnow)


class Alert(Base):
    __tablename__ = "alerts"

    id = Column(Integer, primary_key=True, index=True)
    level = Column(String, nullable=False)        # warning / critical / info
    title = Column(String, nullable=False)
    message = Column(Text, nullable=False)
    is_read = Column(String, default="false")     # "true" / "false"
    created_at = Column(DateTime, default=datetime.utcnow)


class Notification(Base):
    __tablename__ = "notifications"

    id = Column(Integer, primary_key=True, index=True)
    category = Column(String, nullable=False, default="alert")   # appointment / alert / reminder
    title = Column(String, nullable=False)
    body = Column(Text, nullable=False)
    is_read = Column(String, default="false")                    # "true" / "false"
    is_priority = Column(String, default="false")                # "true" / "false"
    created_at = Column(DateTime, default=datetime.utcnow)


class Conversation(Base):
    __tablename__ = "conversations"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    category = Column(String, nullable=False, default="team")    # team / resident / alerts
    last_message = Column(Text, nullable=True)
    last_message_at = Column(DateTime, nullable=True)
    unread_count = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)

    messages = relationship(
        "Message",
        back_populates="conversation",
        cascade="all, delete-orphan"
    )


class Message(Base):
    __tablename__ = "messages"

    id = Column(Integer, primary_key=True, index=True)
    conversation_id = Column(Integer, ForeignKey("conversations.id"), nullable=False)
    sender_name = Column(String, nullable=False)
    sender_role = Column(String, nullable=False)
    content = Column(Text, nullable=False)
    is_self = Column(String, default="false")   # "true" / "false"
    created_at = Column(DateTime, default=datetime.utcnow)

    conversation = relationship("Conversation", back_populates="messages")


class Record(Base):
    __tablename__ = "records"

    id = Column(Integer, primary_key=True, index=True)
    resident_name = Column(String, nullable=False)
    category = Column(String, nullable=False)
    record_type = Column(String, nullable=False)     # video / audio / document
    file_url = Column(String, nullable=True)
    thumbnail_url = Column(String, nullable=True)
    duration = Column(String, nullable=True)
    notes = Column(Text, nullable=True)
    recorded_at = Column(String, nullable=True)      # e.g. 10/22/2025
    recorded_time = Column(String, nullable=True)    # e.g. 09:15
    created_at = Column(DateTime, default=datetime.utcnow)


class AiInsight(Base):
    __tablename__ = "ai_insights"

    id = Column(Integer, primary_key=True, index=True)
    resident_name = Column(String, nullable=False)
    title = Column(String, nullable=False)
    body = Column(Text, nullable=False)
    priority = Column(String, nullable=False)        # high / mid / low
    is_new = Column(String, default="true")          # "true" / "false"
    created_at = Column(DateTime, default=datetime.utcnow)
