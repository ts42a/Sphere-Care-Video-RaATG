"""
Database initialization and migration utilities for per-admin databases.
Use these utilities when creating new admin accounts.
"""

from backend.db.db_manager import AdminDatabaseManager
from backend.db.base import Base
from sqlalchemy.orm import Session


def initialize_new_admin_database(admin_id: int) -> bool:
    """
    Initialize a new database for a newly created admin.
    This should be called immediately after creating an admin account.
    Returns:
        bool: True if initialization successful, False otherwise
    """
    try:
        # Create the admin's folder structure
        AdminDatabaseManager.ensure_admin_subdirectories(admin_id)
        
        # Initialize the database with all tables
        engine = AdminDatabaseManager.initialize_admin_db(admin_id)
        
        return True
    except Exception as e:
        print(f"Error initializing admin database {admin_id}: {str(e)}")
        return False


def migrate_admin_database(admin_id: int) -> bool:
    """
    Run migrations on an existing admin database.
    Use this when you need to update the database schema.
    

    Returns:
        bool: True if migration successful, False otherwise
    """
    try:
        engine = AdminDatabaseManager.get_admin_engine(admin_id)
        Base.metadata.create_all(bind=engine)
        return True
    except Exception as e:
        print(f"Error migrating admin database {admin_id}: {str(e)}")
        return False


def get_admin_db_session(admin_id: int) -> Session:
    """
    Get a database session for a specific admin.
    Usage:
        db = get_admin_db_session(admin_id)
        residents = db.query(Resident).filter(Resident.admin_id == admin_id).all()
        db.close()
    """
    SessionLocal = AdminDatabaseManager.get_admin_session_local(admin_id)
    return SessionLocal()


def verify_admin_database_exists(admin_id: int) -> bool:
    """
    Check if an admin's database exists and is accessible.
    """
    try:
        engine = AdminDatabaseManager.get_admin_engine(admin_id)
        with engine.connect() as conn:
            conn.execute("SELECT 1")
        return True
    except Exception:
        return False


def list_all_admin_databases() -> dict:
    """
    List all existing admin databases.
    Returns:
        dict: Mapping of admin_id to database path
    """
    from backend.db.db_manager import DATABASE_BASE_PATH
    import os
    
    admin_dbs = {}
    if DATABASE_BASE_PATH.exists():
        for folder in os.listdir(DATABASE_BASE_PATH):
            if folder.startswith("admin_"):
                try:
                    admin_id = int(folder.split("_")[1])
                    db_path = DATABASE_BASE_PATH / folder / "sphere_care.db"
                    if db_path.exists():
                        admin_dbs[admin_id] = str(db_path)
                except (ValueError, IndexError):
                    continue
    
    return admin_dbs
