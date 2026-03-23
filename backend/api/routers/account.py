from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from backend.api.deps import get_db
from backend import models
from backend.api.routers.auth import _get_current_user

router = APIRouter(prefix="/account", tags=["Account"])


# Helper

def _user_to_dict(user: models.User):
    return {
        "id": user.id,
        "full_name": user.full_name,
        "email": user.email,
        "phone": getattr(user, "phone", None),
        "role": getattr(user, "role", None),
        "department": getattr(user, "department", None),
        "license_no": getattr(user, "license_no", None),
        "email_notifications": bool(getattr(user, "email_notifications", False)),
        "push_notifications": bool(getattr(user, "push_notifications", False)),
        "dark_mode": bool(getattr(user, "dark_mode", False)),
        "biometric_lock": bool(getattr(user, "biometric_lock", False)),
    }


@router.put("/me")
def update_account_me(
    payload: dict,
    user: models.User = Depends(_get_current_user),
    db: Session = Depends(get_db),
):
    try:
        if "full_name" in payload and payload["full_name"]:
            user.full_name = payload["full_name"].strip()

            staff = db.query(models.Staff).filter(models.Staff.user_id == user.id).first()
            if staff:
                staff.full_name = user.full_name

        if "email" in payload and payload["email"]:
            new_email = payload["email"].strip().lower()
            if new_email != user.email:
                existing = db.query(models.User).filter(models.User.email == new_email).first()
                if existing:
                    raise HTTPException(status_code=400, detail={"msg": "This email is already in use"})
                user.email = new_email

        if hasattr(user, "phone") and "phone" in payload:
            user.phone = (payload.get("phone") or None)

        if hasattr(user, "department") and "department" in payload:
            user.department = (payload.get("department") or None)

        if hasattr(user, "license_no") and "license_no" in payload:
            user.license_no = (payload.get("license_no") or None)

        db.commit()
        db.refresh(user)
        return _user_to_dict(user)

    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail={"msg": "Account update failed", "error": str(e)})


@router.put("/preferences")
def update_preferences(
    payload: dict,
    user: models.User = Depends(_get_current_user),
    db: Session = Depends(get_db),
):
    try:
        if hasattr(user, "email_notifications"):
            user.email_notifications = bool(payload.get("email_notifications", False))

        if hasattr(user, "push_notifications"):
            user.push_notifications = bool(payload.get("push_notifications", False))

        if hasattr(user, "dark_mode"):
            user.dark_mode = bool(payload.get("dark_mode", False))

        if hasattr(user, "biometric_lock"):
            user.biometric_lock = bool(payload.get("biometric_lock", False))

        db.commit()
        db.refresh(user)
        return {
            "msg": "Preferences updated successfully",
            "user": _user_to_dict(user)
        }

    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail={"msg": "Preferences update failed", "error": str(e)})


@router.post("/forgot-password")
def forgot_password_request(
    payload: dict,
    db: Session = Depends(get_db),
):
    email = (payload.get("email") or "").strip().lower()
    if not email:
        raise HTTPException(status_code=400, detail={"msg": "Email is required"})

    user = db.query(models.User).filter(models.User.email == email).first()

    # Keep message generic for security
    if not user:
        return {"msg": "If that email exists, a reset request has been recorded"}

    return {"msg": "If that email exists, a reset request has been recorded"}


@router.post("/logout")
def logout():
    return {"msg": "Logged out successfully"}