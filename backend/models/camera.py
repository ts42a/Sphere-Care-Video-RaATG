from sqlalchemy import BigInteger, Boolean, Column, DateTime, ForeignKey, Numeric, String, Text, func
from sqlalchemy.orm import relationship

from backend.db.base import Base


class Camera(Base):
    __tablename__ = "cameras"

    id = Column(BigInteger, primary_key=True, index=True)
    admin_id = Column(BigInteger, nullable=False, index=True)
    title = Column(String(255), nullable=False)
    resident_id = Column(BigInteger, ForeignKey("residents.id", ondelete="SET NULL"), nullable=True, index=True)
    resident_name = Column(String(255), nullable=True)
    floor = Column(String(50), nullable=True)
    room = Column(String(50), nullable=True)
    location_note = Column(String(255), nullable=True)
    status = Column(String(50), nullable=False, default="active")
    stream_status = Column(String(50), nullable=False, default="offline")
    stream_url = Column(Text, nullable=True)
    thumbnail_url = Column(Text, nullable=True)
    description = Column(Text, nullable=True)
    installed_at = Column(DateTime(timezone=True), nullable=True)
    last_seen_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())

    alerts = relationship("CameraAlert", back_populates="camera", cascade="all, delete-orphan")


class CameraAlert(Base):
    __tablename__ = "camera_alerts"

    id = Column(BigInteger, primary_key=True, index=True)
    admin_id = Column(BigInteger, nullable=False, index=True)
    camera_id = Column(BigInteger, ForeignKey("cameras.id", ondelete="CASCADE"), nullable=False, index=True)
    resident_id = Column(BigInteger, ForeignKey("residents.id", ondelete="SET NULL"), nullable=True, index=True)
    alert_type = Column(String(100), nullable=False)
    severity = Column(String(30), nullable=False)
    icon = Column(String(100), nullable=True)
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    snapshot_url = Column(Text, nullable=True)
    video_timestamp = Column(String(100), nullable=True)
    resolved = Column(Boolean, nullable=False, default=False)
    resolved_by = Column(BigInteger, nullable=True)
    resolved_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())

    camera = relationship("Camera", back_populates="alerts")
