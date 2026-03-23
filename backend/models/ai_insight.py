from datetime import datetime
from sqlalchemy import Column, Integer, String, DateTime, Text

from backend.db.base import Base


class AiInsight(Base):
    __tablename__ = "ai_insights"

    id = Column(Integer, primary_key=True, index=True)
    admin_id = Column(Integer, nullable=False, index=True)
    resident_name = Column(String)
    title = Column(String)
    body = Column(Text)
    priority = Column(String)
    is_new = Column(String, default="true")
    created_at = Column(DateTime, default=datetime.utcnow)
