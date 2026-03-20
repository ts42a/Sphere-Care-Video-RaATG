import re
import random
import bcrypt
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Header
from sqlalchemy.orm import Session
from jose import jwt, JWTError

from app.api.deps import get_db
from app import models, schemas
from app.core.config import SECRET_KEY, JWT_ALGORITHM, ACCESS_TOKEN_EXPIRE_MINUTES

# ── Email (SMTP) ──────────────────────────────────────────────────────────────
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
import os

SMTP_HOST     = os.getenv("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT     = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER     = os.getenv("SMTP_USER", "")        # your Gmail / SMTP address
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")    # app password
SMTP_FROM     = os.getenv("SMTP_FROM", SMTP_USER)

# ── In-memory OTP store  { user_id: {"code": "123456", "expires": datetime} }
# For production, replace with Redis or a DB table.
_otp_store: dict[int, dict] = {}

OTP_EXPIRE_MINUTES = 10   # OTP valid for 10 minutes
OTP_LENGTH         = 6

router = APIRouter(prefix="/auth", tags=["Auth"])


# ═════════════════════════════════════════════════════════════════════════════
# HELPERS
# ═════════════════════════════════════════════════════════════════════════════

def validate_password(password: str) -> None:
    errors = []
    pw_utf8_length = len(password.encode("utf-8"))
    if pw_utf8_length > 72:
        errors.append("Password length (UTF-8 encoded) cannot exceed 72 characters")
    if len(password) < 8:
        errors.append("Password length cannot be less than 8 characters")
    if not re.search(r"[A-Z]", password):
        errors.append("Password must contain at least 1 uppercase letter (A-Z)")
    if not re.search(r"[a-z]", password):
        errors.append("Password must contain at least 1 lowercase letter (a-z)")
    if not re.search(r"\d", password):
        errors.append("Password must contain at least 1 number (0-9)")
    if not re.search(r"[!@#$%^&*()_\-+=\\\[\]{};:'\"|,.<>/?`~·！@#￥%……&*（）—+={}【】；：""'。，、？]", password):
        errors.append("Password must contain at least 1 special symbol (e.g., !@#$%^&*)")
    if errors:
        raise HTTPException(status_code=400, detail={"msg": "Password validation failed", "errors": errors})


def hash_password(password: str) -> str:
    salt = bcrypt.gensalt(rounds=14)
    return bcrypt.hashpw(password.encode("utf-8"), salt).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
    except Exception:
        return False


def create_access_token(data: dict, expires_minutes: int = None) -> str:
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(minutes=expires_minutes or ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire, "iat": datetime.utcnow()})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=JWT_ALGORITHM)


def _get_current_user(authorization: str = Header(None), db: Session = Depends(get_db)) -> models.User:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail={"msg": "Unauthenticated"})
    token = authorization.split(" ", 1)[1]
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[JWT_ALGORITHM], options={"verify_exp": True})
        email: str = payload.get("sub")
        if not email:
            raise HTTPException(status_code=401, detail={"msg": "Invalid Token"})
    except JWTError as e:
        raise HTTPException(status_code=401, detail={"msg": "Token is invalid or expired", "error": str(e)})
    user = db.query(models.User).filter(models.User.email == email).first()
    if not user:
        raise HTTPException(status_code=404, detail={"msg": "User does not exist"})
    return user


def _generate_otp() -> str:
    return str(random.randint(10 ** (OTP_LENGTH - 1), 10 ** OTP_LENGTH - 1))


def _mask_email(email: str) -> str:
    """Return j***@gmail.com style hint."""
    try:
        local, domain = email.split("@", 1)
        masked = local[0] + "***"
        return f"{masked}@{domain}"
    except Exception:
        return "your registered email"


def _send_otp_email(to_email: str, otp_code: str) -> None:
    """Send OTP via SMTP. Raises RuntimeError on failure."""
    if not SMTP_USER or not SMTP_PASSWORD:
        raise RuntimeError("SMTP credentials not configured. Set SMTP_USER and SMTP_PASSWORD env vars.")

    subject = "Sphere Care — Your Password Change Verification Code"
    body = f"""
Hello,

You requested a password change on Sphere Care.

Your verification code is:

    {otp_code}

This code will expire in {OTP_EXPIRE_MINUTES} minutes.

If you did not request this, please ignore this email or contact your administrator.

— Sphere Care Security Team
"""
    msg = MIMEMultipart()
    msg["From"]    = SMTP_FROM
    msg["To"]      = to_email
    msg["Subject"] = subject
    msg.attach(MIMEText(body, "plain"))

    with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:
        server.ehlo()
        server.starttls()
        server.login(SMTP_USER, SMTP_PASSWORD)
        server.sendmail(SMTP_FROM, to_email, msg.as_string())


# ═════════════════════════════════════════════════════════════════════════════
# ROUTES
# ═════════════════════════════════════════════════════════════════════════════

