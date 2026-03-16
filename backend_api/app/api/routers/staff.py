from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import Optional

from app.api.deps import get_db
from app import models, schemas

router = APIRouter(prefix="/staff", tags=["Staff"])


@router.get("/", response_model=list[schemas.StaffResponse])
def get_all_staff(
    unit: Optional[str] = None,
    status: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """
    Get all staff members.
    Optional filters:
      - unit: filter by assigned_unit (e.g. "ICU Ward")
      - status: filter by status (active | on_leave | pending)
    """
    from sqlalchemy.orm import joinedload
    query = db.query(models.Staff).options(joinedload(models.Staff.user))
    if unit:
        query = query.filter(models.Staff.assigned_unit == unit)
    if status:
        query = query.filter(models.Staff.status == status)
    staff_list = query.all()
    # Sync full_name from linked user if available
    for s in staff_list:
        if s.user and s.user.full_name:
            s.full_name = s.user.full_name
    return staff_list


@router.get("/{staff_id}", response_model=schemas.StaffResponse)
def get_staff_member(staff_id: str, db: Session = Depends(get_db)):
    """Get a single staff member by their staff_id (e.g. ID-ST-4920)."""
    member = db.query(models.Staff).filter(models.Staff.staff_id == staff_id).first()
    if not member:
        raise HTTPException(status_code=404, detail="Staff member not found.")
    return member


@router.post("/", response_model=schemas.StaffResponse, status_code=status.HTTP_201_CREATED)
def create_staff(staff_in: schemas.StaffCreate, db: Session = Depends(get_db)):
    """Create a new staff member."""
    existing = db.query(models.Staff).filter(models.Staff.staff_id == staff_in.staff_id).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Staff ID '{staff_in.staff_id}' already exists.",
        )
    member = models.Staff(**staff_in.model_dump())
    db.add(member)
    db.commit()
    db.refresh(member)
    return member


@router.patch("/{staff_id}", response_model=schemas.StaffResponse)
def update_staff(staff_id: str, updates: schemas.StaffUpdate, db: Session = Depends(get_db)):
    """
    Partially update a staff member.
    Updatable fields: shift_time, assigned_unit, status, role.
    """
    member = db.query(models.Staff).filter(models.Staff.staff_id == staff_id).first()
    if not member:
        raise HTTPException(status_code=404, detail="Staff member not found.")

    for field, value in updates.model_dump(exclude_none=True).items():
        setattr(member, field, value)

    db.commit()
    db.refresh(member)
    return member


@router.delete("/{staff_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_staff(staff_id: str, db: Session = Depends(get_db)):
    """Delete a staff member by staff_id."""
    member = db.query(models.Staff).filter(models.Staff.staff_id == staff_id).first()
    if not member:
        raise HTTPException(status_code=404, detail="Staff member not found.")
    db.delete(member)
    db.commit()

# STATS  (Admin Console quick stats panel)
@router.get("/stats/summary")
def get_staff_stats(db: Session = Depends(get_db)):
    """
    Quick stats for the Admin Console right-hand panel.
    Returns active_staff, on_leave, pending, shifts_today, pending_tasks.
    """
    from sqlalchemy import func
    total    = db.query(func.count(models.Staff.id)).scalar() or 0
    active   = db.query(func.count(models.Staff.id)).filter(models.Staff.status == "active").scalar() or 0
    on_leave = db.query(func.count(models.Staff.id)).filter(models.Staff.status == "on_leave").scalar() or 0
    pending  = db.query(func.count(models.Staff.id)).filter(models.Staff.status == "pending").scalar() or 0

    return {
        "total_staff":   total,
        "active_staff":  active,
        "on_leave":      on_leave,
        "pending":       pending,
        "shifts_today":  total,
        "pending_tasks": 8,   # placeholder — wire to a Tasks table when ready
    }
