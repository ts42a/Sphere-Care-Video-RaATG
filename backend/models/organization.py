from sqlalchemy import BigInteger, Boolean, Column, DateTime, String, func

from backend.db.base import Base


class Organization(Base):
    """One care center / organization."""
    __tablename__ = "organizations"

    id = Column(BigInteger, primary_key=True, index=True)
    unique_code = Column(String(50), unique=True, nullable=False, index=True)
    organization_name = Column(String(255), nullable=False, index=True)
    phone = Column(String(50), nullable=True)
    address_line_1 = Column(String(255), nullable=True)
    address_line_2 = Column(String(255), nullable=True)
    city = Column(String(120), nullable=True)
    state = Column(String(120), nullable=True)
    postal_code = Column(String(30), nullable=True)
    country = Column(String(120), nullable=True)
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())
