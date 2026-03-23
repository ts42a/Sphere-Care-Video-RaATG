from datetime import datetime
from sqlalchemy import Column, Integer, String, Boolean, DateTime, Text

from backend.db.base import Base


class Notification(Base):
    __tablename__ = "notifications"

    id = Column(Integer, primary_key=True, index=True)
    admin_id = Column(Integer, nullable=False, index=True)
    category = Column(String, nullable=False, default="alert")
    title = Column(String, nullable=False)
    body = Column(Text, nullable=False)
    is_read = Column(Boolean, default=False)
    is_priority = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)
