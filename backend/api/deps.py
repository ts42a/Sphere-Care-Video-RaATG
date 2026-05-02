from typing import Generator
from sqlalchemy.orm import Session
from fastapi import Depends, HTTPException, status, Header
from jose import JWTError, jwt

from backend.db.session import SessionLocal
from backend.core.config import SECRET_KEY, JWT_ALGORITHM
from backend import models


def get_db() -> Generator[Session, None, None]:
    """Get database session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# Keep for backward compatibility — all tables are now in a single PG database.
get_admin_db = get_db


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
    All tables are now in a single PG database.
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def get_current_auth_context(
    authorization: str = Header(None),
    db: Session = Depends(get_db),
) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="No token provided"
        )

    token = authorization.split(" ", 1)[1]

    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[JWT_ALGORITHM])
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token"
        )

    auth = {
        "email": payload.get("sub"),
        "admin_id": payload.get("admin_id"),
        "user_id": payload.get("user_id"),
        "resident_id": payload.get("resident_id"),
        "role": payload.get("role"),
    }

    # Client tokens can be issued before an admin invitation is accepted.
    # Resolve approved membership from DB so /messages/* works immediately
    # without requiring the client to log out and log back in.
    if auth.get("role") == "client" and auth.get("user_id") and not auth.get("admin_id"):
        membership = db.query(models.CenterMembership).filter(
            models.CenterMembership.user_id == int(auth["user_id"]),
            models.CenterMembership.status == "approved",
        ).order_by(
            models.CenterMembership.approved_at.desc().nullslast(),
            models.CenterMembership.id.desc(),
        ).first()

        if membership:
            admin = db.query(models.Admin).filter(
                models.Admin.organization_id == membership.organization_id,
                models.Admin.is_active == True,
            ).first()
            if admin:
                auth["admin_id"] = int(admin.id)
                resident = db.query(models.Resident).filter(
                    models.Resident.admin_id == admin.id,
                    models.Resident.client_user_id == int(auth["user_id"]),
                    models.Resident.status == "active",
                ).first()
                if resident:
                    auth["resident_id"] = int(resident.id)

    return auth