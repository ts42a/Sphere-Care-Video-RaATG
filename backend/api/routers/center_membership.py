import re
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from backend import models, schemas
from backend.api.deps import get_db
from backend.api.routers.auth import _get_current_user, verify_password
from backend.utils.id_generator import generate_unique_id


router = APIRouter(prefix="/center-membership", tags=["Center Membership"])


def _normalize_center_id(center_id: str, db: Session = None) -> int:
    """Resolve center code to organization_id."""
    raw = str(center_id or "").strip()
    if not raw:
        raise HTTPException(status_code=400, detail={"msg": "Center ID is required"})

    code = raw.upper()
    m_ctr = re.fullmatch(r"CTR-(\w+)", code, re.IGNORECASE)
    m_adm = re.fullmatch(r"ADM-(\w+)", code, re.IGNORECASE)
    if m_ctr:
        code = m_ctr.group(1)
    elif m_adm:
        code = m_adm.group(1)

    # Look up by Organization unique_code
    if db is not None:
        org = db.query(models.Organization).filter(models.Organization.unique_code == code).first()
        if org:
            return org.id
        admin_row = db.query(models.Admin).filter(models.Admin.unique_code == code).first()
        if admin_row:
            return admin_row.organization_id

    # Fallback: numeric organization.id (legacy)
    if code.isdigit():
        return int(code)

    raise HTTPException(status_code=400, detail={"msg": "Invalid Center ID. Use CTR-<code> format."})


def _resolve_admin_id(current_user) -> Optional[int]:
    """Return admin.id if the user is an admin."""
    role = getattr(current_user, "global_role", None) or getattr(current_user, "role", None)
    if role == "admin":
        return int(current_user.id)
    return getattr(current_user, "admin_id", None)


def _resolve_organization_id(current_user, db: Session) -> Optional[int]:
    """Return the organization_id for the current admin user."""
    admin_id = _resolve_admin_id(current_user)
    if not admin_id:
        return None
    admin = db.query(models.Admin).filter(models.Admin.id == admin_id).first()
    return admin.organization_id if admin else None


def _create_resident_for_client(admin_id: int, client: models.User, db: Session = None) -> None:
    """Create a Resident record in the database for the approved client."""
    if db is None:
        return
    try:
        # Check if a resident already exists for this client
        existing = db.query(models.Resident).filter(
            models.Resident.client_user_id == client.id
        ).first()
        if existing:
            return

        resident_code = generate_unique_id(db, models.Resident, "unique_code")
        resident = models.Resident(
            unique_code=resident_code,
            admin_id=admin_id,
            client_user_id=client.id,
            full_name=client.full_name,
            age=0,
            room="Unassigned",
            status="active",
        )
        db.add(resident)
        db.commit()
    except Exception:
        pass  # Non-critical — admin can create manually


def _build_request_response(db: Session, req: models.CenterJoinRequest) -> schemas.CenterJoinRequestResponse:
    client = db.query(models.User).filter(models.User.id == req.user_id).first()
    org = db.query(models.Organization).filter(models.Organization.id == req.organization_id).first()

    return schemas.CenterJoinRequestResponse(
        id=req.id,
        user_id=req.user_id,
        user_email=client.email if client else "",
        user_full_name=client.full_name if client else "",
        organization_id=req.organization_id,
        center_code=f"CTR-{org.unique_code}" if org else "",
        center_name=org.organization_name if org else "",
        membership_role=getattr(req, "membership_role", "client") or "client",
        status=req.status,
        initiated_by=getattr(req, "initiated_by", "user") or "user",
        request_message=req.request_message,
        rejection_reason=req.rejection_reason,
        requested_at=req.requested_at,
        reviewed_at=req.reviewed_at,
        approved_at=req.approved_at,
        left_at=req.left_at,
    )


