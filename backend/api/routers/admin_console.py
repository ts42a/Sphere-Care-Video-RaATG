"""
Admin Console Router - RBAC Management, Staff & Resident Management
"""
from fastapi import APIRouter, Depends, HTTPException, Header
from sqlalchemy.orm import Session
from typing import List
import uuid
import time
import random as _r

from backend.api.deps import get_db
from backend import models, schemas
from backend.api.routers.auth import _get_current_user, create_access_token, hash_password
from backend.db.db_manager import AdminDatabaseManager

router = APIRouter(prefix="/admin", tags=["Admin Console"])

@router.get("/staff/pending", response_model=list)
def get_pending_staff(current_user: models.User = Depends(_get_current_user), db: Session = Depends(get_db)):
    """Get all pending staff waiting for approval"""
    
    admin_id = getattr(current_user, 'admin_id', None) or (current_user.id if hasattr(current_user, 'role') and current_user.role == 'admin' else None)
    
    if not admin_id:
        raise HTTPException(status_code=403, detail={"msg": "Unauthorized"})
    
    try:
        SessionLocal = AdminDatabaseManager.get_admin_session_local(admin_id)
        admin_db = SessionLocal()
        
        try:
            pending_staff = admin_db.query(models.Staff).filter(
                models.Staff.admin_id == admin_id,
                models.Staff.approval_status == "pending"
            ).all()
            
            return [
                {
                    "id": s.id,
                    "staff_id": s.staff_id,
                    "full_name": s.full_name,
                    "email": admin_db.query(models.User).filter(models.User.id == s.user_id).first().email if s.user_id else "N/A",
                    "created_at": s.created_at.isoformat() if s.created_at else None,
                    "approval_status": s.approval_status
                }
                for s in pending_staff
            ]
        finally:
            admin_db.close()
    except Exception as e:
        raise HTTPException(status_code=500, detail={"msg": "Failed to fetch pending staff", "error": str(e)})


@router.post("/staff/{staff_id}/approve")
def approve_staff(
    staff_id: str,
    current_user: models.User = Depends(_get_current_user),
    db: Session = Depends(get_db)
):
    """Approve a pending staff member"""
    
    admin_id = getattr(current_user, 'admin_id', None) or (current_user.id if hasattr(current_user, 'role') and current_user.role == 'admin' else None)
    
    if not admin_id:
        raise HTTPException(status_code=403, detail={"msg": "Unauthorized"})
    
    try:
        SessionLocal = AdminDatabaseManager.get_admin_session_local(admin_id)
        admin_db = SessionLocal()
        
        try:
            staff = admin_db.query(models.Staff).filter(
                models.Staff.admin_id == admin_id,
                models.Staff.staff_id == staff_id
            ).first()
            
            if not staff:
                raise HTTPException(status_code=404, detail={"msg": "Staff member not found"})
            
            staff.approval_status = "approved"
            staff.status = "active"  # Also set status to active
            admin_db.commit()
            
            return {"success": True, "message": f"Staff member {staff.full_name} has been approved"}
        finally:
            admin_db.close()
            
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail={"msg": "Failed to approve staff", "error": str(e)})


@router.post("/staff/{staff_id}/reject")
def reject_staff(
    staff_id: str,
    reason: str = "",
    current_user: models.User = Depends(_get_current_user),
    db: Session = Depends(get_db)
):
    """Reject a pending staff member"""
    
    admin_id = getattr(current_user, 'admin_id', None) or (current_user.id if hasattr(current_user, 'role') and current_user.role == 'admin' else None)
    
    if not admin_id:
        raise HTTPException(status_code=403, detail={"msg": "Unauthorized"})
    
    try:
        SessionLocal = AdminDatabaseManager.get_admin_session_local(admin_id)
        admin_db = SessionLocal()
        
        try:
            staff = admin_db.query(models.Staff).filter(
                models.Staff.admin_id == admin_id,
                models.Staff.staff_id == staff_id
            ).first()
            
            if not staff:
                raise HTTPException(status_code=404, detail={"msg": "Staff member not found"})
            
            staff.approval_status = "rejected"
            staff.status = "inactive"
            admin_db.commit()
            
            return {"success": True, "message": f"Staff member {staff.full_name} has been rejected", "reason": reason}
        finally:
            admin_db.close()
            
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail={"msg": "Failed to reject staff", "error": str(e)})




