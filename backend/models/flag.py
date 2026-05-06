from sqlalchemy import BigInteger, Boolean, Column, DateTime, ForeignKey, Numeric, String, Text, func
from sqlalchemy.orm import relationship

from backend.db.base import Base


class Flag(Base):
    __tablename__ = "flags"

    id               = Column(BigInteger, primary_key=True, index=True)
    admin_id         = Column(BigInteger, nullable=False, index=True)
    resident_id      = Column(BigInteger, ForeignKey("residents.id", ondelete="SET NULL"), nullable=True, index=True)
    resident_name    = Column(String(255), nullable=True)
    camera_id        = Column(BigInteger, ForeignKey("cameras.id", ondelete="SET NULL"), nullable=True, index=True)
    event_type       = Column(String(120), nullable=False)
    description      = Column(Text,        nullable=True)
    severity         = Column(String(30),  nullable=False)
    source           = Column(String(30),  nullable=False, default="ai")

    # Lifecycle status:  new | in_review | confirmed | escalated | resolved | false_alarm
    status           = Column(String(50),  nullable=False, default="new")

    sev_desc         = Column(Text,        nullable=True)
    transcript       = Column(Text,        nullable=True)
    video_timestamp  = Column(String(100), nullable=True)
    ai_confidence    = Column(Numeric(5,2),nullable=True)

    # Lifecycle timestamps
    flagged_at       = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    first_reviewed_at= Column(DateTime(timezone=True), nullable=True)   # when first staff member opened it
    resolved_at      = Column(DateTime(timezone=True), nullable=True)
    escalated_at     = Column(DateTime(timezone=True), nullable=True)

    # Who last acted on it
    reviewed_by_name = Column(String(255), nullable=True)
    reviewed_by_id   = Column(BigInteger,  nullable=True)

    created_by       = Column(BigInteger,  nullable=True)
    is_deleted       = Column(Boolean,     nullable=False, default=False)
    deleted_at       = Column(DateTime(timezone=True), nullable=True)
    deleted_by       = Column(BigInteger,  nullable=True)
    created_at       = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at       = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())

    comments = relationship("FlagComment",  back_populates="flag", cascade="all, delete-orphan")
    reviews  = relationship("FlagReview",   back_populates="flag", cascade="all, delete-orphan",
                            order_by="FlagReview.reviewed_at")


class FlagComment(Base):
    __tablename__ = "flag_comments"

    id             = Column(BigInteger, primary_key=True, index=True)
    admin_id       = Column(BigInteger, nullable=False, index=True)
    flag_id        = Column(BigInteger, ForeignKey("flags.id", ondelete="CASCADE"), nullable=False, index=True)
    author_name    = Column(String(255), nullable=False)
    author_user_id = Column(BigInteger,  nullable=True)
    body           = Column(Text,        nullable=False)
    created_at     = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at     = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())

    flag = relationship("Flag", back_populates="comments")