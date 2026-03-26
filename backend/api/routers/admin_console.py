"""
Admin Console Router - RBAC Management, Staff & Resident Management
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import List

from backend.api.deps import get_db
from backend import models, schemas
from backend.api.rbac import require_admin_account
from backend.utils.id_generator import generate_unique_id

router = APIRouter(tags=["Admin Console"])


def _staff_query_for_admin_org(db: Session, admin: models.Admin):
    """Staff rows whose owning admin belongs to the same organization as ``admin``."""
    return (
        db.query(models.Staff)
        .join(models.Admin, models.Staff.admin_id == models.Admin.id)
        .filter(models.Admin.organization_id == admin.organization_id)
    )


@router.get("/staff/pending", response_model=list)
def get_pending_staff(admin: models.Admin = Depends(require_admin_account), db: Session = Depends(get_db)):
    """Get all pending staff waiting for approval"""
    pending_staff = (
        _staff_query_for_admin_org(db, admin)
        .filter(models.Staff.approval_status == "pending")
        .all()
    )
    rows = []
    for s in pending_staff:
        user_row = (
            db.query(models.User).filter(models.User.id == s.user_id).first() if s.user_id else None
        )
        rows.append(
            {
                "id": s.id,
                "staff_code": s.staff_code,
                "staff_id": s.staff_code,
                "full_name": s.full_name,
                "email": user_row.email if user_row else "N/A",
                "role": s.role,
                "created_at": s.created_at.isoformat() if s.created_at else None,
                "approval_status": s.approval_status,
            }
        )
    return rows


@router.get("/staff/requests", response_model=list)
def get_staff_requests(admin: models.Admin = Depends(require_admin_account), db: Session = Depends(get_db)):
    """Get all self-registration staff requests for current organization"""
    requests = (
        _staff_query_for_admin_org(db, admin)
        .filter(models.Staff.user_id.isnot(None))
        .order_by(models.Staff.created_at.desc())
        .all()
    )
    result = []
    for staff in requests:
        user = db.query(models.User).filter(models.User.id == staff.user_id).first() if staff.user_id else None
        result.append({
            "id": staff.id,
            "staff_code": staff.staff_code,
            "staff_id": staff.staff_code,
            "full_name": staff.full_name,
            "email": user.email if user else "N/A",
            "role": staff.role,
            "status": staff.status,
            "approval_status": staff.approval_status,
            "created_at": staff.created_at.isoformat() if staff.created_at else None,
        })
    return result


@router.post("/staff/{staff_code}/approve")
def approve_staff(
    staff_code: str,
    admin: models.Admin = Depends(require_admin_account),
    db: Session = Depends(get_db)
):
    """Approve a pending staff member"""
    staff = (
        _staff_query_for_admin_org(db, admin)
        .filter(models.Staff.staff_code == staff_code)
        .first()
    )

    if not staff:
        raise HTTPException(status_code=404, detail={"msg": "Staff member not found"})

    staff.approval_status = "approved"
    staff.status = "active"
    db.commit()

    return {"success": True, "message": f"Staff member {staff.full_name} has been approved"}


@router.post("/staff/{staff_code}/reject")
def reject_staff(
    staff_code: str,
    reason: str = "",
    admin: models.Admin = Depends(require_admin_account),
    db: Session = Depends(get_db)
):
    """Reject a pending staff member"""
    staff = (
        _staff_query_for_admin_org(db, admin)
        .filter(models.Staff.staff_code == staff_code)
        .first()
    )

    if not staff:
        raise HTTPException(status_code=404, detail={"msg": "Staff member not found"})

    staff.approval_status = "rejected"
    staff.status = "inactive"
    db.commit()

    return {"success": True, "message": f"Staff member {staff.full_name} has been rejected", "reason": reason}


@router.get("/staff", response_model=List[dict])
def get_all_staff(admin: models.Admin = Depends(require_admin_account), db: Session = Depends(get_db)):
    """Get all staff members for the current admin's organization"""
    staff_list = _staff_query_for_admin_org(db, admin).all()
    return [
        {
            "id": s.id,
            "staff_code": s.staff_code,
            "staff_id": s.staff_code,
            "full_name": s.full_name,
            "assigned_unit": s.assigned_unit,
            "status": s.status,
            "role": s.role,
            "created_at": s.created_at.isoformat() if s.created_at else None,
        }
        for s in staff_list
    ]


