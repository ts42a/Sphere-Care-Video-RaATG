from sqlalchemy import BigInteger, Column, DateTime, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import INET, JSONB

from backend.db.base import Base


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(BigInteger, primary_key=True, index=True)
    actor_user_id = Column(BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    actor_admin_id = Column(BigInteger, ForeignKey("admins.id", ondelete="SET NULL"), nullable=True, index=True)
    organization_id = Column(BigInteger, ForeignKey("organizations.id", ondelete="SET NULL"), nullable=True, index=True)
    actor_name = Column(String(255), nullable=True)
    actor_role = Column(String(80), nullable=True)
    action = Column(String(120), nullable=False)
    entity_type = Column(String(120), nullable=False, index=True)
    entity_id = Column(BigInteger, nullable=True, index=True)
    old_values = Column(JSONB, nullable=True)
    new_values = Column(JSONB, nullable=True)
    ip_address = Column(INET, nullable=True)
    user_agent = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
