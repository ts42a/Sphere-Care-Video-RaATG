from sqlalchemy import BigInteger, Column, DateTime, ForeignKey, String, Text, func
from sqlalchemy.orm import relationship

from backend.db.base import Base


class ResidentMedicalProfile(Base):
    __tablename__ = "resident_medical_profiles"

    id = Column(BigInteger, primary_key=True, index=True)
    admin_id = Column(BigInteger, nullable=False, index=True)
    resident_id = Column(BigInteger, ForeignKey("residents.id", ondelete="CASCADE"), nullable=False, unique=True, index=True)
    blood_group = Column(String(10), nullable=True)
    allergies = Column(Text, nullable=True)
    chronic_conditions = Column(Text, nullable=True)
    medications = Column(Text, nullable=True)
    primary_doctor = Column(String(255), nullable=True)
    hospital_preference = Column(String(255), nullable=True)
    mobility_notes = Column(Text, nullable=True)
    dietary_requirements = Column(Text, nullable=True)
    mental_health_notes = Column(Text, nullable=True)
    fall_risk_level = Column(String(50), nullable=True)
    dementia_status = Column(String(100), nullable=True)
    communication_notes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())

    resident = relationship("Resident", back_populates="medical_profile")