@router.get("/staff", response_model=List[dict])
def get_all_staff(current_user: models.User = Depends(_get_current_user), db: Session = Depends(get_db)):
    """Get all staff members for current admin"""
    
    admin_id = getattr(current_user, 'admin_id', None) or (current_user.id if hasattr(current_user, 'role') and current_user.role == 'admin' else None)
    
    if not admin_id:
        raise HTTPException(status_code=403, detail={"msg": "Unauthorized"})
    
    staff_list = db.query(models.Staff).filter(models.Staff.admin_id == admin_id).all()
    
    return [
        {
            "id": s.id,
            "staff_id": s.staff_id,
            "full_name": s.full_name,
            "shift_time": s.shift_time,
            "assigned_unit": s.assigned_unit,
            "status": s.status,
            "role": s.role,
            "created_at": s.created_at.isoformat() if s.created_at else None,
        }
        for s in staff_list
    ]


@router.post("/staff/create", response_model=dict)
def create_staff(
    full_name: str,
    shift_time: str,
    assigned_unit: str,
    role: str = "staff",
    current_user: models.User = Depends(_get_current_user),
    db: Session = Depends(get_db)
):
    """Create a new staff member"""
    
    admin_id = getattr(current_user, 'admin_id', None) or (current_user.id if hasattr(current_user, 'role') and current_user.role == 'admin' else None)
    
    if not admin_id:
        raise HTTPException(status_code=403, detail={"msg": "Unauthorized"})
    
    try:
        # Generate unique staff ID
        timestamp = str(int(time.time()))[-4:]
        random_suffix = str(_r.randint(1000, 9999))
        staff_id = f"ST-{timestamp}-{random_suffix}"
        
        # Create staff record in admin's database
        SessionLocal = AdminDatabaseManager.get_admin_session_local(admin_id)
        admin_db = SessionLocal()
        
        try:
            new_staff = models.Staff(
                admin_id=admin_id,
                staff_id=staff_id,
                full_name=full_name,
                shift_time=shift_time,
                assigned_unit=assigned_unit,
                status="active",
                role=role
            )
            admin_db.add(new_staff)
            admin_db.commit()
            admin_db.refresh(new_staff)
            
            return {
                "success": True,
                "staff_id": staff_id,
                "full_name": full_name,
                "shift_time": shift_time,
                "assigned_unit": assigned_unit,
                "role": role,
                "message": f"Staff member {full_name} created successfully with ID {staff_id}"
            }
        finally:
            admin_db.close()
            
    except Exception as e:
        raise HTTPException(status_code=500, detail={"msg": "Failed to create staff", "error": str(e)})


@router.patch("/staff/{staff_id}")
def update_staff(
    staff_id: str,
    full_name: str = None,
    shift_time: str = None,
    assigned_unit: str = None,
    status: str = None,
    role: str = None,
    current_user: models.User = Depends(_get_current_user),
    db: Session = Depends(get_db)
):
    """Update staff member details"""
    
    admin_id = getattr(current_user, 'admin_id', None) or (current_user.id if hasattr(current_user, 'role') and current_user.role == 'admin' else None)
    
    if not admin_id:
        raise HTTPException(status_code=403, detail={"msg": "Unauthorized"})
    
    try:
        SessionLocal = AdminDatabaseManager.get_admin_session_local(admin_id)
        admin_db = SessionLocal()
        
        try:
            staff = admin_db.query(models.Staff).filter(
                models.Staff.admin_id == admin_id,
                models.Staff.staff_id == staff_id
            ).first()
            
            if not staff:
                raise HTTPException(status_code=404, detail={"msg": "Staff member not found"})
            
            if full_name:
                staff.full_name = full_name
            if shift_time:
                staff.shift_time = shift_time
            if assigned_unit:
                staff.assigned_unit = assigned_unit
            if status:
                staff.status = status
            if role:
                staff.role = role
            
            admin_db.commit()
            
            return {"success": True, "message": "Staff member updated successfully"}
        finally:
            admin_db.close()
            
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail={"msg": "Failed to update staff", "error": str(e)})


