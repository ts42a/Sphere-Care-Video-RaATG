from datetime import datetime
from sqlalchemy import Column, Integer, String, DateTime, Boolean, ForeignKey
from sqlalchemy.orm import relationship

from backend.db.base import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    admin_id = Column(Integer, nullable=False, index=True)  # References admin in admin's database
    full_name = Column(String, nullable=False)
    email = Column(String, nullable=False, index=True)
    password_hash = Column(String, nullable=False)
    role = Column(String, default="staff")
    phone = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    department = Column(String, nullable=True)
    license_no = Column(String, nullable=True)

    email_notifications = Column(Boolean, default=True)
    push_notifications = Column(Boolean, default=True)
    dark_mode = Column(Boolean, default=False)
    biometric_lock = Column(Boolean, default=False)