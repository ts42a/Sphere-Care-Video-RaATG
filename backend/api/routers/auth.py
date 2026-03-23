import re
import random
import bcrypt
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Header
from sqlalchemy.orm import Session
from jose import jwt, JWTError

from backend.api.deps import get_db
from backend import models, schemas
from backend.core.config import SECRET_KEY, JWT_ALGORITHM, ACCESS_TOKEN_EXPIRE_MINUTES

# ── Email (SMTP) ──────────────────────────────────────────────────────────────
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
import os

SMTP_HOST     = os.getenv("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT     = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER     = os.getenv("SMTP_USER", "")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
SMTP_FROM     = os.getenv("SMTP_FROM", SMTP_USER)

# ── In-memory OTP store  { user_id: {"code": "123456", "expires": datetime} }
_otp_store: dict[int, dict] = {}

OTP_EXPIRE_MINUTES = 10
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
    
    # Try to find user in User table first
    user = db.query(models.User).filter(models.User.email == email).first()
    if user:
        return user
    
    # Try to find admin in Admin table
    admin = db.query(models.Admin).filter(models.Admin.email == email).first()
    if admin:
        return admin
    
    raise HTTPException(status_code=404, detail={"msg": "User does not exist"})


def _generate_otp() -> str:
    return str(random.randint(10 ** (OTP_LENGTH - 1), 10 ** OTP_LENGTH - 1))


def _mask_email(email: str) -> str:
    try:
        local, domain = email.split("@", 1)
        masked = local[0] + "***"
        return f"{masked}@{domain}"
    except Exception:
        return "your registered email"


def _send_otp_email(to_email: str, otp_code: str) -> None:
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

@router.post("/admin/register", response_model=schemas.TokenResponse)
def register_admin(user: schemas.UserCreate, db: Session = Depends(get_db)):
    """Register a new admin/care center account (public endpoint)"""
    
    # email confirmation check (used by HTML web frontend)
    if user.email_confirmation and user.email.strip().lower() != user.email_confirmation.strip().lower():
        raise HTTPException(status_code=400, detail={"msg": "Emails do not match"})

    # retype_password check (used by HTML web frontend)
    if user.retype_password and user.password != user.retype_password:
        raise HTTPException(status_code=400, detail={"msg": "Passwords do not match"})

    validate_password(user.password)

    # Check in master database
    existing_admin = db.query(models.Admin).filter(models.Admin.email == user.email).first()
    if existing_admin:
        raise HTTPException(status_code=400, detail={"msg": "This email is already registered"})

    try:
        from backend.db.db_init import initialize_new_admin_database
        
        # Create admin in master database
        new_admin = models.Admin(
            full_name=user.full_name,
            email=user.email,
            password_hash=hash_password(user.password),
            organization_name=user.organization_name or "My Care Centre",
            phone=user.phone,
        )
        db.add(new_admin)
        db.commit()
        db.refresh(new_admin)
        admin_id = new_admin.id
        
        # Initialize admin's personal database
        success = initialize_new_admin_database(admin_id)
        if not success:
            # Rollback if database initialization fails
            db.delete(new_admin)
            db.commit()
            raise Exception("Failed to initialize admin database")
            
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail={"msg": "Admin registration failed", "error": str(e)})

    # Create JWT token with admin_id
    access_token = create_access_token({
        "sub": new_admin.email, 
        "admin_id": admin_id, 
        "role": "admin", 
        "user_id": admin_id
    })
    
    # Include center_id in response for admin
    admin_data = {
        "id": new_admin.id,
        "full_name": new_admin.full_name,
        "email": new_admin.email,
        "role": "admin",
        "created_at": new_admin.created_at.isoformat() if hasattr(new_admin, 'created_at') and new_admin.created_at else None,
        "organization_name": new_admin.organization_name,
        "center_id": f"CTR-{admin_id}"  # Generate and return center ID
    }
    
    return {"access_token": access_token, "token_type": "bearer", "user": admin_data}


