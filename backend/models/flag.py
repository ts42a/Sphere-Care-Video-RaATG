from datetime import datetime
from sqlalchemy import Column, Integer, String, DateTime, Text, ForeignKey
from sqlalchemy.orm import relationship

from backend.db.base import Base


class Flag(Base):
    __tablename__ = "flags"

    id = Column(Integer, primary_key=True, index=True)
    admin_id = Column(Integer, nullable=False, index=True)
    resident_name = Column(String)
    resident_id = Column(String)
    event_type = Column(String)
    description = Column(Text)
    severity = Column(String)
    source = Column(String, default="AI")
    status = Column(String, default="Open")

    sev_desc = Column(Text)
    transcript = Column(Text)
    video_timestamp = Column(String)
    ai_confidence = Column(Integer)

    flagged_at = Column(DateTime, default=datetime.utcnow)
    created_at = Column(DateTime, default=datetime.utcnow)

    comments = relationship("FlagComment", back_populates="flag", cascade="all, delete-orphan")


class FlagComment(Base):
    __tablename__ = "flag_comments"

    id = Column(Integer, primary_key=True, index=True)
    admin_id = Column(Integer, nullable=False, index=True)
    flag_id = Column(Integer, ForeignKey("flags.id"))
    author = Column(String)
    body = Column(Text)
    created_at = Column(DateTime, default=datetime.utcnow)

    flag = relationship("Flag", back_populates="comments")
