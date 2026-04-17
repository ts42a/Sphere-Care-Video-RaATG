from sqlalchemy import BigInteger, Boolean, Column, DateTime, ForeignKey, String, Text, func
from sqlalchemy.orm import relationship
from backend.db.base import Base


class Call(Base):
    __tablename__ = "calls"

    id = Column(BigInteger, primary_key=True, index=True)
    org_id = Column(BigInteger, nullable=False, index=True)
    room_id = Column(String(80), nullable=False, unique=True, index=True)  # opaque UUID
    state = Column(String(20), nullable=False, default="ringing", index=True)
    # ringing | active | declined | canceled | timeout | ended | failed
    kind = Column(String(20), nullable=False, default="audio")  # audio | video
    created_by_user_id = Column(BigInteger, nullable=False, index=True)
    callee_user_id = Column(BigInteger, nullable=False, index=True)
    accepted_by_user_id = Column(BigInteger, nullable=True)
    invite_expires_at = Column(DateTime(timezone=True), nullable=False)
    started_at = Column(DateTime(timezone=True), nullable=True)
    ended_at = Column(DateTime(timezone=True), nullable=True)
    ended_by_user_id = Column(BigInteger, nullable=True)
    end_reason = Column(String(50), nullable=True)
    # LiveKit (filled in when LiveKit is configured)
    livekit_url = Column(String(255), nullable=True)
    caller_token = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())

    participants = relationship("CallParticipant", back_populates="call", cascade="all, delete-orphan")
    events = relationship("CallEvent", back_populates="call", cascade="all, delete-orphan")


class CallParticipant(Base):
    __tablename__ = "call_participants"

    id = Column(BigInteger, primary_key=True, index=True)
    call_id = Column(BigInteger, ForeignKey("calls.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(BigInteger, nullable=False, index=True)
    role_at_call_time = Column(String(30), nullable=False)  # admin | staff | client
    joined_at = Column(DateTime(timezone=True), nullable=True)
    left_at = Column(DateTime(timezone=True), nullable=True)
    livekit_identity = Column(String(80), nullable=True)  # usr_<id>
    callee_token = Column(Text, nullable=True)             # filled on accept

    call = relationship("Call", back_populates="participants")


class CallEvent(Base):
    """Append-only audit log for call state transitions."""
    __tablename__ = "call_events"

    id = Column(BigInteger, primary_key=True, index=True)
    call_id = Column(BigInteger, ForeignKey("calls.id", ondelete="CASCADE"), nullable=False, index=True)
    event_type = Column(String(50), nullable=False)
    # invite_sent | push_sent | accepted | declined | canceled | timeout | ended | join_failed
    actor_user_id = Column(BigInteger, nullable=True)
    event_data = Column(Text, nullable=True)  # JSON string
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())

    call = relationship("Call", back_populates="events")