@router.delete("/staff/{staff_id}")
def delete_staff(
    staff_id: str,
    current_user: models.User = Depends(_get_current_user),
    db: Session = Depends(get_db)
):
    """Delete a staff member"""
    
    admin_id = getattr(current_user, 'admin_id', None) or (current_user.id if hasattr(current_user, 'role') and current_user.role == 'admin' else None)
    
    if not admin_id:
        raise HTTPException(status_code=403, detail={"msg": "Unauthorized"})
    
    try:
        SessionLocal = AdminDatabaseManager.get_admin_session_local(admin_id)
        admin_db = SessionLocal()
        
        try:
            staff = admin_db.query(models.Staff).filter(
                models.Staff.admin_id == admin_id,
                models.Staff.staff_id == staff_id
            ).first()
            
            if not staff:
                raise HTTPException(status_code=404, detail={"msg": "Staff member not found"})
            
            admin_db.delete(staff)
            admin_db.commit()
            
            return {"success": True, "message": f"Staff member {staff_id} deleted successfully"}
        finally:
            admin_db.close()
            
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail={"msg": "Failed to delete staff", "error": str(e)})


# RESIDENT MANAGEMENT

@router.get("/residents", response_model=List[dict])
def get_all_residents(
    current_user: models.User = Depends(_get_current_user),
    db: Session = Depends(get_db)
):
    """Get all residents for current admin"""
    
    admin_id = getattr(current_user, 'admin_id', None) or (current_user.id if hasattr(current_user, 'role') and current_user.role == 'admin' else None)
    
    if not admin_id:
        raise HTTPException(status_code=403, detail={"msg": "Unauthorized"})
    
    try:
        SessionLocal = AdminDatabaseManager.get_admin_session_local(admin_id)
        admin_db = SessionLocal()
        
        try:
            residents = admin_db.query(models.Resident).filter(models.Resident.admin_id == admin_id).all()
            
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
        finally:
            admin_db.close()
    except Exception as e:
        raise HTTPException(status_code=500, detail={"msg": "Failed to fetch residents", "error": str(e)})


@router.post("/resident/create", response_model=dict)
def create_resident(
    full_name: str,
    age: int,
    room: str,
    status: str = "stable",
    current_user: models.User = Depends(_get_current_user),
    db: Session = Depends(get_db)
):
    """Create a new resident"""
    
    admin_id = getattr(current_user, 'admin_id', None) or (current_user.id if hasattr(current_user, 'role') and current_user.role == 'admin' else None)
    
    if not admin_id:
        raise HTTPException(status_code=403, detail={"msg": "Unauthorized"})
    
    try:
        SessionLocal = AdminDatabaseManager.get_admin_session_local(admin_id)
        admin_db = SessionLocal()
        
        try:
            # Generate unique resident ID
            resident_id = str(uuid.uuid4())[:8].upper()
            
            new_resident = models.Resident(
                admin_id=admin_id,
                full_name=full_name,
                age=age,
                room=room,
                status=status
            )
            admin_db.add(new_resident)
            admin_db.commit()
            admin_db.refresh(new_resident)
            
            return {
                "success": True,
                "resident_id": resident_id,
                "full_name": full_name,
                "age": age,
                "room": room,
                "status": status,
                "message": f"Resident {full_name} created successfully with ID {resident_id}"
            }
        finally:
            admin_db.close()
            
    except Exception as e:
        raise HTTPException(status_code=500, detail={"msg": "Failed to create resident", "error": str(e)})


