from datetime import datetime
from sqlalchemy import Column, Integer, String, DateTime, Text
from sqlalchemy.orm import relationship

from backend.db.base import Base


class Resident(Base):
    __tablename__ = "residents"

    id = Column(Integer, primary_key=True, index=True)
    admin_id = Column(Integer, nullable=False, index=True)  # References admin
    full_name = Column(String, nullable=False)
    age = Column(Integer, nullable=False)
    room = Column(String, nullable=False)
    status = Column(String, default="stable")
    ai_summary = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    bookings = relationship("Booking", back_populates="resident")
