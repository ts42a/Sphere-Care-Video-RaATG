from sqlalchemy import BigInteger, Boolean, Column, Date, DateTime, ForeignKey, String, Text, Time, func
from sqlalchemy.orm import relationship

from backend.db.base import Base


class Booking(Base):
    __tablename__ = "bookings"

    id = Column(BigInteger, primary_key=True, index=True)
    admin_id = Column(BigInteger, nullable=False, index=True)
    resident_id = Column(BigInteger, ForeignKey("residents.id", ondelete="CASCADE"), nullable=False, index=True)
    doctor_name = Column(String(255), nullable=False)
    doctor_specialty = Column(String(120), nullable=True)
    booking_type = Column(String(120), nullable=False)
    appointment_date = Column(Date, nullable=False)
    start_time = Column(Time, nullable=False)
    end_time = Column(Time, nullable=True)
    location = Column(String(255), nullable=True)
    notes = Column(Text, nullable=True)
    status = Column(String(50), nullable=False, default="requested")
    created_by = Column(BigInteger, nullable=True)
    is_deleted = Column(Boolean, nullable=False, default=False)
    deleted_at = Column(DateTime(timezone=True), nullable=True)
    deleted_by = Column(BigInteger, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())

    resident = relationship("Resident", back_populates="bookings")