@router.get("/residents/{resident_id}")
def get_resident(
    resident_id: int,
    current_user: models.User = Depends(_get_current_user),
    db: Session = Depends(get_db)
):
    """Get resident details"""
    
    admin_id = getattr(current_user, 'admin_id', None) or (current_user.id if hasattr(current_user, 'role') and current_user.role == 'admin' else None)
    
    if not admin_id:
        raise HTTPException(status_code=403, detail={"msg": "Unauthorized"})
    
    try:
        SessionLocal = AdminDatabaseManager.get_admin_session_local(admin_id)
        admin_db = SessionLocal()
        
        try:
            resident = admin_db.query(models.Resident).filter(
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
        finally:
            admin_db.close()
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail={"msg": "Failed to fetch resident", "error": str(e)})


@router.patch("/resident/{resident_id}")
def update_resident(
    resident_id: int,
    full_name: str = None,
    age: int = None,
    room: str = None,
    status: str = None,
    current_user: models.User = Depends(_get_current_user),
    db: Session = Depends(get_db)
):
    """Update resident details"""
    
    admin_id = getattr(current_user, 'admin_id', None) or (current_user.id if hasattr(current_user, 'role') and current_user.role == 'admin' else None)
    
    if not admin_id:
        raise HTTPException(status_code=403, detail={"msg": "Unauthorized"})
    
    try:
        SessionLocal = AdminDatabaseManager.get_admin_session_local(admin_id)
        admin_db = SessionLocal()
        
        try:
            resident = admin_db.query(models.Resident).filter(
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
            
            admin_db.commit()
            
            return {"success": True, "message": "Resident updated successfully"}
        finally:
            admin_db.close()
            
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail={"msg": "Failed to update resident", "error": str(e)})


@router.delete("/resident/{resident_id}")
def delete_resident(
    resident_id: int,
    current_user: models.User = Depends(_get_current_user),
    db: Session = Depends(get_db)
):
    """Delete a resident"""
    
    admin_id = getattr(current_user, 'admin_id', None) or (current_user.id if hasattr(current_user, 'role') and current_user.role == 'admin' else None)
    
    if not admin_id:
        raise HTTPException(status_code=403, detail={"msg": "Unauthorized"})
    
    try:
        SessionLocal = AdminDatabaseManager.get_admin_session_local(admin_id)
        admin_db = SessionLocal()
        
        try:
            resident = admin_db.query(models.Resident).filter(
                models.Resident.admin_id == admin_id,
                models.Resident.id == resident_id
            ).first()
            
            if not resident:
                raise HTTPException(status_code=404, detail={"msg": "Resident not found"})
            
            admin_db.delete(resident)
            admin_db.commit()
            
            return {"success": True, "message": f"Resident deleted successfully"}
        finally:
            admin_db.close()
            
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail={"msg": "Failed to delete resident", "error": str(e)})


# RBAC 

@router.get("/permissions/{staff_id}", response_model=dict)
def get_staff_permissions(
    staff_id: str,
    current_user: models.User = Depends(_get_current_user),
    db: Session = Depends(get_db)
):
    """Get permissions for a staff member"""
    
    admin_id = getattr(current_user, 'admin_id', None) or (current_user.id if hasattr(current_user, 'role') and current_user.role == 'admin' else None)
    
    if not admin_id:
        raise HTTPException(status_code=403, detail={"msg": "Unauthorized"})
    
    # Default permissions based on role
    return {
        "staff_id": staff_id,
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


@router.post("/permissions/{staff_id}/update")
def update_staff_permissions(
    staff_id: str,
    permissions: dict,
    current_user: models.User = Depends(_get_current_user),
    db: Session = Depends(get_db)
):
    """Update permissions for a staff member"""
    
    admin_id = getattr(current_user, 'admin_id', None) or (current_user.id if hasattr(current_user, 'role') and current_user.role == 'admin' else None)
    
    if not admin_id:
        raise HTTPException(status_code=403, detail={"msg": "Unauthorized"})
    
    # In a real system, you would save these to a permissions table
    # For now, we return the updated permissions
    return {
        "success": True,
        "staff_id": staff_id,
        "permissions": permissions,
        "message": "Permissions updated successfully"
    }