@router.post("/request", response_model=schemas.CenterJoinRequestResponse)
def request_join_center(
    payload: schemas.CenterJoinRequestCreate,
    current_user: models.User = Depends(_get_current_user),
    db: Session = Depends(get_db),
):
    if getattr(current_user, "global_role", None) != "client":
        raise HTTPException(status_code=403, detail={"msg": "Only client accounts can request center membership"})

    target_org_id = _normalize_center_id(payload.center_id, db)

    center = db.query(models.Organization).filter(models.Organization.id == target_org_id).first()
    if not center:
        raise HTTPException(status_code=404, detail={"msg": "Center not found"})

    # Block if already a member of ANY center
    active_membership = db.query(models.CenterMembership).filter(
        models.CenterMembership.user_id == current_user.id,
        models.CenterMembership.status == "approved",
    ).first()
    if active_membership:
        raise HTTPException(status_code=400, detail={"msg": "You are already a member of a center. Leave your current center before joining a new one."})

    existing_pending = db.query(models.CenterJoinRequest).filter(
        models.CenterJoinRequest.user_id == current_user.id,
        models.CenterJoinRequest.status == "pending",
    ).first()
    if existing_pending:
        raise HTTPException(status_code=409, detail={"msg": "You already have a pending join request"})

    join_request = models.CenterJoinRequest(
        user_id=current_user.id,
        organization_id=target_org_id,
        membership_role="client",
        status="pending",
        initiated_by="user",
        request_message=payload.message,
    )
    db.add(join_request)

    db.commit()
    db.refresh(join_request)

    return _build_request_response(db, join_request)


@router.get("/me", response_model=schemas.CenterMembershipStatusResponse)
def get_my_center_membership(
    current_user: models.User = Depends(_get_current_user),
    db: Session = Depends(get_db),
):
    # Look up active membership from CenterMembership table
    active = db.query(models.CenterMembership).filter(
        models.CenterMembership.user_id == current_user.id,
        models.CenterMembership.status == "approved",
    ).first()

    joined_org_id = active.organization_id if active else None
    membership_status = active.status if active else "none"

    joined_center = None
    if joined_org_id:
        joined_center = db.query(models.Organization).filter(models.Organization.id == joined_org_id).first()

    pending = db.query(models.CenterJoinRequest).filter(
        models.CenterJoinRequest.user_id == current_user.id,
        models.CenterJoinRequest.status == "pending",
    ).order_by(models.CenterJoinRequest.requested_at.desc()).first()

    latest = db.query(models.CenterJoinRequest).filter(
        models.CenterJoinRequest.user_id == current_user.id,
    ).order_by(models.CenterJoinRequest.requested_at.desc()).first()

    return schemas.CenterMembershipStatusResponse(
        is_member=bool(joined_org_id and membership_status == "approved"),
        membership_status=membership_status,
        joined_center_organization_id=joined_org_id,
        joined_center_code=f"CTR-{joined_center.unique_code}" if joined_center else None,
        joined_center_name=joined_center.organization_name if joined_center else None,
        pending_request=_build_request_response(db, pending) if pending else None,
        latest_request=_build_request_response(db, latest) if latest else None,
    )


