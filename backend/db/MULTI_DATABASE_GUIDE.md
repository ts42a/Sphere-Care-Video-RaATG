# Multi-Database Architecture for Sphere Care

## Overview

This system implements a **per-admin database structure** where each care center (admin) has its own isolated SQLite database. This provides:

- **Data Isolation**: Each admin's residents, staff, and data are completely separate
- **Scalability**: Easy to add new care centers without affecting existing ones
- **Folder Organization**: Each admin has a dedicated folder with their database and uploads
- **Multi-tenancy**: Support for managing multiple care centers from one application

## Directory Structure

```
Sphere-Care-Video-RaATG/
├── databases/                    # Base directory for all admin databases
│   ├── admin_1/                 # First admin/care center
│   │   ├── sphere_care.db       # Admin 1's database
│   │   └── uploads/
│   │       ├── documents/
│   │       ├── images/
│   │       └── videos/
│   │
│   ├── admin_2/                 # Second admin/care center
│   │   ├── sphere_care.db       # Admin 2's database
│   │   └── uploads/
│   │       ├── documents/
│   │       ├── images/
│   │       └── videos/
│   │
│   └── admin_N/
│       ├── sphere_care.db
│       └── uploads/
```

## Data Model Relationships

### Admin (Master User)
- One admin per care center
- Can have multiple staff members
- Can manage multiple residents
- Owns the database and all data within it

### Staff
- Belongs to an admin_id
- Multiple staff members per admin
- Has a user account through user_id

### Resident
- Belongs to an admin_id
- Multiple residents per admin
- Managed by admin's staff

```
admin_1 (database stored at databases/admin_1/sphere_care.db)
├── Staff_1 (admin_id=1)
├── Staff_2 (admin_id=1)
├── ...
├── Resident_1 (admin_id=1)
├── Resident_2 (admin_id=1)
└── ...

admin_2 (database stored at databases/admin_2/sphere_care.db)
├── Staff_1 (admin_id=2)
├── Staff_2 (admin_id=2)
├── ...
├── Resident_1 (admin_id=2)
├── Resident_2 (admin_id=2)
└── ...
```

## Implementation Guide

### 1. Creating a New Admin Account

When a new admin registers, initialize their database:

```python
from backend.db.db_init import initialize_new_admin_database
from backend.models.admin import Admin
from backend.db.session import SessionLocal

# Create admin in master database
db = SessionLocal()
new_admin = Admin(
    full_name="John Doe",
    email="admin@carecentre.com",
    password_hash=hashed_password,
    organization_name="Central Care Centre",
    phone="+555-123456",
    address="123 Main St",
    city="Springfield",
    state="IL",
    postal_code="62701",
    country="USA"
)
db.add(new_admin)
db.commit()
admin_id = new_admin.id
db.close()

# Initialize admin's personal database
success = initialize_new_admin_database(admin_id)
if success:
    print(f"Database created for admin {admin_id}")
```

### 2. Working with Admin-Specific Database Sessions

```python
from backend.db.db_manager import AdminDatabaseManager
from backend.models.resident import Resident

# Get session for a specific admin
admin_id = 1
SessionLocal = AdminDatabaseManager.get_admin_session_local(admin_id)
db = SessionLocal()

# Query residents for this admin
residents = db.query(Resident).filter(Resident.admin_id == admin_id).all()

db.close()
```

### 3. Dependency Injection in FastAPI Routes

#### Using admin_id from JWT token (automatically selected database):

```python
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from backend.api.deps import get_admin_context_db

router = APIRouter()

@router.get("/api/residents")
def get_residents(db: Session = Depends(get_admin_context_db)):
    # db is automatically for the current admin from JWT token
    # All queries will use the admin's database
    from backend.models.resident import Resident
    residents = db.query(Resident).all()  # Only returns admin's residents
    return residents
```

#### Using explicit admin_id:

```python
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from backend.api.deps import get_admin_db

router = APIRouter()

@router.get("/api/admin/{admin_id}/residents")
def get_residents(admin_id: int, db: Session = Depends(get_admin_db(admin_id))):
    from backend.models.resident import Resident
    residents = db.query(Resident).filter(Resident.admin_id == admin_id).all()
    return residents
```

### 4. Adding Staff to an Admin

