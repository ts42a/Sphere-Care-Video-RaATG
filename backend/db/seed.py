"""
Database seeding for development/testing.
Creates test accounts on first startup if the DB is empty.
Password for all accounts: Pass1234
"""

from sqlalchemy.orm import Session

from backend.core.security import get_password_hash
from backend.db.session import SessionLocal
from backend.db.db_manager import AdminDatabaseManager
from backend.models.organization import Organization
from backend.models.admin import Admin
from backend.models.user import User
from backend.models.staff import Staff
from backend.models.resident import Resident
from backend.utils.id_generator import generate_unique_id

_PASSWORD = "Pass1234"

_ADMINS = [
    {"full_name": "Admin One",  "email": "admin1@test.com",  "org_name": "Test Care Center 1"},
    {"full_name": "Admin Two",  "email": "admin2@test.com",  "org_name": "Test Care Center 2"},
]

_STAFF = [
    {"full_name": "Sarah Nurse",    "email": "staff1@test.com",  "global_role": "staff"},
    {"full_name": "James Carer",    "email": "staff2@test.com",  "global_role": "staff"},
    {"full_name": "Emily Therapist","email": "staff3@test.com",  "global_role": "staff"},
    {"full_name": "Mark Physio",    "email": "staff4@test.com",  "global_role": "staff"},
]

_RESIDENTS = [
    {"full_name": "Dorothy Miller",  "age": 82, "gender": "female", "room": "101", "bed_no": "A", "care_level": "Standard",   "primary_diagnosis": "Mild dementia",      "mobility_status": "Walker"},
    {"full_name": "Harold Wilson",   "age": 78, "gender": "male",   "room": "102", "bed_no": "A", "care_level": "High",       "primary_diagnosis": "Parkinson's disease", "mobility_status": "Wheelchair"},
    {"full_name": "Margaret Brown",  "age": 85, "gender": "female", "room": "103", "bed_no": "A", "care_level": "Standard",   "primary_diagnosis": "Arthritis",           "mobility_status": "Independent"},
    {"full_name": "Albert Davis",    "age": 90, "gender": "male",   "room": "104", "bed_no": "A", "care_level": "Palliative",  "primary_diagnosis": "Heart failure",       "mobility_status": "Bed-bound"},
]

_CLIENTS = [
    {"full_name": "Client One",  "email": "client1@test.com",  "global_role": "client"},
    {"full_name": "Client Two",  "email": "client2@test.com",  "global_role": "client"},
]


def seed_database() -> None:
    """Populate the database with test accounts if it is empty."""
    # Ensure all tables exist
    AdminDatabaseManager.create_all_tables()

    db: Session = SessionLocal()
    try:
        if db.query(Admin).first() is not None:
            return

        pw = get_password_hash(_PASSWORD)

        # Create admins (with organizations)
        admins: list[Admin] = []
        orgs: list[Organization] = []
        for data in _ADMINS:
            org_code = generate_unique_id(db, Organization, "unique_code")
            org = Organization(unique_code=org_code, organization_name=data["org_name"])
            db.add(org)
            db.flush()
            orgs.append(org)

            admin_code = generate_unique_id(db, Admin, "unique_code")
            admin = Admin(
                organization_id=org.id,
                unique_code=admin_code,
                full_name=data["full_name"],
                email=data["email"],
                password_hash=pw,
            )
            db.add(admin)
            db.flush()
            admins.append(admin)
            AdminDatabaseManager.ensure_admin_subdirectories(admin.id)

        # Create staff users and staff records for admin 1
        admin_id = admins[0].id
        for data in _STAFF:
            user_code = generate_unique_id(db, User, "unique_code")
            user = User(unique_code=user_code, password_hash=pw, full_name=data["full_name"], email=data["email"], global_role=data["global_role"])
            db.add(user)
            db.flush()
            staff_code = generate_unique_id(db, Staff, "staff_code")
            staff = Staff(
                admin_id=admin_id,
                user_id=user.id,
                staff_code=f"STF-{staff_code}",
                full_name=data["full_name"],
                assigned_unit="General",
                status="active",
                approval_status="approved",
                role="staff",
            )
            db.add(staff)

        # Create residents for admin 1
        from datetime import date
        for data in _RESIDENTS:
            res_code = generate_unique_id(db, Resident, "unique_code")
            resident = Resident(
                unique_code=res_code,
                admin_id=admin_id,
                full_name=data["full_name"],
                age=data["age"],
                gender=data["gender"],
                room=data["room"],
                bed_no=data["bed_no"],
                care_level=data["care_level"],
                primary_diagnosis=data["primary_diagnosis"],
                mobility_status=data["mobility_status"],
                status="active",
                admission_date=date(2025, 1, 15),
            )
            db.add(resident)

        # Create client users
        for data in _CLIENTS:
            client_code = generate_unique_id(db, User, "unique_code")
            client = User(unique_code=client_code, password_hash=pw, **data)
            db.add(client)
            db.flush()

        db.commit()

        print("── TEST DATA SEEDED ──────────────────────────")
        for i, a in enumerate(admins):
            print(f"  Admin    : {a.email}  /  {_PASSWORD}  (Center ID: CTR-{orgs[i].unique_code})")
        for s in _STAFF:
            print(f"  Staff    : {s['email']}  /  {_PASSWORD}  (Center ID: CTR-{orgs[0].unique_code})")
        for r in _RESIDENTS:
            print(f"  Resident : {r['full_name']}  (Room {r['room']})")
        for c in _CLIENTS:
            print(f"  Client   : {c['email']}  /  {_PASSWORD})")
        print("──────────────────────────────────────────────")

    except Exception as exc:
        db.rollback()
        print(f"Seeding failed: {exc}")
        raise
    finally:
        db.close()
