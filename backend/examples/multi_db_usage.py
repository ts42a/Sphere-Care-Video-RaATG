"""
Practical examples of using the new multi-database architecture.
These are example implementations for common operations.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List

from backend.api.deps import get_admin_context_db, get_admin_db
from backend.models.resident import Resident
from backend.models.staff import Staff
from backend.models.user import User
from backend.models.admin import Admin
from backend.db.session import SessionLocal
from backend.db.db_init import initialize_new_admin_database
from backend.db.db_manager import AdminDatabaseManager
from backend.schemas.resident import ResidentCreate, ResidentResponse


# Example 1: Route using automatic admin context (recommended for protected routes)
router = APIRouter(prefix="/api/residents", tags=["residents"])


@router.get("/", response_model=List[ResidentResponse])
def get_residents(db: Session = Depends(get_admin_context_db)):
    """
    Get all residents for the current admin (extracted from JWT token).
    The database session is automatically for the current admin.
    
    Usage: GET /api/residents
    """
    # NOTE: In real implementation, extract admin_id from JWT token
    # For now, assuming it comes through get_admin_context_db
    admin_id = 1  # Would be extracted from JWT token
    
    residents = db.query(Resident).filter(
        Resident.admin_id == admin_id
    ).all()
    
    return residents


@router.post("/", response_model=ResidentResponse)
def create_resident(
    resident_data: ResidentCreate,
    db: Session = Depends(get_admin_context_db)
):
    """
    Create a new resident for the current admin.
    
    Usage: POST /api/residents
    Body: {
        "full_name": "John Doe",
        "age": 75,
        "room": "101",
        "status": "stable"
    }
    """
    admin_id = 1  # Extracted from JWT token
    
    resident = Resident(
        admin_id=admin_id,
        **resident_data.dict()
    )
    db.add(resident)
    db.commit()
    db.refresh(resident)
    
    return resident


# Example 2: Admin Registration (creates both admin and their database)
@router.post("/admin/register")
def register_admin(admin_data: dict):
    """
    Register a new admin/care center.
    This creates an Admin user and initializes their database.
    
    Body:
    {
        "full_name": "Dr. Smith",
        "email": "admin@carecentre.com",
        "password": "securepassword",
        "organization_name": "Central Care Centre",
        "phone": "+1-555-123456",
        "address": "123 Main St",
        "city": "Springfield",
        "state": "IL",
        "postal_code": "62701",
        "country": "USA"
    }
    """
    from backend.core.security import get_password_hash
    
    # Create admin in master database
    master_db = SessionLocal()
    try:
        # Check if email already exists
        existing = master_db.query(Admin).filter(
            Admin.email == admin_data['email']
        ).first()
        
        if existing:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Email already registered"
            )
        
        # Create admin
        new_admin = Admin(
            full_name=admin_data['full_name'],
            email=admin_data['email'],
            password_hash=get_password_hash(admin_data['password']),
            organization_name=admin_data['organization_name'],
            phone=admin_data.get('phone'),
            address=admin_data.get('address'),
            city=admin_data.get('city'),
            state=admin_data.get('state'),
            postal_code=admin_data.get('postal_code'),
            country=admin_data.get('country'),
            is_active=True
        )
        
        master_db.add(new_admin)
        master_db.commit()
        master_db.refresh(new_admin)
        admin_id = new_admin.id
        
        # Initialize admin's personal database
        success = initialize_new_admin_database(admin_id)
        
        if not success:
            master_db.delete(new_admin)
            master_db.commit()
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to initialize admin database"
            )
        
        return {
            "admin_id": admin_id,
            "email": new_admin.email,
            "organization_name": new_admin.organization_name,
            "message": "Admin registered successfully"
        }
    finally:
        master_db.close()


# Example 3: Adding Staff to an Admin
@router.post("/admin/{admin_id}/staff")
def add_staff(admin_id: int, staff_data: dict):
    """
    Add a new staff member to an admin's organization.
    
    Body:
    {
        "full_name": "Nurse Alice",
        "staff_id": "STAFF001",
        "shift_time": "09:00-17:00",
        "assigned_unit": "Ward A",
        "role": "nurse"
    }
    """
    SessionLocal = AdminDatabaseManager.get_admin_session_local(admin_id)
    db = SessionLocal()
    
    try:
        # Check if staff_id already exists
        existing = db.query(Staff).filter(
            Staff.staff_id == staff_data['staff_id']
        ).first()
        
        if existing:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Staff ID already exists"
            )
        
        staff = Staff(
            admin_id=admin_id,
            **staff_data
        )
        
        db.add(staff)
        db.commit()
        db.refresh(staff)
        
        return {
            "id": staff.id,
            "full_name": staff.full_name,
            "staff_id": staff.staff_id,
            "message": "Staff added successfully"
        }
    finally:
        db.close()


# Example 4: Service Layer Pattern
class AdminService:
    """
    Service class for admin-related operations.
    Encapsulates business logic.
    """
    
    @staticmethod
    def get_admin_dashboard_stats(admin_id: int) -> dict:
        """Get statistics for admin's dashboard."""
        SessionLocal = AdminDatabaseManager.get_admin_session_local(admin_id)
        db = SessionLocal()
        
        try:
            residents_count = db.query(Resident).filter(
                Resident.admin_id == admin_id
            ).count()
            
            staff_count = db.query(Staff).filter(
                Staff.admin_id == admin_id
            ).count()
            
            return {
                "residents_count": residents_count,
                "staff_count": staff_count,
                "admin_id": admin_id
            }
        finally:
            db.close()
    
    @staticmethod
    def create_resident_with_booking(admin_id: int, resident_data: dict, booking_data: dict):
        """Create resident and associate booking in a transaction."""
        from backend.models.booking import Booking
        
        SessionLocal = AdminDatabaseManager.get_admin_session_local(admin_id)
        db = SessionLocal()
        
        try:
            # Create resident
            resident = Resident(
                admin_id=admin_id,
                **resident_data
            )
            db.add(resident)
            db.flush()
            
            # Create booking
            booking = Booking(
                admin_id=admin_id,
                resident_id=resident.id,
                **booking_data
            )
            db.add(booking)
            db.commit()
            
            return {
                "resident": resident,
                "booking": booking
            }
        except Exception as e:
            db.rollback()
            raise e
        finally:
            db.close()