@router.post("/staff/register")
def register_staff(user: schemas.UserCreate, admin_id: int = None, db: Session = Depends(get_db)):
    """Register a new staff member under an admin (public endpoint for staff signup)"""
    
    # admin_id is provided by staff during registration (e.g., CTR-123)
    if not admin_id:
        raise HTTPException(status_code=400, detail={"msg": "Center ID is required. Ask your admin for the Center ID."})

    # email confirmation check
    if user.email_confirmation and user.email.strip().lower() != user.email_confirmation.strip().lower():
        raise HTTPException(status_code=400, detail={"msg": "Emails do not match"})

    # retype_password check
    if user.retype_password and user.password != user.retype_password:
        raise HTTPException(status_code=400, detail={"msg": "Passwords do not match"})

    validate_password(user.password)

    try:
        from backend.db.db_manager import AdminDatabaseManager
        
        # Get admin-specific database session
        SessionLocal = AdminDatabaseManager.get_admin_session_local(admin_id)
        admin_db = SessionLocal()
        
        try:
            # Check if email already exists in this admin's database
            existing_user = admin_db.query(models.User).filter(models.User.email == user.email).first()
            if existing_user:
                raise HTTPException(status_code=400, detail={"msg": "This email is already registered"})
            
            # Create user with pending approval status
            new_user = models.User(
                admin_id=admin_id,
                full_name=user.full_name,
                email=user.email,
                password_hash=hash_password(user.password),
                role=user.role or "staff",
                phone=user.phone,
            )
            admin_db.add(new_user)
            admin_db.flush()
            
            # Create staff record in PENDING status
            if not admin_db.query(models.Staff).filter(models.Staff.user_id == new_user.id).first():
                import time, random as _r
                timestamp = str(int(time.time()))[-4:]
                random_suffix = str(_r.randint(1000, 9999))
                staff_record = models.Staff(
                    admin_id=admin_id,
                    user_id=new_user.id,
                    staff_id=f"ST-{timestamp}-{random_suffix}",
                    full_name=new_user.full_name,
                    shift_time="TBD",
                    assigned_unit="Unassigned",
                    status="pending",  # Initially pending
                    approval_status="pending",  # PENDING ADMIN APPROVAL
                    role=new_user.role,
                )
                admin_db.add(staff_record)
            
            admin_db.commit()
            admin_db.refresh(new_user)
        finally:
            admin_db.close()
            
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail={"msg": "Staff registration failed", "error": str(e)})

    # Return response indicating staff needs to wait for approval
    return {
        "access_token": None,
        "token_type": "pending",
        "user": {
            "full_name": new_user.full_name,
            "email": new_user.email,
            "message": "Registration successful! Your admin must approve your account before you can login. Please check your email for approval notification."
        }
    }


@router.post("/register", response_model=schemas.TokenResponse)
def register(user: schemas.UserCreate, authorization: str = Header(None), db: Session = Depends(get_db)):
    """
    Unified registration endpoint (backwards compatible).
    Routes to appropriate handler based on role:
    - admin: /admin/register (public)
    - staff: /staff/register (requires admin JWT)
    - client: creates mobile app user in master database
    """
    role = getattr(user, 'role', 'staff') or 'staff'
    
    if role == "admin":
        # Admin Registration - delegate to register_admin
        return register_admin(user, db)
    elif role == "staff":
        # Staff Registration - delegate to register_staff
        return register_staff(user, authorization, db)
    elif role == "client":
        # Mobile app client registration - create in master database as client user
        
        # email confirmation check
        if user.email_confirmation and user.email.strip().lower() != user.email_confirmation.strip().lower():
            raise HTTPException(status_code=400, detail={"msg": "Emails do not match"})

        # retype_password check
        if user.retype_password and user.password != user.retype_password:
            raise HTTPException(status_code=400, detail={"msg": "Passwords do not match"})

        validate_password(user.password)

        # For client registration, use admin_id = 1 (master/default admin)
        # In a real system, you might want to assign to the default care center
        admin_id = 1

        try:
            # Check if email already exists in master User table
            existing_user = db.query(models.User).filter(models.User.email == user.email).first()
            if existing_user:
                raise HTTPException(status_code=400, detail={"msg": "This email is already registered"})
            
            new_user = models.User(
                admin_id=admin_id,
                full_name=user.full_name,
                email=user.email,
                password_hash=hash_password(user.password),
                role="client",
                phone=user.phone,
            )
            db.add(new_user)
            db.commit()
            db.refresh(new_user)
            
        except HTTPException:
            raise
        except Exception as e:
            db.rollback()
            raise HTTPException(status_code=500, detail={"msg": "Client registration failed", "error": str(e)})

        # Create JWT token for client
        access_token = create_access_token({
            "sub": new_user.email,
            "admin_id": admin_id,
            "role": "client",
            "user_id": new_user.id
        })
        return {"access_token": access_token, "token_type": "bearer", "user": new_user}
    else:
        raise HTTPException(status_code=400, detail={"msg": f"Unknown role: {role}"})


