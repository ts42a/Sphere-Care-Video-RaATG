from sqlalchemy import BigInteger, Column, DateTime, ForeignKey, String, Text, func
from sqlalchemy.orm import relationship

from backend.db.base import Base


class ResidentStaffAssignment(Base):
    __tablename__ = "resident_staff_assignments"

    id = Column(BigInteger, primary_key=True, index=True)
    admin_id = Column(BigInteger, nullable=False, index=True)
    resident_id = Column(BigInteger, ForeignKey("residents.id", ondelete="CASCADE"), nullable=False, index=True)
    staff_id = Column(BigInteger, ForeignKey("staff.id", ondelete="CASCADE"), nullable=False, index=True)
    assignment_role = Column(String(100), nullable=False)
    assigned_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    ended_at = Column(DateTime(timezone=True), nullable=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())

    resident = relationship("Resident", back_populates="staff_assignments")
    staff = relationship("Staff", back_populates="resident_assignments")
