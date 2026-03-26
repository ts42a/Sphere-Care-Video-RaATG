from sqlalchemy import BigInteger, Column, DateTime, ForeignKey, Integer, String, func
from sqlalchemy.orm import relationship as sa_relationship
from backend.db.base import Base


class ClientEmergencyContact(Base):
    __tablename__ = "client_emergency_contacts"

    id = Column(BigInteger, primary_key=True, index=True)
    user_id = Column(BigInteger, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    full_name = Column(String(255), nullable=False)
    relationship = Column(String(100), nullable=True)
    phone = Column(String(50), nullable=False)
    alternate_phone = Column(String(50), nullable=True)
    email = Column(String(255), nullable=True)
    priority_order = Column(Integer, nullable=False, default=1)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())

    user = sa_relationship("User", backref="client_emergency_contacts")
