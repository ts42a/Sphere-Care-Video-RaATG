from sqlalchemy import BigInteger, Boolean, Column, Date, DateTime, Integer, String, Text, func
from sqlalchemy.orm import relationship

from backend.db.base import Base


class Resident(Base):
    __tablename__ = "residents"

    id = Column(BigInteger, primary_key=True, index=True)
    unique_code = Column(String(50), unique=True, nullable=False, index=True)
    admin_id = Column(BigInteger, nullable=False, index=True)
    client_user_id = Column(BigInteger, nullable=True, index=True)
    created_by_user_id = Column(BigInteger, nullable=True)
    created_by_name = Column(String(255), nullable=True)
    created_by_role = Column(String(80), nullable=True)
    full_name = Column(String(255), nullable=False)
    preferred_name = Column(String(255), nullable=True)
    age = Column(Integer, nullable=True)
    date_of_birth = Column(Date, nullable=True)
    gender = Column(String(30), nullable=True)
    room = Column(String(50), default="Unassigned")
    bed_no = Column(String(50), nullable=True)
    status = Column(String(50), nullable=False, default="active")
    ai_summary = Column(Text, nullable=True)
    admission_date = Column(Date, nullable=True)
    discharge_date = Column(Date, nullable=True)
    care_level = Column(String(100), nullable=True)
    primary_diagnosis = Column(Text, nullable=True)
    mobility_status = Column(String(100), nullable=True)
    consent_status = Column(String(50), nullable=True)
    guardian_required = Column(Boolean, nullable=False, default=False)
    notes = Column(Text, nullable=True)
    is_deleted = Column(Boolean, nullable=False, default=False)
    deleted_at = Column(DateTime(timezone=True), nullable=True)
    deleted_by = Column(BigInteger, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())

    bookings = relationship("Booking", back_populates="resident")
    medical_profile = relationship("ResidentMedicalProfile", back_populates="resident", uselist=False, cascade="all, delete-orphan")
    family_members = relationship("ResidentFamilyMember", back_populates="resident", cascade="all, delete-orphan")
    guardians = relationship("ResidentGuardian", back_populates="resident", cascade="all, delete-orphan")
    emergency_contacts = relationship("ResidentEmergencyContact", back_populates="resident", cascade="all, delete-orphan")
    staff_assignments = relationship("ResidentStaffAssignment", back_populates="resident", cascade="all, delete-orphan")