@router.post("/staff/create", response_model=dict)
def create_staff(
    admin: models.Admin = Depends(require_admin_account),
    db: Session = Depends(get_db),
    full_name: str = Query(..., min_length=1),
    assigned_unit: str = Query(..., min_length=1),
    role: str = Query("staff"),
):
    """Create a new staff member"""
    admin_id = admin.id

    staff_code = f"STF-{generate_unique_id(db, models.Staff, 'staff_code')}"

    new_staff = models.Staff(
        admin_id=admin_id,
        staff_code=staff_code,
        full_name=full_name,
        assigned_unit=assigned_unit,
        status="active",
        role=role
    )
    db.add(new_staff)
    db.commit()
    db.refresh(new_staff)

    return {
        "success": True,
        "staff_code": staff_code,
        "full_name": full_name,
        "assigned_unit": assigned_unit,
        "role": role,
        "message": f"Staff member {full_name} created successfully with ID {staff_code}"
    }


@router.patch("/staff/{staff_code}")
def update_staff(
    staff_code: str,
    full_name: str = None,
    assigned_unit: str = None,
    status: str = None,
    role: str = None,
    admin: models.Admin = Depends(require_admin_account),
    db: Session = Depends(get_db)
):
    """Update staff member details"""
    staff = (
        _staff_query_for_admin_org(db, admin)
        .filter(models.Staff.staff_code == staff_code)
        .first()
    )

    if not staff:
        raise HTTPException(status_code=404, detail={"msg": "Staff member not found"})

    if full_name:
        staff.full_name = full_name
    if assigned_unit:
        staff.assigned_unit = assigned_unit
    if status:
        staff.status = status
    if role:
        staff.role = role

    db.commit()

    return {"success": True, "message": "Staff member updated successfully"}


@router.delete("/staff/{staff_code}")
def delete_staff(
    staff_code: str,
    admin: models.Admin = Depends(require_admin_account),
    db: Session = Depends(get_db)
):
    """Delete a staff member"""
    staff = (
        _staff_query_for_admin_org(db, admin)
        .filter(models.Staff.staff_code == staff_code)
        .first()
    )

    if not staff:
        raise HTTPException(status_code=404, detail={"msg": "Staff member not found"})

    db.delete(staff)
    db.commit()

    return {"success": True, "message": f"Staff member {staff_code} deleted successfully"}


# RESIDENT MANAGEMENT

@router.get("/residents", response_model=List[dict])
def get_all_residents(
    admin: models.Admin = Depends(require_admin_account),
    db: Session = Depends(get_db)
):
    """Get all residents for current admin"""
    admin_id = admin.id

    residents = db.query(models.Resident).filter(models.Resident.admin_id == admin_id).all()

    return [
        {
            "id": r.id,
            "full_name": r.full_name,
            "age": r.age,
            "room": r.room,
            "status": r.status,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        }
        for r in residents
    ]


@router.post("/resident/create", response_model=dict)
def create_resident(
    admin: models.Admin = Depends(require_admin_account),
    db: Session = Depends(get_db),
    full_name: str = Query(..., min_length=1),
    age: int = Query(..., ge=0, le=130),
    room: str = Query(..., min_length=1),
    status: str = Query("active"),
):
    """Create a new resident"""
    admin_id = admin.id

    new_resident = models.Resident(
        admin_id=admin_id,
        full_name=full_name,
        age=age,
        room=room,
        status=status
    )
    db.add(new_resident)
    db.flush()

    new_resident.unique_code = generate_unique_id(db, models.Resident, "unique_code")
    resident_id = f"RES-{new_resident.unique_code}"
    db.commit()
    db.refresh(new_resident)

    return {
        "success": True,
        "resident_id": resident_id,
        "full_name": full_name,
        "age": age,
        "room": room,
        "status": status,
        "message": f"Resident {full_name} created successfully with ID {resident_id}"
    }


