from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class VaultEnvelopeUpsert(BaseModel):
    key_id: str = Field(min_length=8, max_length=80)
    user_wrapped_dek: str = Field(min_length=16)
    user_wrap_iv: str = Field(min_length=8)
    wrap_algorithm: str = "AES-GCM"
    kdf: str = "PBKDF2-SHA256"
    dek_b64_for_escrow: Optional[str] = None


class VaultEnvelopeResponse(BaseModel):
    key_id: str
    user_wrapped_dek: str
    user_wrap_iv: str
    wrap_algorithm: str
    kdf: str
    updated_at: datetime


class VaultRecoveryRequestCreate(BaseModel):
    reason: Optional[str] = Field(default=None, max_length=2000)


class VaultRecoveryRequestOut(BaseModel):
    id: int
    status: str
    reason: Optional[str]
    requested_at: datetime
    requester_user_id: Optional[int]
    requester_admin_id: Optional[int]
    approved_by_admin_id: Optional[int]
    token_expires_at: Optional[datetime]


class VaultRecoveryApproveResponse(BaseModel):
    request_id: int
    one_time_token: str
    token_expires_at: datetime


class VaultRecoveryConsumeIn(BaseModel):
    request_id: int
    one_time_token: str


class VaultRecoveryConsumeOut(BaseModel):
    key_id: str
    dek_b64: str
    token_consumed: bool


class VaultRetentionPolicyUpdate(BaseModel):
    max_days: int = Field(ge=1, le=3650)
    max_storage_mb: int = Field(ge=128, le=512000)
    auto_delete_enabled: bool


class VaultRetentionPolicyOut(BaseModel):
    max_days: int
    max_storage_mb: int
    auto_delete_enabled: bool
    updated_at: datetime
    updated_by_admin_id: Optional[int] = None


class VaultAuditEventIn(BaseModel):
    action: str = Field(min_length=3, max_length=120)
    details: Optional[dict] = None


class VaultAuditEventOut(BaseModel):
    id: int
    action: str
    actor_role: Optional[str]
    actor_name: Optional[str]
    created_at: datetime
    details: Optional[dict] = None