```python
from backend.models.staff import Staff
from backend.db.db_manager import AdminDatabaseManager

admin_id = 1
SessionLocal = AdminDatabaseManager.get_admin_session_local(admin_id)
db = SessionLocal()

new_staff = Staff(
    admin_id=admin_id,  # Important: set admin_id
    full_name="Alice Smith",
    staff_id="STAFF001",
    shift_time="09:00-17:00",
    assigned_unit="Ward A",
    role="nurse"
)
db.add(new_staff)
db.commit()
db.close()
```

### 5. Adding Residents to an Admin

```python
from backend.models.resident import Resident
from backend.db.db_manager import AdminDatabaseManager

admin_id = 1
SessionLocal = AdminDatabaseManager.get_admin_session_local(admin_id)
db = SessionLocal()

new_resident = Resident(
    admin_id=admin_id,  # Important: set admin_id
    full_name="Bob Johnson",
    age=75,
    room="101",
    status="stable"
)
db.add(new_resident)
db.commit()
db.close()
```

### 6. Database Utilities

```python
from backend.db.db_init import (
    initialize_new_admin_database,
    migrate_admin_database,
    verify_admin_database_exists,
    list_all_admin_databases
)

# List all existing admin databases
all_dbs = list_all_admin_databases()
print(all_dbs)  # Output: {1: '/path/to/admin_1/sphere_care.db', 2: '...', ...}

# Check if admin database exists
exists = verify_admin_database_exists(admin_id=1)

# Migrate an admin database (when schema changes)
migrate_admin_database(admin_id=1)
```

## Migration from Single Database

If you have an existing single database and want to migrate to per-admin database:

1. **Export data** from the single database by admin
2. **Create new admin databases** using `initialize_new_admin_database()`
3. **Import data** into respective admin databases with correct `admin_id` values
4. **Verify data integrity** before switching

## Key Points

### ✅ Do's:
- Always set `admin_id` when creating records (Staff, Resident, etc.)
- Use the appropriate database session for each admin
- Initialize database when creating new admin account
- Store admin_id in JWT token for automatic session management
- Use uploads/ subfolder structure for file storage

### ❌ Don'ts:
- Don't use the default SessionLocal for queries that need admin isolation
- Don't forget to set admin_id on new records
- Don't share database sessions between admins
- Don't store files in a global uploads folder (use admin-specific ones)

## Security Considerations

1. **Admin ID Validation**: Always validate that the requesting admin owns the data they're accessing
2. **JWT Tokens**: Include admin_id in JWT claims and validate on each request
3. **Query Filtering**: Always filter by admin_id in queries to prevent cross-admin data leakage
4. **Route Protection**: Use `get_admin_context_db` dependency to ensure actions are admin-scoped

## Example: Complete Service Layer

```python
from sqlalchemy.orm import Session
from backend.models.resident import Resident
from backend.models.staff import Staff
from backend.db.db_manager import AdminDatabaseManager


class ResidentService:
    """Service for managing residents within an admin's database."""
    
    @staticmethod
    def create_resident(admin_id: int, data: dict) -> Resident:
        SessionLocal = AdminDatabaseManager.get_admin_session_local(admin_id)
        db = SessionLocal()
        try:
            resident = Resident(
                admin_id=admin_id,
                **data
            )
            db.add(resident)
            db.commit()
            db.refresh(resident)
            return resident
        finally:
            db.close()
    
    @staticmethod
    def get_residents(admin_id: int) -> list:
        SessionLocal = AdminDatabaseManager.get_admin_session_local(admin_id)
        db = SessionLocal()
        try:
            return db.query(Resident).filter(
                Resident.admin_id == admin_id
            ).all()
        finally:
            db.close()
    
    @staticmethod
    def get_resident(admin_id: int, resident_id: int) -> Resident:
        SessionLocal = AdminDatabaseManager.get_admin_session_local(admin_id)
        db = SessionLocal()
        try:
            return db.query(Resident).filter(
                Resident.admin_id == admin_id,
                Resident.id == resident_id
            ).first()
        finally:
            db.close()
```

## Next Steps

1. Update all API routes to use `get_admin_context_db` dependency
2. Update auth service to include `admin_id` in JWT tokens
3. Modify user registration to create admin databases
4. Update all repositories to filter by admin_id
5. Test multi-admin scenarios