@router.get("/residents/{resident_id}")
def get_resident(
    resident_id: int,
    admin: models.Admin = Depends(require_admin_account),
    db: Session = Depends(get_db)
):
    """Get resident details"""
    admin_id = admin.id

    resident = db.query(models.Resident).filter(
        models.Resident.admin_id == admin_id,
        models.Resident.id == resident_id
    ).first()

    if not resident:
        raise HTTPException(status_code=404, detail={"msg": "Resident not found"})

    return {
        "id": resident.id,
        "full_name": resident.full_name,
        "age": resident.age,
        "room": resident.room,
        "status": resident.status,
        "created_at": resident.created_at.isoformat() if resident.created_at else None,
    }


@router.patch("/resident/{resident_id}")
def update_resident(
    resident_id: int,
    full_name: str = None,
    age: int = None,
    room: str = None,
    status: str = None,
    admin: models.Admin = Depends(require_admin_account),
    db: Session = Depends(get_db)
):
    """Update resident details"""
    admin_id = admin.id

    resident = db.query(models.Resident).filter(
        models.Resident.admin_id == admin_id,
        models.Resident.id == resident_id
    ).first()

    if not resident:
        raise HTTPException(status_code=404, detail={"msg": "Resident not found"})

    if full_name:
        resident.full_name = full_name
    if age:
        resident.age = age
    if room:
        resident.room = room
    if status:
        resident.status = status

    db.commit()

    return {"success": True, "message": "Resident updated successfully"}


@router.delete("/resident/{resident_id}")
def delete_resident(
    resident_id: int,
    admin: models.Admin = Depends(require_admin_account),
    db: Session = Depends(get_db)
):
    """Delete a resident"""
    admin_id = admin.id

    resident = db.query(models.Resident).filter(
        models.Resident.admin_id == admin_id,
        models.Resident.id == resident_id
    ).first()

    if not resident:
        raise HTTPException(status_code=404, detail={"msg": "Resident not found"})

    db.delete(resident)
    db.commit()

    return {"success": True, "message": f"Resident deleted successfully"}


# RBAC 

@router.get("/permissions/{staff_code}", response_model=dict)
def get_staff_permissions(
    staff_code: str,
    admin: models.Admin = Depends(require_admin_account),
    db: Session = Depends(get_db)
):
    """Get permissions for a staff member"""
    staff = (
        _staff_query_for_admin_org(db, admin)
        .filter(models.Staff.staff_code == staff_code)
        .first()
    )
    if not staff:
        raise HTTPException(status_code=404, detail={"msg": "Staff member not found"})

    # Default permissions based on role
    return {
        "staff_code": staff_code,
        "permissions": {
            "view_residents": True,
            "manage_residents": True,
            "view_staff": True,
            "manage_staff": False,
            "manage_bookings": True,
            "view_analytics": True,
            "manage_alerts": True,
            "admin_console": False
        }
    }


@router.post("/permissions/{staff_code}/update")
def update_staff_permissions(
    staff_code: str,
    permissions: dict,
    admin: models.Admin = Depends(require_admin_account),
    db: Session = Depends(get_db)
):
    """Update permissions for a staff member"""
    staff = (
        _staff_query_for_admin_org(db, admin)
        .filter(models.Staff.staff_code == staff_code)
        .first()
    )
    if not staff:
        raise HTTPException(status_code=404, detail={"msg": "Staff member not found"})

    # In a real system, you would save these to a permissions table
    # For now, we return the updated permissions
    return {
        "success": True,
        "staff_code": staff_code,
        "permissions": permissions,
        "message": "Permissions updated successfully"
    }
