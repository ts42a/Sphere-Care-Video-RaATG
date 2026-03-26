"""
Database initialization utilities.
"""

from backend.db.db_manager import AdminDatabaseManager


def initialize_new_admin(admin_id: int) -> bool:
    """
    Set up folder structure for a newly created admin.
    Tables are created centrally via create_all_tables().
    """
    try:
        AdminDatabaseManager.ensure_admin_subdirectories(admin_id)
        return True
    except Exception as e:
        print(f"Error initializing admin folders {admin_id}: {str(e)}")
        return False