@router.post("/register", response_model=schemas.TokenResponse)
def register(user: schemas.UserCreate, db: Session = Depends(get_db)):
    validate_password(user.password)
    existing_user = db.query(models.User).filter(models.User.email == user.email).first()
    if existing_user:
        raise HTTPException(status_code=400, detail={"msg": "This email is already registered"})
    try:
        new_user = models.User(
            full_name=user.full_name,
            email=user.email,
            password_hash=hash_password(user.password),
            role=user.role
        )
        db.add(new_user)
        db.flush()
        if not db.query(models.Staff).filter(models.Staff.user_id == new_user.id).first():
            import time, random as _r
            timestamp = str(int(time.time()))[-4:]
            random_suffix = str(_r.randint(1000, 9999))
            staff_record = models.Staff(
                user_id=new_user.id,
                staff_id=f"ST-{timestamp}-{random_suffix}",
                full_name=new_user.full_name,
                shift_time="TBD",
                assigned_unit="Unassigned",
                status="pending",
                role=new_user.role,
            )
            db.add(staff_record)
        db.commit()
        db.refresh(new_user)
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail={"msg": "Registration failed", "error": str(e)})

    access_token = create_access_token({"sub": new_user.email, "role": new_user.role, "user_id": new_user.id})
    return {"access_token": access_token, "token_type": "bearer", "user": new_user}


@router.post("/login", response_model=schemas.TokenResponse)
def login(payload: schemas.LoginRequest, db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.email == payload.email).first()
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail={"msg": "Incorrect email or password"})
    access_token = create_access_token({"sub": user.email, "role": user.role, "user_id": user.id})
    return {"access_token": access_token, "token_type": "bearer", "user": user}


@router.get("/me", response_model=schemas.UserResponse)
def get_me(user: models.User = Depends(_get_current_user)):
    return user


@router.patch("/me", response_model=schemas.UserResponse)
def update_me(
    updates: schemas.UserUpdate,
    user: models.User = Depends(_get_current_user),
    db: Session = Depends(get_db)
):
    try:
        if updates.full_name:
            user.full_name = updates.full_name
            staff = db.query(models.Staff).filter(models.Staff.user_id == user.id).first()
            if staff:
                staff.full_name = updates.full_name
        if hasattr(updates, "email") and updates.email:
            if updates.email != user.email:
                if db.query(models.User).filter(models.User.email == updates.email).first():
                    raise HTTPException(status_code=400, detail={"msg": "This email is already in use"})
                user.email = updates.email
        db.commit()
        db.refresh(user)
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail={"msg": "Update failed", "error": str(e)})
    return user


# ── OTP: Step 1 — request a code ─────────────────────────────────────────────

@router.post("/request-otp")
def request_otp(user: models.User = Depends(_get_current_user)):
    """
    Generate a 6-digit OTP, store it server-side, and email it to the user.
    Returns a masked email hint so the frontend can show "sent to j***@gmail.com".
    """
    otp_code = _generate_otp()
    _otp_store[user.id] = {
        "code":    otp_code,
        "expires": datetime.utcnow() + timedelta(minutes=OTP_EXPIRE_MINUTES),
    }

    try:
        _send_otp_email(user.email, otp_code)
    except RuntimeError as e:
        # SMTP not configured — surface a clear error
        raise HTTPException(status_code=503, detail={"msg": str(e)})
    except Exception as e:
        raise HTTPException(status_code=500, detail={"msg": "Failed to send email", "error": str(e)})

    return {
        "msg":        "Verification code sent",
        "email_hint": _mask_email(user.email),
        "expires_in": OTP_EXPIRE_MINUTES * 60,  # seconds
    }


# ── OTP: Step 2 — verify code + change password ──────────────────────────────

@router.post("/change-password")
def change_password(
    payload: schemas.ChangePasswordRequest,
    user: models.User = Depends(_get_current_user),
    db: Session = Depends(get_db)
):
    """
    Verify OTP code, then change the password.
    Expects: { current_password, new_password, otp_code }
    """
    # 1. Verify current password
    if not verify_password(payload.current_password, user.password_hash):
        raise HTTPException(status_code=400, detail={"msg": "Incorrect current password"})

    # 2. Check OTP exists for this user
    stored = _otp_store.get(user.id)
    if not stored:
        raise HTTPException(status_code=400, detail={"msg": "No verification code found. Please request a new one."})

    # 3. Check expiry
    if datetime.utcnow() > stored["expires"]:
        _otp_store.pop(user.id, None)
        raise HTTPException(status_code=400, detail={"msg": "Verification code has expired. Please request a new one."})

    # 4. Check code matches
    if stored["code"] != str(payload.otp_code).strip():
        raise HTTPException(status_code=400, detail={"msg": "Incorrect verification code"})

    # 5. New password must differ from old
    if verify_password(payload.new_password, user.password_hash):
        raise HTTPException(status_code=400, detail={"msg": "New password cannot be the same as the old password"})

    # 6. Validate new password rules
    validate_password(payload.new_password)

    # 7. Save new password + clear OTP
    try:
        user.password_hash = hash_password(payload.new_password)
        db.commit()
        _otp_store.pop(user.id, None)
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail={"msg": "Password change failed", "error": str(e)})

    return {"msg": "Password changed successfully"}