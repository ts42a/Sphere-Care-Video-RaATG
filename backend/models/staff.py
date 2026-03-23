from datetime import datetime
from sqlalchemy import Column, Integer, String, DateTime, ForeignKey
from sqlalchemy.orm import relationship

from backend.db.base import Base


class Staff(Base):
    __tablename__ = "staff"

    id = Column(Integer, primary_key=True, index=True)
    admin_id = Column(Integer, nullable=False, index=True)  # References admin
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True, unique=True)
    staff_id = Column(String, unique=True, nullable=False, index=True)
    full_name = Column(String, nullable=False)
    shift_time = Column(String, nullable=False)
    assigned_unit = Column(String, nullable=False)
    status = Column(String, default="active")
    role = Column(String, default="staff")
    approval_status = Column(String, default="pending")  # pending, approved, rejected
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", backref="staff_profile")
