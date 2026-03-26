from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import Optional

from backend.api.deps import get_db
from backend.api.rbac import require_admin_account, resolve_staff_admin_scope_id
from backend import models, schemas

router = APIRouter(tags=["Staff"])


def _staff_base_query(db: Session, scoped_admin_id: int):
    return (
        db.query(models.Staff)
        .filter(
            models.Staff.admin_id == scoped_admin_id,
            models.Staff.is_deleted == False,  # noqa: E712
        )
    )


@router.get("/", response_model=list[schemas.StaffResponse])
def get_all_staff(
    unit: Optional[str] = None,
    status: Optional[str] = None,
    scoped_admin_id: int = Depends(resolve_staff_admin_scope_id),
    db: Session = Depends(get_db),
):
    """
    Staff directory for the signed-in user's care center.

    Admins see all staff for their center; approved staff see the same list (read-only in UI).
    """
    from sqlalchemy.orm import joinedload

    query = _staff_base_query(db, scoped_admin_id).options(joinedload(models.Staff.user))
    if unit:
        query = query.filter(models.Staff.assigned_unit == unit)
    if status:
        query = query.filter(models.Staff.status == status)
    staff_list = query.all()
    for s in staff_list:
        if s.user and s.user.full_name:
            s.full_name = s.user.full_name
    return staff_list


@router.get("/stats/summary")
def get_staff_stats(
    scoped_admin_id: int = Depends(resolve_staff_admin_scope_id),
    db: Session = Depends(get_db),
):
    """Headcount stats scoped to the caller's care center."""
    q = _staff_base_query(db, scoped_admin_id)
    total = q.count()
    active = _staff_base_query(db, scoped_admin_id).filter(models.Staff.status == "active").count()
    on_leave = _staff_base_query(db, scoped_admin_id).filter(models.Staff.status == "on_leave").count()
    pending = _staff_base_query(db, scoped_admin_id).filter(models.Staff.status == "pending").count()

    return {
        "total_staff": total,
        "active_staff": active,
        "on_leave": on_leave,
        "pending": pending,
        "shifts_today": total,
        "pending_tasks": 8,
    }


@router.get("/{staff_code}", response_model=schemas.StaffResponse)
def get_staff_member(
    staff_code: str,
    scoped_admin_id: int = Depends(resolve_staff_admin_scope_id),
    db: Session = Depends(get_db),
):
    """Get one staff member in the same center as the caller."""
    member = (
        _staff_base_query(db, scoped_admin_id)
        .filter(models.Staff.staff_code == staff_code)
        .first()
    )
    if not member:
        raise HTTPException(status_code=404, detail="Staff member not found.")
    return member


@router.post("/", response_model=schemas.StaffResponse, status_code=status.HTTP_201_CREATED)
def create_staff(
    staff_in: schemas.StaffCreate,
    _: models.Admin = Depends(require_admin_account),
    db: Session = Depends(get_db),
):
    """Create a staff member (admin only)."""
    existing = db.query(models.Staff).filter(models.Staff.staff_code == staff_in.staff_code).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Staff code '{staff_in.staff_code}' already exists.",
        )
    member = models.Staff(**staff_in.model_dump())
    db.add(member)
    db.commit()
    db.refresh(member)
    return member


@router.patch("/{staff_code}", response_model=schemas.StaffResponse)
def update_staff(
    staff_code: str,
    updates: schemas.StaffUpdate,
    admin: models.Admin = Depends(require_admin_account),
    db: Session = Depends(get_db),
):
    """Update a staff member (admin only)."""
    member = (
        _staff_base_query(db, admin.id).filter(models.Staff.staff_code == staff_code).first()
    )
    if not member:
        raise HTTPException(status_code=404, detail="Staff member not found.")

    for field, value in updates.model_dump(exclude_none=True).items():
        setattr(member, field, value)

    db.commit()
    db.refresh(member)
    return member


@router.delete("/{staff_code}", status_code=status.HTTP_204_NO_CONTENT)
def delete_staff(
    staff_code: str,
    admin: models.Admin = Depends(require_admin_account),
    db: Session = Depends(get_db),
):
    """Delete a staff member (admin only)."""
    member = (
        _staff_base_query(db, admin.id).filter(models.Staff.staff_code == staff_code).first()
    )
    if not member:
        raise HTTPException(status_code=404, detail="Staff member not found.")
    db.delete(member)
    db.commit()
