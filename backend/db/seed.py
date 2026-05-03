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
from backend.models.camera import Camera, CameraAlert
from backend.utils.id_generator import generate_unique_id

_PASSWORD = "Pass1234"

_ADMINS = [
    {"full_name": "Admin One",  "email": "admin1@test.com",  "org_name": "Test Care Center 1"},
    {"full_name": "Admin Two",  "email": "admin2@test.com",  "org_name": "Test Care Center 2"},
]

_STAFF = [
    {"full_name": "Sarah Nurse",     "email": "staff1@test.com",  "global_role": "staff"},
    {"full_name": "James Carer",     "email": "staff2@test.com",  "global_role": "staff"},
    {"full_name": "Emily Therapist", "email": "staff3@test.com",  "global_role": "staff"},
    {"full_name": "Mark Physio",     "email": "staff4@test.com",  "global_role": "staff"},
]

_RESIDENTS = [
    {"full_name": "Dorothy Miller",  "age": 82, "gender": "female", "room": "101", "bed_no": "A", "care_level": "Standard",   "primary_diagnosis": "Mild dementia",       "mobility_status": "Walker"},
    {"full_name": "Harold Wilson",   "age": 78, "gender": "male",   "room": "102", "bed_no": "A", "care_level": "High",       "primary_diagnosis": "Parkinson's disease",  "mobility_status": "Wheelchair"},
    {"full_name": "Margaret Brown",  "age": 85, "gender": "female", "room": "103", "bed_no": "A", "care_level": "Standard",   "primary_diagnosis": "Arthritis",            "mobility_status": "Independent"},
    {"full_name": "Albert Davis",    "age": 90, "gender": "male",   "room": "104", "bed_no": "A", "care_level": "Palliative", "primary_diagnosis": "Heart failure",        "mobility_status": "Bed-bound"},
]

_CLIENTS = [
    {"full_name": "Client One", "email": "client1@test.com", "global_role": "client"},
    {"full_name": "Client Two", "email": "client2@test.com", "global_role": "client"},
]

# Cameras seeded for admin 1.
# stream_status="live" → counted in the Online stat card.
# stream_status="offline" → counted in Total only.
_CAMERAS = [
    {"title": "Room 101 — Main View",   "resident_name": "Dorothy Miller",  "floor": "Floor 1", "room": "101", "stream_status": "live",    "status": "active"},
    {"title": "Room 102 — Main View",   "resident_name": "Harold Wilson",   "floor": "Floor 1", "room": "102", "stream_status": "live",    "status": "active"},
    {"title": "Room 103 — Main View",   "resident_name": "Margaret Brown",  "floor": "Floor 1", "room": "103", "stream_status": "live",    "status": "active"},
    {"title": "Room 104 — Main View",   "resident_name": "Albert Davis",    "floor": "Floor 1", "room": "104", "stream_status": "live",    "status": "active"},
    {"title": "Corridor A — Floor 1",   "resident_name": None,              "floor": "Floor 1", "room": None,  "stream_status": "live",    "status": "active"},
    {"title": "Corridor B — Floor 2",   "resident_name": None,              "floor": "Floor 2", "room": None,  "stream_status": "live",    "status": "active"},
    {"title": "Entrance — Main Lobby",  "resident_name": None,              "floor": "Floor 1", "room": None,  "stream_status": "live",    "status": "active"},
    {"title": "Garden — Outdoor Area",  "resident_name": None,              "floor": "Floor 1", "room": None,  "stream_status": "offline", "status": "inactive"},
]

