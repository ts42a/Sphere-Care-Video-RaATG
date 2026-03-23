from datetime import datetime
from sqlalchemy import Column, Integer, String, DateTime, Text, ForeignKey, Boolean
from sqlalchemy.orm import relationship

from backend.db.base import Base


class Camera(Base):
    __tablename__ = "cameras"

    id = Column(Integer, primary_key=True, index=True)
    admin_id = Column(Integer, nullable=False, index=True)
    title = Column(String)
    resident_name = Column(String)
    floor = Column(String)
    status = Column(String, default="live")
    alert = Column(String, default="fine")
    description = Column(Text)
    stream_url = Column(String)
    created_at = Column(DateTime, default=datetime.utcnow)

    alerts = relationship("CameraAlert", back_populates="camera", cascade="all, delete-orphan")


class CameraAlert(Base):
    __tablename__ = "camera_alerts"

    id = Column(Integer, primary_key=True, index=True)
    admin_id = Column(Integer, nullable=False, index=True)
    camera_id = Column(Integer, ForeignKey("cameras.id"))
    alert_type = Column(String)
    icon = Column(String, default="fall")
    title = Column(String)
    description = Column(Text)
    resolved = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    camera = relationship("Camera", back_populates="alerts")
