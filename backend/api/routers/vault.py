import base64
import hashlib
import json
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session

from backend import models, schemas
from backend.api.deps import get_db
from backend.api.routers.auth import _get_current_user
from backend.api.rbac import require_admin_account
from backend.core.config import SECRET_KEY

router = APIRouter(prefix="/vault", tags=["Vault Security"])


def _derive_escrow_key() -> bytes:
    digest = hashlib.sha256(SECRET_KEY.encode("utf-8")).digest()
    return digest


def _escrow_encrypt_dek(dek_b64: str) -> tuple[str, str]:
    key = _derive_escrow_key()
    aesgcm = AESGCM(key)
    nonce = secrets.token_bytes(12)
    plaintext = dek_b64.encode("utf-8")
    ciphertext = aesgcm.encrypt(nonce, plaintext, associated_data=None)
    return (
        base64.b64encode(ciphertext).decode("utf-8"),
        base64.b64encode(nonce).decode("utf-8"),
    )


def _escrow_decrypt_dek(ciphertext_b64: str, nonce_b64: str) -> str:
    key = _derive_escrow_key()
    aesgcm = AESGCM(key)
    ciphertext = base64.b64decode(ciphertext_b64.encode("utf-8"))
    nonce = base64.b64decode(nonce_b64.encode("utf-8"))
    plain = aesgcm.decrypt(nonce, ciphertext, associated_data=None)
    return plain.decode("utf-8")