# Example 5: Repository Pattern
class ResidentRepository:
    """
    Repository for resident database operations.
    Follows repository pattern for clean architecture.
    """
    
    def __init__(self, admin_id: int):
        self.admin_id = admin_id
        SessionLocal = AdminDatabaseManager.get_admin_session_local(admin_id)
        self.db = SessionLocal()
    
    def get_all(self) -> List[Resident]:
        """Get all residents for this admin."""
        return self.db.query(Resident).filter(
            Resident.admin_id == self.admin_id
        ).all()
    
    def get_by_id(self, resident_id: int) -> Resident:
        """Get resident by ID."""
        return self.db.query(Resident).filter(
            Resident.admin_id == self.admin_id,
            Resident.id == resident_id
        ).first()
    
    def create(self, data: dict) -> Resident:
        """Create new resident."""
        resident = Resident(
            admin_id=self.admin_id,
            **data
        )
        self.db.add(resident)
        self.db.commit()
        self.db.refresh(resident)
        return resident
    
    def update(self, resident_id: int, data: dict) -> Resident:
        """Update resident."""
        resident = self.get_by_id(resident_id)
        if not resident:
            return None
        
        for key, value in data.items():
            setattr(resident, key, value)
        
        self.db.commit()
        self.db.refresh(resident)
        return resident
    
    def delete(self, resident_id: int) -> bool:
        """Delete resident."""
        resident = self.get_by_id(resident_id)
        if not resident:
            return False
        
        self.db.delete(resident)
        self.db.commit()
        return True
    
    def close(self):
        """Close database session."""
        self.db.close()


# Example usage of repository:
def example_repository_usage():
    """
    Example of how to use the repository pattern.
    """
    admin_id = 1
    
    repo = ResidentRepository(admin_id)
    try:
        # Create
        new_resident = repo.create({
            "full_name": "John Doe",
            "age": 75,
            "room": "101",
            "status": "stable"
        })
        
        # Read
        residents = repo.get_all()
        
        # Update
        updated = repo.update(new_resident.id, {
            "status": "recovering"
        })
        
        # Delete
        deleted = repo.delete(new_resident.id)
        
    finally:
        repo.close()


if __name__ == "__main__":
    # Example: Get dashboard stats
    stats = AdminService.get_admin_dashboard_stats(admin_id=1)
    print(stats)
    
    # Example: Repository pattern
    example_repository_usage()
