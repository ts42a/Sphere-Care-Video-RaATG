from sqlalchemy import BigInteger, Boolean, Column, Date, DateTime, ForeignKey, String, Time, func
from sqlalchemy.orm import relationship

from backend.db.base import Base


class Staff(Base):
    __tablename__ = "staff"

    id = Column(BigInteger, primary_key=True, index=True)
    admin_id = Column(BigInteger, nullable=False, index=True)
    user_id = Column(BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=False, unique=True, index=True)  # ── FIXED: added ForeignKey
    staff_code = Column(String(50), unique=True, nullable=False, index=True)
    full_name = Column(String(255), nullable=False)
    role = Column(String(80), nullable=False)
    department = Column(String(120), nullable=True)
    shift_start = Column(Time, nullable=True)
    shift_end = Column(Time, nullable=True)
    assigned_unit = Column(String(120), nullable=True)
    status = Column(String(50), nullable=False, default="active")
    approval_status = Column(String(50), nullable=False, default="pending")
    hire_date = Column(Date, nullable=True)
    is_deleted = Column(Boolean, nullable=False, default=False)
    deleted_at = Column(DateTime(timezone=True), nullable=True)
    deleted_by = Column(BigInteger, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())

    # ── NEW: relationship to User model ──
    user = relationship("User", foreign_keys=[user_id])

    resident_assignments = relationship("ResidentStaffAssignment", back_populates="staff", cascade="all, delete-orphan")