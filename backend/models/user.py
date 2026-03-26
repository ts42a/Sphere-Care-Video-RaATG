from sqlalchemy import BigInteger, Boolean, Column, Date, DateTime, String, func

from backend.db.base import Base


class User(Base):
    __tablename__ = "users"

    id = Column(BigInteger, primary_key=True, index=True)
    unique_code = Column(String(50), unique=True, nullable=False, index=True)
    email = Column(String(255), unique=True, nullable=False, index=True)
    password_hash = Column(String, nullable=False)
    full_name = Column(String(255), nullable=False)
    phone = Column(String(50), nullable=True)
    date_of_birth = Column(Date, nullable=True)
    gender = Column(String(30), nullable=True)
    profile_photo_url = Column(String, nullable=True)
    global_role = Column(String(50), nullable=False)  # staff, client, family_contact, external_doctor, auditor
    department = Column(String(120), nullable=True)
    license_no = Column(String(120), nullable=True)
    email_notifications = Column(Boolean, nullable=False, default=True)
    push_notifications = Column(Boolean, nullable=False, default=True)
    sms_notifications = Column(Boolean, nullable=False, default=False)
    dark_mode = Column(Boolean, nullable=False, default=False)
    biometric_lock = Column(Boolean, nullable=False, default=False)
    is_active = Column(Boolean, nullable=False, default=True)
    last_login_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())