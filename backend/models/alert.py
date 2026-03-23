from datetime import datetime
from sqlalchemy import Column, Integer, String, DateTime, Text

from backend.db.base import Base


class Alert(Base):
    __tablename__ = "alerts"

    id = Column(Integer, primary_key=True, index=True)
    admin_id = Column(Integer, nullable=False, index=True)
    level = Column(String, nullable=False)
    title = Column(String, nullable=False)
    message = Column(Text, nullable=False)
    is_read = Column(String, default="false")
    created_at = Column(DateTime, default=datetime.utcnow)