@router.post("/leave")
def leave_center(
    payload: schemas.LeaveCenterRequest,
    current_user: models.User = Depends(_get_current_user),
    db: Session = Depends(get_db),
):
    if getattr(current_user, "global_role", None) != "client":
        raise HTTPException(status_code=403, detail={"msg": "Only client accounts can leave a center"})

    # Look up active membership from CenterMembership table
    active_cm = db.query(models.CenterMembership).filter(
        models.CenterMembership.user_id == current_user.id,
        models.CenterMembership.status == "approved",
    ).first()
    if not active_cm:
        raise HTTPException(status_code=400, detail={"msg": "You are not part of any center"})

    joined_org_id = active_cm.organization_id

    # Verify password before allowing leave
    if not verify_password(payload.password, current_user.password_hash):
        raise HTTPException(status_code=401, detail={"msg": "Incorrect password"})

    active_membership = db.query(models.CenterJoinRequest).filter(
        models.CenterJoinRequest.user_id == current_user.id,
        models.CenterJoinRequest.organization_id == joined_org_id,
        models.CenterJoinRequest.status == "approved",
    ).order_by(models.CenterJoinRequest.approved_at.desc()).first()

    if active_membership:
        active_membership.status = "left"
        active_membership.left_at = datetime.utcnow()
        active_membership.reviewed_at = datetime.utcnow()

    # Keep resident record but mark center access as denied after leaving.
    # Find admins in this org to match admin_id on residents
    org_admin_ids = [
        a.id for a in db.query(models.Admin).filter(
            models.Admin.organization_id == joined_org_id
        ).all()
    ]
    try:
        resident = db.query(models.Resident).filter(
            models.Resident.admin_id.in_(org_admin_ids),
            models.Resident.client_user_id == current_user.id,
        ).first()
        if resident:
            resident.status = "archived"
    except Exception:
        pass

    # End the CenterMembership
    active_cm.status = "left"
    active_cm.ended_at = datetime.utcnow()
    db.commit()

    return {"success": True, "msg": "You have left the center"}


@router.get("/admin/requests", response_model=list[schemas.CenterJoinRequestResponse])
def list_join_requests_for_admin(
    status: str = Query("pending", pattern="^(pending|approved|rejected|left)$"),
    current_user=Depends(_get_current_user),
    db: Session = Depends(get_db),
):
    admin_id = _resolve_admin_id(current_user)
    if not admin_id:
        raise HTTPException(status_code=403, detail={"msg": "Admin authorization required"})

    org_id = _resolve_organization_id(current_user, db)
    if not org_id:
        raise HTTPException(status_code=403, detail={"msg": "Admin has no associated organization"})

    requests = db.query(models.CenterJoinRequest).filter(
        models.CenterJoinRequest.organization_id == org_id,
        models.CenterJoinRequest.status == status,
    ).order_by(models.CenterJoinRequest.requested_at.desc()).all()

    return [_build_request_response(db, req) for req in requests]


@router.post("/admin/requests/{request_id}/approve", response_model=schemas.CenterJoinRequestResponse)
def approve_join_request(
    request_id: int,
    current_user=Depends(_get_current_user),
    db: Session = Depends(get_db),
):
    admin_id = _resolve_admin_id(current_user)
    if not admin_id:
        raise HTTPException(status_code=403, detail={"msg": "Admin authorization required"})

    org_id = _resolve_organization_id(current_user, db)

    req = db.query(models.CenterJoinRequest).filter(
        models.CenterJoinRequest.id == request_id,
        models.CenterJoinRequest.organization_id == org_id,
    ).first()

    if not req:
        raise HTTPException(status_code=404, detail={"msg": "Join request not found"})

    if req.status != "pending":
        raise HTTPException(status_code=400, detail={"msg": f"Cannot approve request in status '{req.status}'"})

    client = db.query(models.User).filter(models.User.id == req.user_id).first()
    if not client:
        raise HTTPException(status_code=404, detail={"msg": "Client account not found"})

    req.status = "approved"
    req.approved_at = datetime.utcnow()
    req.reviewed_at = datetime.utcnow()
    req.reviewed_by_admin_id = admin_id

    # Create or update CenterMembership
    cm = db.query(models.CenterMembership).filter(
        models.CenterMembership.user_id == client.id,
        models.CenterMembership.organization_id == org_id,
    ).first()
    if cm:
        cm.status = "approved"
        cm.approved_at = datetime.utcnow()
    else:
        cm = models.CenterMembership(
            user_id=client.id,
            organization_id=org_id,
            membership_role="client",
            status="approved",
            approved_at=datetime.utcnow(),
        )
        db.add(cm)

    # Auto-close other pending requests for this client.
    other_pending = db.query(models.CenterJoinRequest).filter(
        models.CenterJoinRequest.user_id == client.id,
        models.CenterJoinRequest.status == "pending",
        models.CenterJoinRequest.id != req.id,
    ).all()
    for p in other_pending:
        p.status = "rejected"
        p.rejection_reason = "Automatically rejected because another center approved your request"
        p.reviewed_at = datetime.utcnow()

    db.commit()
    db.refresh(req)

    # Auto-create Resident in database
    _create_resident_for_client(admin_id, client, db)

    return _build_request_response(db, req)


