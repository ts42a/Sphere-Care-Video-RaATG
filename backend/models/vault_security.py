from sqlalchemy import BigInteger, Boolean, Column, DateTime, ForeignKey, Integer, String, Text, func

from backend.db.base import Base


class VaultKeyEnvelope(Base):
    __tablename__ = "vault_key_envelopes"

    id = Column(BigInteger, primary_key=True, index=True)
    organization_id = Column(BigInteger, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    owner_user_id = Column(BigInteger, ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True)
    owner_admin_id = Column(BigInteger, ForeignKey("admins.id", ondelete="CASCADE"), nullable=True, index=True)
    key_id = Column(String(80), nullable=False, index=True)
    wrap_algorithm = Column(String(80), nullable=False, default="AES-GCM")
    kdf = Column(String(80), nullable=False, default="PBKDF2-SHA256")
    user_wrapped_dek = Column(Text, nullable=False)
    user_wrap_iv = Column(String(128), nullable=False)
    escrow_dek_ciphertext = Column(Text, nullable=True)
    escrow_nonce = Column(String(128), nullable=True)
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())


class VaultRecoveryRequest(Base):
    __tablename__ = "vault_recovery_requests"

    id = Column(BigInteger, primary_key=True, index=True)
    organization_id = Column(BigInteger, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    requester_user_id = Column(BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    requester_admin_id = Column(BigInteger, ForeignKey("admins.id", ondelete="SET NULL"), nullable=True, index=True)
    approved_by_admin_id = Column(BigInteger, ForeignKey("admins.id", ondelete="SET NULL"), nullable=True, index=True)
    reason = Column(Text, nullable=True)
    status = Column(String(30), nullable=False, default="pending", index=True)
    recovery_token_hash = Column(String(128), nullable=True)
    token_expires_at = Column(DateTime(timezone=True), nullable=True)
    token_used_at = Column(DateTime(timezone=True), nullable=True)
    requested_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    approved_at = Column(DateTime(timezone=True), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())


class VaultRetentionPolicy(Base):
    __tablename__ = "vault_retention_policies"

    id = Column(BigInteger, primary_key=True, index=True)
    organization_id = Column(BigInteger, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, unique=True, index=True)
    max_days = Column(Integer, nullable=False, default=30)
    max_storage_mb = Column(Integer, nullable=False, default=1024)
    auto_delete_enabled = Column(Boolean, nullable=False, default=True)
    updated_by_admin_id = Column(BigInteger, ForeignKey("admins.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())