def _sha256_hex(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _resolve_scope(db: Session, current_user) -> dict:
    if isinstance(current_user, models.Admin):
        return {
            "organization_id": int(current_user.organization_id),
            "actor_admin_id": int(current_user.id),
            "actor_user_id": None,
            "requester_admin_id": int(current_user.id),
            "requester_user_id": None,
            "actor_role": "admin",
            "actor_name": current_user.full_name,
            "owner_admin_id": int(current_user.id),
            "owner_user_id": None,
        }

    role = getattr(current_user, "global_role", None)
    if role == "staff":
        staff_row = (
            db.query(models.Staff)
            .filter(
                models.Staff.user_id == current_user.id,
                models.Staff.is_deleted == False,  # noqa: E712
            )
            .first()
        )
        if not staff_row:
            raise HTTPException(status_code=403, detail={"msg": "Staff profile not found"})
        admin_row = db.query(models.Admin).filter(models.Admin.id == staff_row.admin_id).first()
        if not admin_row:
            raise HTTPException(status_code=403, detail={"msg": "Staff admin context not found"})
        return {
            "organization_id": int(admin_row.organization_id),
            "actor_admin_id": None,
            "actor_user_id": int(current_user.id),
            "requester_admin_id": None,
            "requester_user_id": int(current_user.id),
            "actor_role": "staff",
            "actor_name": current_user.full_name,
            "owner_admin_id": None,
            "owner_user_id": int(current_user.id),
        }

    raise HTTPException(status_code=403, detail={"msg": "Vault features require staff or admin account"})


def _write_vault_audit(
    db: Session,
    *,
    scope: dict,
    action: str,
    details: Optional[dict] = None,
    request: Optional[Request] = None,
) -> None:
    log = models.AuditLog(
        actor_user_id=scope.get("actor_user_id"),
        actor_admin_id=scope.get("actor_admin_id"),
        organization_id=scope.get("organization_id"),
        actor_name=scope.get("actor_name"),
        actor_role=scope.get("actor_role"),
        action=action,
        entity_type="vault_security",
        entity_id=None,
        new_values=details or None,
        ip_address=request.client.host if request and request.client else None,
        user_agent=request.headers.get("user-agent") if request else None,
    )
    db.add(log)


def _get_or_create_retention_policy(db: Session, organization_id: int) -> models.VaultRetentionPolicy:
    policy = (
        db.query(models.VaultRetentionPolicy)
        .filter(models.VaultRetentionPolicy.organization_id == organization_id)
        .first()
    )
    if policy:
        return policy
    policy = models.VaultRetentionPolicy(
        organization_id=organization_id,
        max_days=30,
        max_storage_mb=1024,
        auto_delete_enabled=True,
    )
    db.add(policy)
    db.flush()
    return policy


def _get_or_create_ai_access_policy(db: Session, organization_id: int) -> models.VaultAiAccessPolicy:
    policy = (
        db.query(models.VaultAiAccessPolicy)
        .filter(models.VaultAiAccessPolicy.organization_id == organization_id)
        .first()
    )
    if policy:
        return policy
    policy = models.VaultAiAccessPolicy(
        organization_id=organization_id,
        enabled=True,
        allow_summary_generation=True,
    )
    db.add(policy)
    db.flush()
    return policy


def _normalize_int_list(values) -> list[int]:
    out: list[int] = []
    if not values:
        return out
    for v in values:
        try:
            n = int(v)
        except (TypeError, ValueError):
            continue
        if n > 0:
            out.append(n)
    return sorted(set(out))


def _enc_ai_passphrase(passphrase: str) -> tuple[str, str]:
    key = _derive_escrow_key()
    aesgcm = AESGCM(key)
    nonce = secrets.token_bytes(12)
    ciphertext = aesgcm.encrypt(nonce, passphrase.encode("utf-8"), associated_data=None)
    return base64.b64encode(ciphertext).decode("utf-8"), base64.b64encode(nonce).decode("utf-8")


@router.put("/envelope", response_model=schemas.VaultEnvelopeResponse)
def upsert_my_vault_envelope(
    payload: schemas.VaultEnvelopeUpsert,
    request: Request,
    current_user=Depends(_get_current_user),
    db: Session = Depends(get_db),
):
    scope = _resolve_scope(db, current_user)

    envelope = (
        db.query(models.VaultKeyEnvelope)
        .filter(
            models.VaultKeyEnvelope.organization_id == scope["organization_id"],
            models.VaultKeyEnvelope.owner_user_id == scope["owner_user_id"],
            models.VaultKeyEnvelope.owner_admin_id == scope["owner_admin_id"],
            models.VaultKeyEnvelope.is_active == True,  # noqa: E712
        )
        .first()
    )

    escrow_ciphertext = None
    escrow_nonce = None
    if payload.dek_b64_for_escrow:
        try:
            base64.b64decode(payload.dek_b64_for_escrow.encode("utf-8"))
        except Exception as exc:
            raise HTTPException(status_code=400, detail={"msg": "Invalid dek_b64_for_escrow"}) from exc
        escrow_ciphertext, escrow_nonce = _escrow_encrypt_dek(payload.dek_b64_for_escrow)

    if not envelope:
        envelope = models.VaultKeyEnvelope(
            organization_id=scope["organization_id"],
            owner_user_id=scope["owner_user_id"],
            owner_admin_id=scope["owner_admin_id"],
            key_id=payload.key_id,
            wrap_algorithm=payload.wrap_algorithm,
            kdf=payload.kdf,
            user_wrapped_dek=payload.user_wrapped_dek,
            user_wrap_iv=payload.user_wrap_iv,
            escrow_dek_ciphertext=escrow_ciphertext,
            escrow_nonce=escrow_nonce,
            is_active=True,
        )
        db.add(envelope)
    else:
        envelope.key_id = payload.key_id
        envelope.wrap_algorithm = payload.wrap_algorithm
        envelope.kdf = payload.kdf
        envelope.user_wrapped_dek = payload.user_wrapped_dek
        envelope.user_wrap_iv = payload.user_wrap_iv
        if escrow_ciphertext and escrow_nonce:
            envelope.escrow_dek_ciphertext = escrow_ciphertext
            envelope.escrow_nonce = escrow_nonce

    _write_vault_audit(
        db,
        scope=scope,
        action="vault_envelope_upsert",
        details={"key_id": payload.key_id},
        request=request,
    )
    db.commit()
    db.refresh(envelope)
    return schemas.VaultEnvelopeResponse(
        key_id=envelope.key_id,
        user_wrapped_dek=envelope.user_wrapped_dek,
        user_wrap_iv=envelope.user_wrap_iv,
        wrap_algorithm=envelope.wrap_algorithm,
        kdf=envelope.kdf,
        updated_at=envelope.updated_at,
    )


@router.get("/envelope/me", response_model=schemas.VaultEnvelopeResponse)
def get_my_vault_envelope(
    current_user=Depends(_get_current_user),
    db: Session = Depends(get_db),
):
    scope = _resolve_scope(db, current_user)
    envelope = (
        db.query(models.VaultKeyEnvelope)
        .filter(
            models.VaultKeyEnvelope.organization_id == scope["organization_id"],
            models.VaultKeyEnvelope.owner_user_id == scope["owner_user_id"],
            models.VaultKeyEnvelope.owner_admin_id == scope["owner_admin_id"],
            models.VaultKeyEnvelope.is_active == True,  # noqa: E712
        )
        .first()
    )
    if not envelope:
        raise HTTPException(status_code=404, detail={"msg": "No vault envelope found"})
    return schemas.VaultEnvelopeResponse(
        key_id=envelope.key_id,
        user_wrapped_dek=envelope.user_wrapped_dek,
        user_wrap_iv=envelope.user_wrap_iv,
        wrap_algorithm=envelope.wrap_algorithm,
        kdf=envelope.kdf,
        updated_at=envelope.updated_at,
    )


@router.post("/recovery/request", response_model=schemas.VaultRecoveryRequestOut)
def create_recovery_request(
    payload: schemas.VaultRecoveryRequestCreate,
    request: Request,
    current_user=Depends(_get_current_user),
    db: Session = Depends(get_db),
):
    scope = _resolve_scope(db, current_user)
    req = models.VaultRecoveryRequest(
        organization_id=scope["organization_id"],
        requester_user_id=scope["requester_user_id"],
        requester_admin_id=scope["requester_admin_id"],
        reason=payload.reason,
        status="pending",
    )
    db.add(req)
    _write_vault_audit(
        db,
        scope=scope,
        action="vault_recovery_requested",
        details={"reason": payload.reason},
        request=request,
    )
    db.commit()
    db.refresh(req)
    return schemas.VaultRecoveryRequestOut(
        id=req.id,
        status=req.status,
        reason=req.reason,
        requested_at=req.requested_at,
        requester_user_id=req.requester_user_id,
        requester_admin_id=req.requester_admin_id,
        approved_by_admin_id=req.approved_by_admin_id,
        token_expires_at=req.token_expires_at,
    )


@router.get("/recovery/requests", response_model=list[schemas.VaultRecoveryRequestOut])
def list_recovery_requests(
    status: Optional[str] = Query(default=None),
    admin=Depends(require_admin_account),
    db: Session = Depends(get_db),
):
    query = db.query(models.VaultRecoveryRequest).filter(
        models.VaultRecoveryRequest.organization_id == admin.organization_id
    )
    if status:
        query = query.filter(models.VaultRecoveryRequest.status == status)
    rows = query.order_by(models.VaultRecoveryRequest.requested_at.desc()).limit(200).all()
    return [
        schemas.VaultRecoveryRequestOut(
            id=r.id,
            status=r.status,
            reason=r.reason,
            requested_at=r.requested_at,
            requester_user_id=r.requester_user_id,
            requester_admin_id=r.requester_admin_id,
            approved_by_admin_id=r.approved_by_admin_id,
            token_expires_at=r.token_expires_at,
        )
        for r in rows
    ]


@router.post("/recovery/requests/{request_id}/approve", response_model=schemas.VaultRecoveryApproveResponse)
def approve_recovery_request(
    request_id: int,
    request: Request,
    admin=Depends(require_admin_account),
    db: Session = Depends(get_db),
):
    row = (
        db.query(models.VaultRecoveryRequest)
        .filter(
            models.VaultRecoveryRequest.id == request_id,
            models.VaultRecoveryRequest.organization_id == admin.organization_id,
        )
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail={"msg": "Recovery request not found"})
    if row.status not in {"pending", "approved"}:
        raise HTTPException(status_code=400, detail={"msg": f"Cannot approve request in status {row.status}"})

    one_time_token = secrets.token_urlsafe(32)
    token_hash = _sha256_hex(one_time_token)
    expires_at = _utcnow() + timedelta(minutes=15)

    row.status = "approved"
    row.recovery_token_hash = token_hash
    row.token_expires_at = expires_at
    row.approved_by_admin_id = admin.id
    row.approved_at = _utcnow()

    scope = {
        "organization_id": int(admin.organization_id),
        "actor_admin_id": int(admin.id),
        "actor_user_id": None,
        "actor_role": "admin",
        "actor_name": admin.full_name,
    }
    _write_vault_audit(
        db,
        scope=scope,
        action="vault_recovery_approved",
        details={"request_id": request_id, "expires_at": expires_at.isoformat()},
        request=request,
    )
    db.commit()

    return schemas.VaultRecoveryApproveResponse(
        request_id=request_id,
        one_time_token=one_time_token,
        token_expires_at=expires_at,
    )


@router.post("/recovery/consume", response_model=schemas.VaultRecoveryConsumeOut)
def consume_recovery_token(
    payload: schemas.VaultRecoveryConsumeIn,
    request: Request,
    current_user=Depends(_get_current_user),
    db: Session = Depends(get_db),
):
    scope = _resolve_scope(db, current_user)
    row = (
        db.query(models.VaultRecoveryRequest)
        .filter(
            models.VaultRecoveryRequest.id == payload.request_id,
            models.VaultRecoveryRequest.organization_id == scope["organization_id"],
        )
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail={"msg": "Recovery request not found"})
    if row.status != "approved":
        raise HTTPException(status_code=400, detail={"msg": "Recovery request not approved"})
    if row.token_expires_at and _utcnow() > row.token_expires_at:
        row.status = "expired"
        db.commit()
        raise HTTPException(status_code=400, detail={"msg": "Recovery token expired"})
    if row.recovery_token_hash != _sha256_hex(payload.one_time_token):
        raise HTTPException(status_code=401, detail={"msg": "Invalid recovery token"})

    is_request_owner = (
        (row.requester_user_id and row.requester_user_id == scope["requester_user_id"])
        or (row.requester_admin_id and row.requester_admin_id == scope["requester_admin_id"])
    )
    if not is_request_owner:
        raise HTTPException(status_code=403, detail={"msg": "This recovery token is not assigned to your account"})

    envelope = (
        db.query(models.VaultKeyEnvelope)
        .filter(
            models.VaultKeyEnvelope.organization_id == scope["organization_id"],
            models.VaultKeyEnvelope.owner_user_id == scope["owner_user_id"],
            models.VaultKeyEnvelope.owner_admin_id == scope["owner_admin_id"],
            models.VaultKeyEnvelope.is_active == True,  # noqa: E712
        )
        .first()
    )
    if not envelope or not envelope.escrow_dek_ciphertext or not envelope.escrow_nonce:
        raise HTTPException(status_code=404, detail={"msg": "Escrow DEK not available for this account"})

    dek_b64 = _escrow_decrypt_dek(envelope.escrow_dek_ciphertext, envelope.escrow_nonce)

    row.status = "completed"
    row.token_used_at = _utcnow()
    row.completed_at = _utcnow()

    _write_vault_audit(
        db,
        scope=scope,
        action="vault_recovery_consumed",
        details={"request_id": row.id},
        request=request,
    )
    db.commit()

    return schemas.VaultRecoveryConsumeOut(
        key_id=envelope.key_id,
        dek_b64=dek_b64,
        token_consumed=True,
    )


@router.get("/retention", response_model=schemas.VaultRetentionPolicyOut)
def get_vault_retention_policy(
    current_user=Depends(_get_current_user),
    db: Session = Depends(get_db),
):
    scope = _resolve_scope(db, current_user)
    policy = _get_or_create_retention_policy(db, scope["organization_id"])
    db.commit()
    db.refresh(policy)
    return schemas.VaultRetentionPolicyOut(
        max_days=policy.max_days,
        max_storage_mb=policy.max_storage_mb,
        auto_delete_enabled=policy.auto_delete_enabled,
        updated_at=policy.updated_at,
        updated_by_admin_id=policy.updated_by_admin_id,
    )


@router.put("/retention", response_model=schemas.VaultRetentionPolicyOut)
def upsert_vault_retention_policy(
    payload: schemas.VaultRetentionPolicyUpdate,
    request: Request,
    admin=Depends(require_admin_account),
    db: Session = Depends(get_db),
):
    policy = _get_or_create_retention_policy(db, int(admin.organization_id))
    policy.max_days = payload.max_days
    policy.max_storage_mb = payload.max_storage_mb
    policy.auto_delete_enabled = payload.auto_delete_enabled
    policy.updated_by_admin_id = int(admin.id)

    scope = {
        "organization_id": int(admin.organization_id),
        "actor_admin_id": int(admin.id),
        "actor_user_id": None,
        "actor_role": "admin",
        "actor_name": admin.full_name,
    }
    _write_vault_audit(
        db,
        scope=scope,
        action="vault_retention_updated",
        details={
            "max_days": payload.max_days,
            "max_storage_mb": payload.max_storage_mb,
            "auto_delete_enabled": payload.auto_delete_enabled,
        },
        request=request,
    )
    db.commit()
    db.refresh(policy)
    return schemas.VaultRetentionPolicyOut(
        max_days=policy.max_days,
        max_storage_mb=policy.max_storage_mb,
        auto_delete_enabled=policy.auto_delete_enabled,
        updated_at=policy.updated_at,
        updated_by_admin_id=policy.updated_by_admin_id,
    )


@router.get("/ai-access", response_model=schemas.VaultAiAccessPolicyOut)
def get_ai_access_policy(
    admin=Depends(require_admin_account),
    db: Session = Depends(get_db),
):
    policy = _get_or_create_ai_access_policy(db, int(admin.organization_id))
    db.commit()
    db.refresh(policy)
    return schemas.VaultAiAccessPolicyOut(
        enabled=bool(policy.enabled),
        allowed_camera_ids=_normalize_int_list(json.loads(policy.allowed_camera_ids) if policy.allowed_camera_ids else []),
        allowed_resident_ids=_normalize_int_list(
            json.loads(policy.allowed_resident_ids) if policy.allowed_resident_ids else []
        ),
        allow_summary_generation=bool(policy.allow_summary_generation),
        has_secret=bool(policy.secret_ciphertext and policy.secret_nonce),
        updated_at=policy.updated_at,
        updated_by_admin_id=policy.updated_by_admin_id,
    )


@router.put("/ai-access", response_model=schemas.VaultAiAccessPolicyOut)
def upsert_ai_access_policy(
    payload: schemas.VaultAiAccessPolicyUpdate,
    request: Request,
    admin=Depends(require_admin_account),
    db: Session = Depends(get_db),
):
    policy = _get_or_create_ai_access_policy(db, int(admin.organization_id))
    cameras = _normalize_int_list(payload.allowed_camera_ids)
    residents = _normalize_int_list(payload.allowed_resident_ids)
    policy.enabled = bool(payload.enabled)
    policy.allowed_camera_ids = json.dumps(cameras, ensure_ascii=True)
    policy.allowed_resident_ids = json.dumps(residents, ensure_ascii=True)
    policy.allow_summary_generation = bool(payload.allow_summary_generation)
    policy.updated_by_admin_id = int(admin.id)

    scope = {
        "organization_id": int(admin.organization_id),
        "actor_admin_id": int(admin.id),
        "actor_user_id": None,
        "actor_role": "admin",
        "actor_name": admin.full_name,
    }
    _write_vault_audit(
        db,
        scope=scope,
        action="vault_ai_access_policy_updated",
        details={
            "enabled": bool(payload.enabled),
            "camera_count": len(cameras),
            "resident_count": len(residents),
            "allow_summary_generation": bool(payload.allow_summary_generation),
        },
        request=request,
    )
    db.commit()
    db.refresh(policy)
    return schemas.VaultAiAccessPolicyOut(
        enabled=bool(policy.enabled),
        allowed_camera_ids=cameras,
        allowed_resident_ids=residents,
        allow_summary_generation=bool(policy.allow_summary_generation),
        has_secret=bool(policy.secret_ciphertext and policy.secret_nonce),
        updated_at=policy.updated_at,
        updated_by_admin_id=policy.updated_by_admin_id,
    )


@router.put("/ai-access/secret", response_model=schemas.VaultAiAccessSecretOut)
def upsert_ai_access_secret(
    payload: schemas.VaultAiAccessSecretUpsert,
    request: Request,
    admin=Depends(require_admin_account),
    db: Session = Depends(get_db),
):
    policy = _get_or_create_ai_access_policy(db, int(admin.organization_id))
    ciphertext, nonce = _enc_ai_passphrase(payload.ai_passphrase)
    policy.secret_ciphertext = ciphertext
    policy.secret_nonce = nonce
    policy.updated_by_admin_id = int(admin.id)
    scope = {
        "organization_id": int(admin.organization_id),
        "actor_admin_id": int(admin.id),
        "actor_user_id": None,
        "actor_role": "admin",
        "actor_name": admin.full_name,
    }
    _write_vault_audit(
        db,
        scope=scope,
        action="vault_ai_access_secret_upsert",
        details={"has_secret": True},
        request=request,
    )
    db.commit()
    return schemas.VaultAiAccessSecretOut(ok=True, has_secret=True)


@router.post("/audit/events")
def create_vault_audit_event(
    payload: schemas.VaultAuditEventIn,
    request: Request,
    current_user=Depends(_get_current_user),
    db: Session = Depends(get_db),
):
    scope = _resolve_scope(db, current_user)
    _write_vault_audit(
        db,
        scope=scope,
        action=payload.action,
        details=payload.details,
        request=request,
    )
    db.commit()
    return {"ok": True}


@router.get("/audit/events", response_model=list[schemas.VaultAuditEventOut])
def list_vault_audit_events(
    limit: int = Query(default=100, ge=1, le=500),
    admin=Depends(require_admin_account),
    db: Session = Depends(get_db),
):
    rows = (
        db.query(models.AuditLog)
        .filter(
            models.AuditLog.organization_id == admin.organization_id,
            models.AuditLog.entity_type == "vault_security",
        )
        .order_by(models.AuditLog.created_at.desc())
        .limit(limit)
        .all()
    )
    return [
        schemas.VaultAuditEventOut(
            id=int(r.id),
            action=r.action,
            actor_role=r.actor_role,
            actor_name=r.actor_name,
            created_at=r.created_at,
            details=r.new_values if isinstance(r.new_values, dict) else None,
        )
        for r in rows
    ]