@router.post("/admin/requests/{request_id}/reject", response_model=schemas.CenterJoinRequestResponse)
def reject_join_request(
    request_id: int,
    payload: schemas.CenterJoinRequestReview,
    current_user=Depends(_get_current_user),
    db: Session = Depends(get_db),
):
    admin_id = _resolve_admin_id(current_user)
    if not admin_id:
        raise HTTPException(status_code=403, detail={"msg": "Admin authorization required"})

    org_id = _resolve_organization_id(current_user, db)

    req = db.query(models.CenterJoinRequest).filter(
        models.CenterJoinRequest.id == request_id,
        models.CenterJoinRequest.organization_id == org_id,
    ).first()

    if not req:
        raise HTTPException(status_code=404, detail={"msg": "Join request not found"})

    if req.status != "pending":
        raise HTTPException(status_code=400, detail={"msg": f"Cannot reject request in status '{req.status}'"})

    req.status = "rejected"
    req.rejection_reason = payload.reason
    req.reviewed_at = datetime.utcnow()
    req.reviewed_by_admin_id = admin_id

    client = db.query(models.User).filter(models.User.id == req.user_id).first()
    if client:
        # Check if client has no active membership
        has_membership = db.query(models.CenterMembership).filter(
            models.CenterMembership.user_id == client.id,
            models.CenterMembership.status == "approved",
        ).first()
        # No additional action needed since membership is managed via CenterMembership table

    db.commit()
    db.refresh(req)

    return _build_request_response(db, req)


# ──────────────────────────────────────────────
# Admin-initiated invitation (Add New Resident)
# ──────────────────────────────────────────────

def _parse_account_id(raw: str, db: Session = None) -> int:
    """Parse ACC-<code> to find client user by unique_code."""
    raw = raw.strip()
    match = re.fullmatch(r"ACC-(\w+)", raw, re.IGNORECASE)
    code = match.group(1) if match else raw

    # Look up by unique_code
    if db is not None:
        user = db.query(models.User).filter(
            models.User.unique_code == code,
            models.User.global_role == "client",
        ).first()
        if user:
            return user.id

    # Fallback: numeric user.id (legacy)
    if code.isdigit():
        return int(code)

    raise HTTPException(status_code=400, detail={"msg": "Invalid Account ID format. Use ACC-<code>."})


