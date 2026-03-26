from sqlalchemy import BigInteger, Boolean, Column, DateTime, ForeignKey, String, Text, func
from sqlalchemy.orm import relationship as sa_relationship

from backend.db.base import Base


class ResidentGuardian(Base):
    __tablename__ = "resident_guardians"

    id = Column(BigInteger, primary_key=True, index=True)
    admin_id = Column(BigInteger, nullable=False, index=True)
    resident_id = Column(BigInteger, ForeignKey("residents.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(BigInteger, nullable=True, index=True)
    full_name = Column(String(255), nullable=False)
    relationship = Column(String(100), nullable=True)
    guardian_type = Column(String(100), nullable=False)  # legal_guardian, power_of_attorney, next_of_kin, responsible_person, medical_guardian
    phone = Column(String(50), nullable=True)
    alternate_phone = Column(String(50), nullable=True)
    email = Column(String(255), nullable=True)
    address_line_1 = Column(String(255), nullable=True)
    address_line_2 = Column(String(255), nullable=True)
    city = Column(String(120), nullable=True)
    state = Column(String(120), nullable=True)
    postal_code = Column(String(30), nullable=True)
    country = Column(String(120), nullable=True)
    legal_document_url = Column(Text, nullable=True)
    consent_authority = Column(Boolean, nullable=False, default=False)
    medical_decision_authority = Column(Boolean, nullable=False, default=False)
    financial_decision_authority = Column(Boolean, nullable=False, default=False)
    is_primary_guardian = Column(Boolean, nullable=False, default=False)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())

    resident = sa_relationship("Resident", back_populates="guardians")
