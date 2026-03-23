import os
from pathlib import Path
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from backend.db.base import Base

DATABASE_BASE_PATH = Path(__file__).parent.parent.parent / "databases"


class AdminDatabaseManager:
    """
    Manages separate databases for each admin/care center.
    Each admin gets their own SQLite database in a dedicated folder.
    """

    @staticmethod
    def ensure_admin_db_folder(admin_id: int) -> Path:
        """
        Create admin-specific database folder if it doesn't exist.
        Returns the path to the admin's database folder.
        """
        admin_folder = DATABASE_BASE_PATH / f"admin_{admin_id}"
        admin_folder.mkdir(parents=True, exist_ok=True)
        return admin_folder

    @staticmethod
    def get_admin_db_path(admin_id: int) -> str:
        """
        Get the SQLite database file path for a specific admin.
        Format: databases/admin_{admin_id}/sphere_care.db
        """
        admin_folder = AdminDatabaseManager.ensure_admin_db_folder(admin_id)
        db_path = admin_folder / "sphere_care.db"
        return f"sqlite:///{db_path}"

    @staticmethod
    def get_admin_engine(admin_id: int):
        """
        Create a SQLAlchemy engine for the admin's database.
        """
        db_url = AdminDatabaseManager.get_admin_db_path(admin_id)
        connect_args = {"check_same_thread": False}
        engine = create_engine(db_url, connect_args=connect_args)
        return engine

    @staticmethod
    def get_admin_session_local(admin_id: int):
        """
        Create a SessionLocal factory for the admin's database.
        """
        engine = AdminDatabaseManager.get_admin_engine(admin_id)
        SessionLocal = sessionmaker(
            autocommit=False, autoflush=False, bind=engine
        )
        return SessionLocal

    @staticmethod
    def initialize_admin_db(admin_id: int):
        """
        Initialize a new admin database with all tables.
        Call this after creating a new admin account.
        """
        engine = AdminDatabaseManager.get_admin_engine(admin_id)
        Base.metadata.create_all(bind=engine)
        return engine

    @staticmethod
    def get_admin_folder_structure(admin_id: int) -> dict:
        """
        Get the folder structure for an admin's data storage.
        """
        admin_folder = AdminDatabaseManager.ensure_admin_db_folder(admin_id)
        return {
            "base": admin_folder,
            "db": admin_folder / "sphere_care.db",
            "uploads": admin_folder / "uploads",
            "documents": admin_folder / "uploads" / "documents",
            "images": admin_folder / "uploads" / "images",
            "videos": admin_folder / "uploads" / "videos"
        }

    @staticmethod
    def ensure_admin_subdirectories(admin_id: int):
        """
        Create all subdirectories for an admin (uploads, documents, images, videos).
        """
        folders = AdminDatabaseManager.get_admin_folder_structure(admin_id)
        for folder_path in folders.values():
            if folder_path != folders["base"] and folder_path != folders["db"]:
                folder_path.mkdir(parents=True, exist_ok=True)
