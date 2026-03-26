"""
Role checks for API routes (admin vs staff vs other).
"""
from __future__ import annotations

from fastapi import Depends, HTTPException
from sqlalchemy.orm import Session

from backend import models
from backend.api.deps import get_db
from backend.api.routers.auth import _get_current_user


def require_admin_account(
    current_user=Depends(_get_current_user),
) -> models.Admin:
    """Staff portal admins authenticate as rows in ``admins`` (not ``users``)."""
    if isinstance(current_user, models.Admin):
        return current_user
    raise HTTPException(status_code=403, detail={"msg": "Admin access required"})


def resolve_staff_admin_scope_id(
    current_user=Depends(_get_current_user),
    db: Session = Depends(get_db),
) -> int:
    """
    ``admins.id`` used to scope Staff rows.

    - Admin users: their own ``admins.id``.
    - Staff users: ``Staff.admin_id`` for their linked ``Staff`` row.
    """
    if isinstance(current_user, models.Admin):
        return int(current_user.id)

    role = getattr(current_user, "global_role", None)
    if role == "staff":
        row = (
            db.query(models.Staff)
            .filter(
                models.Staff.user_id == current_user.id,
                models.Staff.is_deleted == False,  # noqa: E712
            )
            .first()
        )
        if not row:
            raise HTTPException(status_code=403, detail={"msg": "Staff profile not found"})
        if row.approval_status != "approved":
            raise HTTPException(
                status_code=403,
                detail={"msg": "Your account is pending admin approval"},
            )
        return int(row.admin_id)

    raise HTTPException(status_code=403, detail={"msg": "Not authorized for this resource"})
