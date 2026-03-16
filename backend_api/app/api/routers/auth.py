import re
import bcrypt
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from jose import jwt

from app.api.deps import get_db
from app import models, schemas
from app.core.config import SECRET_KEY, JWT_ALGORITHM, ACCESS_TOKEN_EXPIRE_MINUTES

router = APIRouter(prefix="/auth", tags=["Auth"])


def validate_password(password: str) -> None:
    errors = []

    if len(password.encode("utf-8")) > 72:
        errors.append("Password must be 72 characters or fewer.")
    if len(password) < 8:
        errors.append("Password must be at least 8 characters long.")
    if not re.search(r"[A-Z]", password):
        errors.append("Password must contain at least one uppercase letter.")
    if not re.search(r"[a-z]", password):
        errors.append("Password must contain at least one lowercase letter.")
    if not re.search(r"\d", password):
        errors.append("Password must contain at least one digit.")
    if not re.search(r"[!@#$%^&*()_+\-=\[\]{};':\"\\|,.<>\/?`~]", password):
        errors.append("Password must contain at least one special symbol (e.g. !@#$%).")

    if errors:
        raise HTTPException(status_code=400, detail=errors)


def hash_password(password: str) -> str:
    pw_bytes = password.encode("utf-8")
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(pw_bytes, salt).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))


def create_access_token(data: dict) -> str:
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=JWT_ALGORITHM)


@router.post("/register", response_model=schemas.TokenResponse)
def register(user: schemas.UserCreate, db: Session = Depends(get_db)):
    validate_password(user.password)

    existing_user = db.query(models.User).filter(models.User.email == user.email).first()
    if existing_user:
        raise HTTPException(status_code=400, detail="Email already registered")

    new_user = models.User(
        full_name=user.full_name,
        email=user.email,
        password_hash=hash_password(user.password),
        role=user.role
    )

    db.add(new_user)
    db.commit()
    db.refresh(new_user)

    # Auto-create a Staff record linked to this user
    if not db.query(models.Staff).filter(models.Staff.user_id == new_user.id).first():
        import random, string
        suffix = ''.join(random.choices(string.digits, k=4))
        staff_record = models.Staff(
            user_id=new_user.id,
            staff_id=f"ST-{suffix}",
            full_name=new_user.full_name,
            shift_time="TBD",
            assigned_unit="Unassigned",
            status="pending",
            role=new_user.role,
        )
        db.add(staff_record)
        db.commit()

    access_token = create_access_token({
        "sub": new_user.email,
        "role": new_user.role
    })

    return {
        "access_token": access_token,
        "user": new_user
    }


@router.get("/me", response_model=schemas.UserResponse)
def get_me(
    authorization: str = None,
    db: Session = Depends(get_db),
):
    """Get current logged-in user info from token."""
    from fastapi import Header
    return _get_current_user(authorization, db)


@router.patch("/me", response_model=schemas.UserResponse)
def update_me(
    updates: schemas.UserUpdate,
    authorization: str = None,
    db: Session = Depends(get_db),
):
    """Update current user's full_name."""
    user = _get_current_user(authorization, db)
    if updates.full_name:
        user.full_name = updates.full_name
        # Sync to linked staff record if exists
        staff = db.query(models.Staff).filter(models.Staff.user_id == user.id).first()
        if staff:
            staff.full_name = updates.full_name
    db.commit()
    db.refresh(user)
    return user


@router.post("/change-password")
def change_password(
    payload: schemas.ChangePasswordRequest,
    authorization: str = None,
    db: Session = Depends(get_db),
):
    """Change password — requires current password verification."""
    user = _get_current_user(authorization, db)
    if not verify_password(payload.current_password, user.password_hash):
        raise HTTPException(status_code=400, detail="Current password is incorrect.")
    validate_password(payload.new_password)
    user.password_hash = hash_password(payload.new_password)
    db.commit()
    return {"message": "Password updated successfully."}


def _get_current_user(authorization: str, db: Session) -> models.User:
    """Extract user from Bearer token."""
    from jose import JWTError
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated.")
    token = authorization.split(" ", 1)[1]
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[JWT_ALGORITHM])
        email: str = payload.get("sub")
        if not email:
            raise HTTPException(status_code=401, detail="Invalid token.")
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired token.")
    user = db.query(models.User).filter(models.User.email == email).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")
    return user


@router.post("/login", response_model=schemas.TokenResponse)
def login(payload: schemas.LoginRequest, db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.email == payload.email).first()

    if not user:
        raise HTTPException(status_code=401, detail="Invalid email or password")

    if not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    access_token = create_access_token({
        "sub": user.email,
        "role": user.role
    })

    return {
        "access_token": access_token,
        "user": user
    }
