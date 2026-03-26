from sqlalchemy import BigInteger, Column, DateTime, ForeignKey, String, Text, func

from backend.db.base import Base


class CenterMembership(Base):
    __tablename__ = "center_memberships"

    id = Column(BigInteger, primary_key=True, index=True)
    user_id = Column(BigInteger, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    organization_id = Column(BigInteger, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    membership_role = Column(String(50), nullable=False)  # staff, client, family_contact, external_doctor
    status = Column(String(50), nullable=False, default="pending", index=True)
    joined_at = Column(DateTime(timezone=True), nullable=True)
    approved_at = Column(DateTime(timezone=True), nullable=True)
    ended_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())


class CenterJoinRequest(Base):
    __tablename__ = "center_join_requests"

    id = Column(BigInteger, primary_key=True, index=True)
    user_id = Column(BigInteger, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    organization_id = Column(BigInteger, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    membership_role = Column(String(50), nullable=False)
    status = Column(String(50), nullable=False, default="pending", index=True)
    initiated_by = Column(String(50), nullable=False)  # user or admin
    request_message = Column(Text, nullable=True)
    rejection_reason = Column(Text, nullable=True)
    requested_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    reviewed_at = Column(DateTime(timezone=True), nullable=True)
    approved_at = Column(DateTime(timezone=True), nullable=True)
    left_at = Column(DateTime(timezone=True), nullable=True)
    reviewed_by_admin_id = Column(BigInteger, ForeignKey("admins.id", ondelete="SET NULL"), nullable=True, index=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())