@router.post("/login", response_model=schemas.TokenResponse)
def login(payload: schemas.LoginRequest, admin_id: int = None, db: Session = Depends(get_db)):
    """Login for both admin and staff. Staff should provide admin_id (center ID)"""
    
    # Try to find admin in Admin table first
    admin = db.query(models.Admin).filter(models.Admin.email == payload.email).first()
    
    if admin and verify_password(payload.password, admin.password_hash):
        # Admin found - create response with center_id
        access_token = create_access_token({"sub": admin.email, "admin_id": admin.id, "role": "admin", "user_id": admin.id})
        admin_data = {
            "id": admin.id,
            "full_name": admin.full_name,
            "email": admin.email,
            "role": "admin",
            "created_at": admin.created_at.isoformat() if admin.created_at else None,
            "organization_name": admin.organization_name,
            "center_id": f"CTR-{admin.id}"
        }
        return {"access_token": access_token, "token_type": "bearer", "user": admin_data}
    
    # Try staff login - requires admin_id (center ID)
    if admin_id:
        try:
            from backend.db.db_manager import AdminDatabaseManager
            
            SessionLocal = AdminDatabaseManager.get_admin_session_local(admin_id)
            admin_db = SessionLocal()
            
            try:
                staff_user = admin_db.query(models.User).filter(models.User.email == payload.email).first()
                
                if staff_user and verify_password(payload.password, staff_user.password_hash):
                    # Check approval status
                    staff_record = admin_db.query(models.Staff).filter(models.Staff.user_id == staff_user.id).first()
                    
                    if staff_record and staff_record.approval_status != "approved":
                        raise HTTPException(
                            status_code=403, 
                            detail={
                                "msg": f"Your account is pending admin approval. Status: {staff_record.approval_status}",
                                "approval_status": staff_record.approval_status
                            }
                        )
                    
                    # Staff is approved, allow login
                    access_token = create_access_token({
                        "sub": staff_user.email, 
                        "admin_id": admin_id, 
                        "role": staff_user.role, 
                        "user_id": staff_user.id
                    })
                    return {"access_token": access_token, "token_type": "bearer", "user": staff_user}
            finally:
                admin_db.close()
        except HTTPException:
            raise
        except Exception:
            pass  # Continue to "no match" error
    
    # No match found
    raise HTTPException(status_code=401, detail={"msg": "Incorrect email or password"})


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
    otp_code = _generate_otp()
    _otp_store[user.id] = {
        "code":    otp_code,
        "expires": datetime.utcnow() + timedelta(minutes=OTP_EXPIRE_MINUTES),
    }

    try:
        _send_otp_email(user.email, otp_code)
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail={"msg": str(e)})
    except Exception as e:
        raise HTTPException(status_code=500, detail={"msg": "Failed to send email", "error": str(e)})

    return {
        "msg":        "Verification code sent",
        "email_hint": _mask_email(user.email),
        "expires_in": OTP_EXPIRE_MINUTES * 60,
    }


# ── OTP: Step 2 — verify code + change password ──────────────────────────────

@router.post("/change-password")
def change_password(
    payload: schemas.ChangePasswordRequest,
    user: models.User = Depends(_get_current_user),
    db: Session = Depends(get_db)
):
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
