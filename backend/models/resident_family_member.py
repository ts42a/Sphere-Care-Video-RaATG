from sqlalchemy import BigInteger, Boolean, Column, DateTime, ForeignKey, String, Text, func
from sqlalchemy.orm import relationship as sa_relationship

from backend.db.base import Base


class ResidentFamilyMember(Base):
    __tablename__ = "resident_family_members"

    id = Column(BigInteger, primary_key=True, index=True)
    admin_id = Column(BigInteger, nullable=False, index=True)
    resident_id = Column(BigInteger, ForeignKey("residents.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(BigInteger, nullable=True, index=True)
    full_name = Column(String(255), nullable=False)
    relationship = Column(String(100), nullable=False)
    phone = Column(String(50), nullable=True)
    alternate_phone = Column(String(50), nullable=True)
    email = Column(String(255), nullable=True)
    address_line_1 = Column(String(255), nullable=True)
    address_line_2 = Column(String(255), nullable=True)
    city = Column(String(120), nullable=True)
    state = Column(String(120), nullable=True)
    postal_code = Column(String(30), nullable=True)
    country = Column(String(120), nullable=True)
    is_primary_contact = Column(Boolean, nullable=False, default=False)
    can_view_records = Column(Boolean, nullable=False, default=False)
    can_receive_alerts = Column(Boolean, nullable=False, default=False)
    can_join_video_calls = Column(Boolean, nullable=False, default=False)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())

    resident = sa_relationship("Resident", back_populates="family_members")
