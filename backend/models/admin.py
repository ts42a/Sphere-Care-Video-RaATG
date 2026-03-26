from sqlalchemy import BigInteger, Boolean, Column, DateTime, ForeignKey, String, func
from backend.db.base import Base


class Admin(Base):
    """Admin account belonging to an organization."""
    __tablename__ = "admins"

    id = Column(BigInteger, primary_key=True, index=True)
    organization_id = Column(BigInteger, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    unique_code = Column(String(50), unique=True, nullable=False, index=True)
    email = Column(String(255), unique=True, nullable=False, index=True)
    password_hash = Column(String, nullable=False)
    full_name = Column(String(255), nullable=False)
    phone = Column(String(50), nullable=True)
    role = Column(String(50), nullable=False, default="admin")  # admin, super_admin, owner
    is_active = Column(Boolean, nullable=False, default=True)
    last_login_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())
