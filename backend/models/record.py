from datetime import datetime
from sqlalchemy import Column, Integer, String, DateTime, Text

from backend.db.base import Base


class Record(Base):
    __tablename__ = "records"

    id = Column(Integer, primary_key=True, index=True)
    admin_id = Column(Integer, nullable=False, index=True)
    resident_name = Column(String)
    category = Column(String)
    record_type = Column(String)
    file_url = Column(String)
    thumbnail_url = Column(String)
    duration = Column(String)
    notes = Column(Text)
    recorded_at = Column(String)
    recorded_time = Column(String)
    created_at = Column(DateTime, default=datetime.utcnow)
