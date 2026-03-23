from typing import Generator
from sqlalchemy.orm import Session
from fastapi import Depends, HTTPException, status
from jose import JWTError, jwt

from backend.db.session import SessionLocal
from backend.db.db_manager import AdminDatabaseManager
from backend.core.config import SECRET_KEY, JWT_ALGORITHM


def get_db() -> Generator[Session, None, None]:
    """Get default database session (for master/admin registration)."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def get_admin_db(admin_id: int) -> Generator[Session, None, None]:
# Get admin-specific database session
    SessionLocal = AdminDatabaseManager.get_admin_session_local(admin_id)
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def get_current_admin_id(token: str = None) -> int:
    """
    Extract admin_id from JWT token or return from context.
    This should be implemented in your auth logic.
    """
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="No token provided"
        )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[JWT_ALGORITHM])
        admin_id: int = payload.get("admin_id")
        if admin_id is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid token"
            )
        return admin_id
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token"
        )


def get_admin_context_db(admin_id: int = Depends(get_current_admin_id)) -> Generator[Session, None, None]:
    """
    Get database session for the current admin from JWT token.
    Use this in protected routes to automatically get the admin's database.
    """
    SessionLocal = AdminDatabaseManager.get_admin_session_local(admin_id)
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

