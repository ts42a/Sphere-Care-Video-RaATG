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
    query = db.query(models.Staff)
    if unit:
        query = query.filter(models.Staff.assigned_unit == unit)
    if status:
        query = query.filter(models.Staff.status == status)
    return query.all()


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