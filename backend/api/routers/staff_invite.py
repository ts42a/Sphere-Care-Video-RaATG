"""
POST /api/v1/staff/invite
Admin invites a web-registered staff user to their centre by Account ID (unique_code).
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
import uuid

from backend.api.deps import get_db
from backend.api.rbac import require_admin_account
from backend import models, schemas

router = APIRouter(tags=["Staff"])


class StaffInviteRequest(BaseModel):
    account_id: str  # e.g. "ACC-47291038"


def _parse_account_id(account_id: str, db: Session) -> int:
    """Resolve an Account ID string to a users.id."""
    raw = (account_id or "").strip().upper()
    # Strip ACC- prefix if present
    code = raw.lstrip("ACC-") if raw.startswith("ACC-") else raw
    user = (
        db.query(models.User)
        .filter(models.User.unique_code == raw)
        .first()
    ) or (
        db.query(models.User)
        .filter(models.User.unique_code == code)
        .first()
    )
    if not user:
        raise HTTPException(status_code=404, detail="No account found with that Account ID.")
    return user.id


@router.post("/staff/invite", response_model=schemas.StaffResponse)
def invite_staff_by_account_id(
    payload: StaffInviteRequest,
    admin: models.Admin = Depends(require_admin_account),
    db: Session = Depends(get_db),
):
    """
    Link a web-registered staff user to this admin's centre.
    Looks up by unique_code (Account ID), creates a Staff row if not already present.
    """
    user_id = _parse_account_id(payload.account_id, db)

    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="No account found with that Account ID.")

    # Must be a staff-role user (not client/admin)
    if user.global_role not in ("staff", "nurse", "doctor", "carer", "external_doctor"):
        raise HTTPException(
            status_code=400,
            detail="That account is not a staff account. Only staff users can be added here."
        )

    # Check not already added to this centre
    existing = (
        db.query(models.Staff)
        .filter(
            models.Staff.user_id == user.id,
            models.Staff.admin_id == admin.id,
            models.Staff.is_deleted == False,  # noqa: E712
        )
        .first()
    )
    if existing:
        raise HTTPException(status_code=409, detail="This staff member is already in your centre.")

    # Generate unique staff_code
    staff_code = "STF-" + str(uuid.uuid4().int)[:8]

    staff = models.Staff(
        admin_id=admin.id,
        user_id=user.id,
        staff_code=staff_code,
        full_name=user.full_name,
        role=user.global_role or "staff",
        assigned_unit="General",
        status="active",
        approval_status="approved",
    )
    db.add(staff)
    db.commit()
    db.refresh(staff)
    return staff