# Alerts seeded against camera index 0 (Room 101).
# resolved=False → counted in Active Alerts and Events (24h) stat cards.
# resolved=True  → counted in Events (24h) only (within the last 24 h).
_ALERTS = [
    {
        "alert_type": "critical",
        "severity": "critical",
        "icon": "fall",
        "title": "Fall Detected — Room 101",
        "description": "Resident Dorothy Miller may have fallen near the bed. Immediate check required.",
        "resolved": False,
    },
    {
        "alert_type": "warning",
        "severity": "medium",
        "icon": "motion",
        "title": "Unusual Movement — Corridor A",
        "description": "Unscheduled movement detected at 02:14 AM in Corridor A.",
        "resolved": False,
    },
    {
        "alert_type": "warning",
        "severity": "medium",
        "icon": "person",
        "title": "Resident Out of Bed — Room 102",
        "description": "Harold Wilson detected out of bed after midnight.",
        "resolved": False,
    },
    {
        "alert_type": "info",
        "severity": "low",
        "icon": "sound",
        "title": "Loud Sound — Room 103",
        "description": "Elevated noise level detected. Checked and cleared by night staff.",
        "resolved": True,
    },
    {
        "alert_type": "info",
        "severity": "low",
        "icon": "motion",
        "title": "Motion — Garden Area",
        "description": "Motion sensor triggered. Confirmed as wind interference.",
        "resolved": True,
    },
]


def seed_database() -> None:
    """Populate the database with test accounts if it is empty."""
    AdminDatabaseManager.create_all_tables()

    db: Session = SessionLocal()
    try:
        if db.query(Admin).first() is not None:
            return

        pw = get_password_hash(_PASSWORD)

        # ── Admins & organisations ───────────────────────────────────
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

        admin_id = admins[0].id

        # ── Staff ────────────────────────────────────────────────────
        for data in _STAFF:
            user_code = generate_unique_id(db, User, "unique_code")
            user = User(
                unique_code=user_code,
                password_hash=pw,
                full_name=data["full_name"],
                email=data["email"],
                global_role=data["global_role"],
            )
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

        # ── Residents ────────────────────────────────────────────────
        from datetime import date
        residents: list[Resident] = []
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
            db.flush()
            residents.append(resident)

        # ── Clients ──────────────────────────────────────────────────
        for data in _CLIENTS:
            client_code = generate_unique_id(db, User, "unique_code")
            client = User(unique_code=client_code, password_hash=pw, **data)
            db.add(client)
            db.flush()

        # ── Cameras ─────────────────────────────────────────────────
        # Seed cameras for admin 1 so that the Recording Console stat
        # cards (Total Cameras, Online, Active Alerts, Events 24h)
        # show real data immediately after first startup.
        cameras: list[Camera] = []
        for cam_data in _CAMERAS:
            cam = Camera(
                admin_id=admin_id,
                title=cam_data["title"],
                resident_name=cam_data["resident_name"],
                floor=cam_data["floor"],
                room=cam_data["room"],
                stream_status=cam_data["stream_status"],   # "live" → counted in Online
                status=cam_data["status"],
                description=None,
                stream_url=None,
            )
            db.add(cam)
            db.flush()
            cameras.append(cam)

        # ── Camera Alerts ────────────────────────────────────────────
        # All alerts are created with created_at = now (default), so
        # they all fall within the 24-hour rolling window used by the
        # Events (24h) stat card.
        first_cam_id = cameras[0].id
        for alert_data in _ALERTS:
            alert = CameraAlert(
                admin_id=admin_id,
                camera_id=first_cam_id,
                alert_type=alert_data["alert_type"],
                severity=alert_data["severity"],
                icon=alert_data["icon"],
                title=alert_data["title"],
                description=alert_data["description"],
                resolved=alert_data["resolved"],
            )
            db.add(alert)

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
        print(f"  Cameras  : {len(cameras)} seeded  "
              f"({sum(1 for c in _CAMERAS if c['stream_status']=='live')} live / "
              f"{sum(1 for c in _CAMERAS if c['stream_status']=='offline')} offline)")
        print(f"  Alerts   : {len(_ALERTS)} seeded  "
              f"({sum(1 for a in _ALERTS if not a['resolved'])} active / "
              f"{sum(1 for a in _ALERTS if a['resolved'])} resolved)")
        print("──────────────────────────────────────────────")

    except Exception as exc:
        db.rollback()
        print(f"Seeding failed: {exc}")
        raise
    finally:
        db.close()