def _ensure_resident_conversation_for_client(
    *,
    db: Session,
    admin_id: int,
    client: models.User,
) -> None:
    """Ensure the approved client is included in their Resident Care conversation.

    Admin may create the conversation before the client accepts the invitation.
    In that case the conversation can exist with only staff/admin participants,
    so the client will not receive realtime messages. This helper links the
    client after approval and also creates the conversation when it is missing.
    """
    if not admin_id or not client:
        return

    client_name = client.full_name or client.email or f"Client #{client.id}"
    conv_name = f"Resident Care: {client_name}"

    conversation = db.query(models.Conversation).filter(
        models.Conversation.admin_id == admin_id,
        models.Conversation.category == "resident",
        models.Conversation.name == conv_name,
    ).first()

    if not conversation:
        conversation = models.Conversation(
            admin_id=admin_id,
            name=conv_name,
            category="resident",
            created_by=admin_id,
            unread_count=0,
        )
        db.add(conversation)
        db.flush()

    # The mobile WS actor key is always user:<user_id> for client accounts.
    # Do not use participant_type="client", otherwise delivery targets
    # client:<id> while the phone is connected as user:<id>.
    exists = db.query(models.ConversationParticipant).filter(
        models.ConversationParticipant.conversation_id == conversation.id,
        models.ConversationParticipant.user_id == client.id,
        models.ConversationParticipant.participant_type == "user",
    ).first()

    if exists:
        if not exists.display_name:
            exists.display_name = client_name
        if not exists.role:
            exists.role = "client"
    else:
        db.add(models.ConversationParticipant(
            conversation_id=conversation.id,
            user_id=client.id,
            participant_type="user",
            display_name=client_name,
            role="client",
        ))

    # Also make sure the owning admin is a participant so the conversation
    # remains visible and deliverable to admin-side sockets.
    admin = db.query(models.Admin).filter(models.Admin.id == admin_id).first()
    if admin:
        admin_exists = db.query(models.ConversationParticipant).filter(
            models.ConversationParticipant.conversation_id == conversation.id,
            models.ConversationParticipant.user_id == admin.id,
            models.ConversationParticipant.participant_type == "admin",
        ).first()
        if not admin_exists:
            db.add(models.ConversationParticipant(
                conversation_id=conversation.id,
                user_id=admin.id,
                participant_type="admin",
                display_name=admin.full_name or "Admin",
                role="admin",
            ))

    db.flush()


@router.post("/admin/invite", response_model=schemas.CenterJoinRequestResponse)
def admin_invite_client(
    payload: schemas.AdminInvitePayload,
    current_user=Depends(_get_current_user),
    db: Session = Depends(get_db),
):
    """Admin sends a center-join invitation to a client by Account ID."""
    admin_id = _resolve_admin_id(current_user)
    if not admin_id:
        raise HTTPException(status_code=403, detail={"msg": "Admin authorization required"})

    org_id = _resolve_organization_id(current_user, db)
    if not org_id:
        raise HTTPException(status_code=403, detail={"msg": "Admin has no associated organization"})

    client_user_id = _parse_account_id(payload.account_id, db)

    client = db.query(models.User).filter(
        models.User.id == client_user_id,
        models.User.global_role == "client",
    ).first()
    if not client:
        raise HTTPException(status_code=404, detail={"msg": "No client account found with that Account ID"})

    # Check if already a member via CenterMembership table
    active_cm = db.query(models.CenterMembership).filter(
        models.CenterMembership.user_id == client.id,
        models.CenterMembership.status == "approved",
    ).first()
    if active_cm and active_cm.organization_id != org_id:
        raise HTTPException(status_code=400, detail={"msg": "This client already belongs to another center and must leave it first"})
    if active_cm and active_cm.organization_id == org_id:
        raise HTTPException(status_code=400, detail={"msg": "This client is already a resident in your center"})

    existing = db.query(models.CenterJoinRequest).filter(
        models.CenterJoinRequest.user_id == client_user_id,
        models.CenterJoinRequest.organization_id == org_id,
        models.CenterJoinRequest.status == "pending",
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail={"msg": "An invitation is already pending for this client"})

    invitation = models.CenterJoinRequest(
        user_id=client_user_id,
        organization_id=org_id,
        membership_role="client",
        status="pending",
        initiated_by="admin",
        request_message="You have been invited to join this center.",
    )
    db.add(invitation)
    db.commit()
    db.refresh(invitation)

    # Create or update the Resident Care conversation now so admin can start it,
    # and include the client as a user participant for future realtime delivery.
    _ensure_resident_conversation_for_client(db=db, admin_id=admin_id, client=client)
    db.commit()

    return _build_request_response(db, invitation)


# ──────────────────────────────────────────────
# Client-side: view & respond to invitations
# ──────────────────────────────────────────────

