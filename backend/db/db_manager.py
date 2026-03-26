import os
from pathlib import Path

from backend.db.base import Base
from backend.db.session import engine

DATABASE_BASE_PATH = Path(__file__).parent.parent.parent / "databases"


class AdminDatabaseManager:
    """
    Manages per-admin upload directories.
    All data now lives in a single PostgreSQL database;
    separate SQLite files are no longer used.
    """

    # -- Upload directory helpers (still per-admin) ---------

    @staticmethod
    def ensure_admin_folder(admin_id: int) -> Path:
        admin_folder = DATABASE_BASE_PATH / f"admin_{admin_id}"
        admin_folder.mkdir(parents=True, exist_ok=True)
        return admin_folder

    @staticmethod
    def get_admin_folder_structure(admin_id: int) -> dict:
        admin_folder = AdminDatabaseManager.ensure_admin_folder(admin_id)
        return {
            "base": admin_folder,
            "uploads": admin_folder / "uploads",
            "documents": admin_folder / "uploads" / "documents",
            "images": admin_folder / "uploads" / "images",
            "videos": admin_folder / "uploads" / "videos",
        }

    @staticmethod
    def ensure_admin_subdirectories(admin_id: int):
        folders = AdminDatabaseManager.get_admin_folder_structure(admin_id)
        for key, folder_path in folders.items():
            if key != "base":
                folder_path.mkdir(parents=True, exist_ok=True)

    # -- Database helpers (single PG database) --------------

    @staticmethod
    def initialize_admin_db(admin_id: int):
        """Create upload directories for a new admin. DB tables are shared."""
        AdminDatabaseManager.ensure_admin_subdirectories(admin_id)

    @staticmethod
    def create_all_tables():
        """Create all tables in the single PostgreSQL database."""
        Base.metadata.create_all(bind=engine)
