from sqlalchemy import BigInteger, Boolean, Column, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import relationship as sa_relationship

from backend.db.base import Base


class ResidentEmergencyContact(Base):
    __tablename__ = "resident_emergency_contacts"

    id = Column(BigInteger, primary_key=True, index=True)
    admin_id = Column(BigInteger, nullable=False, index=True)
    resident_id = Column(BigInteger, ForeignKey("residents.id", ondelete="CASCADE"), nullable=False, index=True)
    full_name = Column(String(255), nullable=False)
    relationship = Column(String(100), nullable=True)
    phone = Column(String(50), nullable=False)
    alternate_phone = Column(String(50), nullable=True)
    email = Column(String(255), nullable=True)
    address = Column(Text, nullable=True)
    priority_order = Column(Integer, nullable=False, default=1)
    can_make_decisions = Column(Boolean, nullable=False, default=False)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())

    resident = sa_relationship("Resident", back_populates="emergency_contacts")