@router.get("/invitations/me", response_model=list[schemas.CenterJoinRequestResponse])
def get_my_invitations(
    current_user: models.User = Depends(_get_current_user),
    db: Session = Depends(get_db),
):
    """Get pending admin-initiated invitations for the current client."""
    invitations = db.query(models.CenterJoinRequest).filter(
        models.CenterJoinRequest.user_id == current_user.id,
        models.CenterJoinRequest.initiated_by == "admin",
        models.CenterJoinRequest.status == "pending",
    ).order_by(models.CenterJoinRequest.requested_at.desc()).all()

    return [_build_request_response(db, inv) for inv in invitations]


@router.post("/invitations/{invitation_id}/accept", response_model=schemas.CenterJoinRequestResponse)
def accept_invitation(
    invitation_id: int,
    current_user: models.User = Depends(_get_current_user),
    db: Session = Depends(get_db),
):
    """Client accepts an admin-initiated invitation to join a center."""
    inv = db.query(models.CenterJoinRequest).filter(
        models.CenterJoinRequest.id == invitation_id,
        models.CenterJoinRequest.user_id == current_user.id,
        models.CenterJoinRequest.initiated_by == "admin",
    ).first()
    if not inv:
        raise HTTPException(status_code=404, detail={"msg": "Invitation not found"})
    if inv.status != "pending":
        raise HTTPException(status_code=400, detail={"msg": f"Invitation is already {inv.status}"})

    # Check if already a member via CenterMembership table
    active_cm = db.query(models.CenterMembership).filter(
        models.CenterMembership.user_id == current_user.id,
        models.CenterMembership.status == "approved",
    ).first()
    if active_cm:
        raise HTTPException(status_code=400, detail={"msg": "Leave your current center before accepting another invitation"})

    inv.status = "approved"
    inv.approved_at = datetime.utcnow()
    inv.reviewed_at = datetime.utcnow()

    # Create CenterMembership
    cm = models.CenterMembership(
        user_id=current_user.id,
        organization_id=inv.organization_id,
        membership_role="client",
        status="approved",
        approved_at=datetime.utcnow(),
    )
    db.add(cm)

    # Auto-close other pending requests/invitations
    other_pending = db.query(models.CenterJoinRequest).filter(
        models.CenterJoinRequest.user_id == current_user.id,
        models.CenterJoinRequest.status == "pending",
        models.CenterJoinRequest.id != inv.id,
    ).all()
    for p in other_pending:
        p.status = "rejected"
        p.rejection_reason = "Automatically closed — another invitation was accepted"
        p.reviewed_at = datetime.utcnow()

    db.commit()
    db.refresh(inv)

    # Auto-create Resident — find an admin for this org to use as admin_id on the resident
    org_admin = db.query(models.Admin).filter(
        models.Admin.organization_id == inv.organization_id,
        models.Admin.is_active == True,
    ).first()
    if org_admin:
        _create_resident_for_client(org_admin.id, current_user, db)
        _ensure_resident_conversation_for_client(db=db, admin_id=org_admin.id, client=current_user)
        db.commit()

    return _build_request_response(db, inv)


@router.post("/invitations/{invitation_id}/reject", response_model=schemas.CenterJoinRequestResponse)
def reject_invitation(
    invitation_id: int,
    current_user: models.User = Depends(_get_current_user),
    db: Session = Depends(get_db),
):
    """Client rejects an admin-initiated invitation."""
    inv = db.query(models.CenterJoinRequest).filter(
        models.CenterJoinRequest.id == invitation_id,
        models.CenterJoinRequest.user_id == current_user.id,
        models.CenterJoinRequest.initiated_by == "admin",
    ).first()
    if not inv:
        raise HTTPException(status_code=404, detail={"msg": "Invitation not found"})
    if inv.status != "pending":
        raise HTTPException(status_code=400, detail={"msg": f"Invitation is already {inv.status}"})

    inv.status = "rejected"
    inv.rejection_reason = "Declined by client"
    inv.reviewed_at = datetime.utcnow()

    db.commit()
    db.refresh(inv)
    return _build_request_response(db, inv)
