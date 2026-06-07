import re
import random
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Header
from sqlalchemy.orm import Session
from jose import jwt, JWTError

from backend.api.deps import get_db
from backend import models, schemas
from backend.core.config import SECRET_KEY, JWT_ALGORITHM, ACCESS_TOKEN_EXPIRE_MINUTES
from backend.core.security import get_password_hash, verify_password

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


def create_access_token(data: dict, expires_minutes: int = None) -> str:
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(minutes=expires_minutes or ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire, "iat": datetime.utcnow()})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=JWT_ALGORITHM)


def _get_current_user(authorization: str = Header(None), db: Session = Depends(get_db)):
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
        from backend.db.db_init import initialize_new_admin
        from backend.utils.id_generator import generate_unique_id
        
        # Create organization first (generate unique_code before flush to satisfy NOT NULL)
        org_code = generate_unique_id(db, models.Organization, "unique_code")
        new_org = models.Organization(
            unique_code=org_code,
            organization_name=user.organization_name or "My Care Centre",
            phone=user.phone,
            address_line_1=user.address,
            city=user.city,
            state=user.state,
            postal_code=user.postal_code,
            country=user.country,
        )
        db.add(new_org)
        db.flush()

        # Create admin linked to the organization
        admin_code = generate_unique_id(db, models.Admin, "unique_code")
        new_admin = models.Admin(
            organization_id=new_org.id,
            unique_code=admin_code,
            full_name=user.full_name,
            email=user.email,
            password_hash=get_password_hash(user.password),
            phone=user.phone,
        )
        db.add(new_admin)
        db.flush()
        db.commit()
        db.refresh(new_admin)
        db.refresh(new_org)
        admin_id = new_admin.id
        
        # Initialize admin upload folders
        success = initialize_new_admin(admin_id)
        if not success:
            db.delete(new_admin)
            db.delete(new_org)
            db.commit()
            raise Exception("Failed to initialize admin folders")
            
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
        "global_role": "admin",
        "created_at": new_admin.created_at.isoformat() if hasattr(new_admin, 'created_at') and new_admin.created_at else None,
        "organization_name": new_org.organization_name,
        "center_id": f"CTR-{new_org.unique_code}"
    }
    
    return {"access_token": access_token, "token_type": "bearer", "user": admin_data}


def _parse_center_id(raw: str | int | None, db: Session = None) -> int | None:
    """Resolve center code to organization_id.

    Accepts organization center codes (CTR-<org unique_code>), bare numeric org codes,
    admin account codes (ADM-<admin unique_code>) when staff were given the wrong label,
    and legacy numeric organization.id.
    """
    if raw is None:
        return None
    s = str(raw).strip().upper()
    if s.startswith("CTR-"):
        s = s[4:]
    elif s.startswith("ADM-"):
        s = s[4:]
    if not s:
        return None
    if db is not None:
        org = db.query(models.Organization).filter(models.Organization.unique_code == s).first()
        if org:
            return org.id
        # Staff portal used to show CTR-{admin.unique_code}; accept that code here.
        admin_row = db.query(models.Admin).filter(models.Admin.unique_code == s).first()
        if admin_row:
            return admin_row.organization_id
    try:
        legacy_id = int(s)
    except ValueError:
        return None
    if db is not None:
        org = db.query(models.Organization).filter(models.Organization.id == legacy_id).first()
        return org.id if org else None
    return legacy_id


def _try_staff_login(payload, db: Session):
    """Attempt staff login in the single database. Returns token response or None."""
    try:
        staff_user = db.query(models.User).filter(models.User.email == payload.email).first()
        if staff_user and verify_password(payload.password, staff_user.password_hash):
            staff_record = db.query(models.Staff).filter(models.Staff.user_id == staff_user.id).first()
            if staff_record and staff_record.approval_status != "approved":
                raise HTTPException(
                    status_code=403,
                    detail={
                        "msg": f"Your account is pending admin approval. Status: {staff_record.approval_status}",
                        "approval_status": staff_record.approval_status
                    }
                )
            admin_id = staff_record.admin_id if staff_record else 0
            access_token = create_access_token({
                "sub": staff_user.email,
                "admin_id": admin_id,
                "role": staff_user.global_role,
                "user_id": staff_user.id
            })
            return {"access_token": access_token, "token_type": "bearer", "user": staff_user}
    except HTTPException:
        raise
    except Exception:
        pass
    return None


@router.post("/staff/register")
def register_staff(user: schemas.UserCreate, admin_id: str | None = None, db: Session = Depends(get_db)):
    """Register a new staff member under an admin (public endpoint for staff signup)"""
    
    # admin_id is provided by staff during registration (e.g., CTR-123)
    # Resolve unique_code (e.g. 13018757 from CTR-13018757) to actual organization ID
    resolved_org_id = _parse_center_id(str(admin_id), db)
    if not resolved_org_id:
        raise HTTPException(status_code=400, detail={"msg": "Invalid Center ID. Please verify the Center ID with your admin."})

    # Find the admin who manages this organization (pick first active admin)
    org_admin = db.query(models.Admin).filter(
        models.Admin.organization_id == resolved_org_id,
        models.Admin.is_active == True,
    ).first()
    if not org_admin:
        raise HTTPException(status_code=404, detail={"msg": "No active admin found for this center."})
    resolved_admin_id = org_admin.id

    # email confirmation check
    if user.email_confirmation and user.email.strip().lower() != user.email_confirmation.strip().lower():
        raise HTTPException(status_code=400, detail={"msg": "Emails do not match"})

    # retype_password check
    if user.retype_password and user.password != user.retype_password:
        raise HTTPException(status_code=400, detail={"msg": "Passwords do not match"})

    validate_password(user.password)

    try:
        # Check if email already exists
        existing_user = db.query(models.User).filter(models.User.email == user.email).first()
        if existing_user:
            raise HTTPException(status_code=400, detail={"msg": "This email is already registered"})
        
        from backend.utils.id_generator import generate_unique_id

        # Create user with pending approval status (generate unique_code before flush)
        user_code = generate_unique_id(db, models.User, "unique_code")
        new_user = models.User(
            unique_code=user_code,
            full_name=user.full_name,
            email=user.email,
            password_hash=get_password_hash(user.password),
            global_role=user.role or "staff",
            phone=user.phone,
        )
        db.add(new_user)
        db.flush()
        
        # Create staff record in PENDING status
        if not db.query(models.Staff).filter(models.Staff.user_id == new_user.id).first():
            staff_code = generate_unique_id(db, models.Staff, "staff_code")
            staff_record = models.Staff(
                admin_id=resolved_admin_id,
                user_id=new_user.id,
                staff_code=f"STF-{staff_code}",
                full_name=new_user.full_name,
                assigned_unit="Unassigned",
                status="pending",
                approval_status="pending",
                role=new_user.global_role,
            )
            db.add(staff_record)
        
        db.commit()
        db.refresh(new_user)
            
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
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


@router.post("/register")
def register(user: schemas.UserCreate, db: Session = Depends(get_db)):
    """
    Unified registration endpoint (backwards compatible).
    Routes to appropriate handler based on role:
    - admin: /admin/register (public)
    - staff: /staff/register (requires center_id)
    - client: creates mobile app user in master database
    """
    role = getattr(user, 'role', 'staff') or 'staff'
    
    if role == "admin":
        # Admin Registration - delegate to register_admin
        return register_admin(user, db)
    elif role == "staff":
        # Staff Registration - parse center_id from payload
        parsed_id = _parse_center_id(user.center_id, db) if user.center_id else None
        return register_staff(user, parsed_id, db)
    elif role == "client":
        # Mobile app client registration - create in master database as client user
        
        # email confirmation check
        if user.email_confirmation and user.email.strip().lower() != user.email_confirmation.strip().lower():
            raise HTTPException(status_code=400, detail={"msg": "Emails do not match"})

        # retype_password check
        if user.retype_password and user.password != user.retype_password:
            raise HTTPException(status_code=400, detail={"msg": "Passwords do not match"})

        validate_password(user.password)

        # Client users are not assigned to any admin initially
        admin_id = 0

        try:
            # Check if email already exists in master User table
            existing_user = db.query(models.User).filter(models.User.email == user.email).first()
            if existing_user:
                raise HTTPException(status_code=400, detail={"msg": "This email is already registered"})
            
            from backend.utils.id_generator import generate_unique_id

            # Generate unique_code before flush to satisfy NOT NULL
            client_code = generate_unique_id(db, models.User, "unique_code")
            now = datetime.now(timezone.utc)
            new_user = models.User(
                unique_code=client_code,
                full_name=user.full_name,
                email=user.email,
                password_hash=get_password_hash(user.password),
                global_role="client",
                phone=user.phone,
                date_of_birth=user.date_of_birth,
                gender=user.gender,
                preferred_name=user.preferred_name,
                address_line_1=user.address_line_1 or user.address,
                address_line_2=user.address_line_2,
                city=user.city,
                state=user.state,
                postal_code=user.postal_code,
                country=user.country,
                registration_completed_by=user.registration_completed_by,
                registration_assisted_by_name=user.registration_assisted_by_name,
                terms_accepted_at=now if user.accept_terms else None,
                privacy_accepted_at=now if user.accept_privacy else None,
                sms_notifications=bool(user.sms_consent),
            )
            db.add(new_user)
            db.flush()

            if user.guardian:
                guardian = models.ClientGuardian(
                    user_id=new_user.id,
                    full_name=user.guardian.full_name,
                    relationship=user.guardian.relationship,
                    guardian_type=user.guardian.guardian_type,
                    phone=user.guardian.phone,
                    email=user.guardian.email,
                    address_line_1=user.guardian.address_line_1,
                    address_line_2=user.guardian.address_line_2,
                    city=user.guardian.city,
                    state=user.guardian.state,
                    postal_code=user.guardian.postal_code,
                    country=user.guardian.country,
                )
                db.add(guardian)

            if user.emergency_contacts:
                for index, contact in enumerate(user.emergency_contacts, start=1):
                    emergency_contact = models.ClientEmergencyContact(
                        user_id=new_user.id,
                        full_name=contact.full_name,
                        relationship=contact.relationship,
                        phone=contact.phone,
                        alternate_phone=contact.alternate_phone,
                        email=contact.email,
                        priority_order=index,
                    )
                    db.add(emergency_contact)

            # If center_id provided, create a join request
            if user.center_id:
                center_org_id = _parse_center_id(user.center_id, db)
                if center_org_id:
                    join_req = models.CenterJoinRequest(
                        user_id=new_user.id,
                        organization_id=center_org_id,
                        membership_role="client",
                        status="pending",
                        initiated_by="user",
                    )
                    db.add(join_req)

            db.commit()
            db.refresh(new_user)
            
        except HTTPException:
            raise
        except Exception as e:
            db.rollback()
            raise HTTPException(status_code=500, detail={"msg": "Client registration failed", "error": str(e)})

        access_token = create_access_token({
            "sub": new_user.email,
            "admin_id": 0,
            "role": "client",
            "user_id": new_user.id
        })
        return {"access_token": access_token, "token_type": "bearer", "user": new_user}
    else:
        raise HTTPException(status_code=400, detail={"msg": f"Unknown role: {role}"})


@router.post("/login", response_model=schemas.TokenResponse)
def login(payload: schemas.LoginRequest, admin_id: str = None, db: Session = Depends(get_db)):
    """Login for admin, staff, and client users."""
    
    # Try to find admin in Admin table first
    admin = db.query(models.Admin).filter(models.Admin.email == payload.email).first()
    
    if admin and verify_password(payload.password, admin.password_hash):
        # Admin found - look up organization for center info
        org = db.query(models.Organization).filter(models.Organization.id == admin.organization_id).first()
        access_token = create_access_token({"sub": admin.email, "admin_id": admin.id, "role": "admin", "user_id": admin.id})
        admin_data = {
            "id": admin.id,
            "full_name": admin.full_name,
            "email": admin.email,
            "global_role": "admin",
            "role": "admin",
            "created_at": admin.created_at.isoformat() if admin.created_at else None,
            "organization_name": org.organization_name if org else "",
            "center_id": f"CTR-{org.unique_code}" if org else f"CTR-{admin.unique_code or admin.id}"
        }
        return {"access_token": access_token, "token_type": "bearer", "user": admin_data}

    # Try user login (client, staff, etc.) in single database
    master_user = db.query(models.User).filter(models.User.email == payload.email).first()
    if master_user and verify_password(payload.password, master_user.password_hash):
        resolved_admin_id = 0
        resolved_resident_id = None

        if master_user.global_role == "staff":
            staff_record = db.query(models.Staff).filter(models.Staff.user_id == master_user.id).first()
            if staff_record and staff_record.approval_status != "approved":
                raise HTTPException(
                    status_code=403,
                    detail={
                        "msg": f"Your account is pending admin approval. Status: {staff_record.approval_status}",
                        "approval_status": staff_record.approval_status
                    }
                )
            resolved_admin_id = staff_record.admin_id if staff_record else 0

        elif master_user.global_role == "client":
            resident = db.query(models.Resident).filter(
                models.Resident.client_user_id == master_user.id,
                models.Resident.is_deleted == False
            ).first()

            if resident:
                resolved_admin_id = resident.admin_id
                resolved_resident_id = resident.id

        access_token = create_access_token({
            "sub": master_user.email,
            "admin_id": resolved_admin_id,
            "role": master_user.global_role,
            "user_id": master_user.id,
            "resident_id": resolved_resident_id,
        })
        return {"access_token": access_token, "token_type": "bearer", "user": master_user}

    # No match found
    raise HTTPException(status_code=401, detail={"msg": "Incorrect email or password"})


@router.get("/me", response_model=schemas.UserResponse)
def get_me(user=Depends(_get_current_user), db: Session = Depends(get_db)):
    if isinstance(user, models.Admin):
        org = db.query(models.Organization).filter(models.Organization.id == user.organization_id).first()
        return schemas.UserResponse(
            id=user.id,
            full_name=user.full_name,
            email=user.email,
            global_role=user.role,
            phone=user.phone,
            unique_code=user.unique_code,
            is_active=user.is_active,
            last_login_at=user.last_login_at,
            created_at=user.created_at,
            center_id=f"CTR-{org.unique_code}" if org else None,
            organization_name=org.organization_name if org else None,
        )
    return user


@router.patch("/me", response_model=schemas.UserResponse)
def update_me(
    updates: schemas.UserUpdate,
    user=Depends(_get_current_user),
    db: Session = Depends(get_db)
):
    is_admin = isinstance(user, models.Admin)
    try:
        if updates.full_name:
            user.full_name = updates.full_name
            if not is_admin:
                staff = db.query(models.Staff).filter(models.Staff.user_id == user.id).first()
                if staff:
                    staff.full_name = updates.full_name
        if updates.email and updates.email != user.email:
            # Check both tables for email conflict
            if db.query(models.User).filter(models.User.email == updates.email).first():
                raise HTTPException(status_code=400, detail={"msg": "This email is already in use"})
            if db.query(models.Admin).filter(models.Admin.email == updates.email).first():
                raise HTTPException(status_code=400, detail={"msg": "This email is already in use"})
            user.email = updates.email
        if updates.phone is not None:
            user.phone = updates.phone
        db.commit()
        db.refresh(user)
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail={"msg": "Update failed", "error": str(e)})
    if is_admin:
        org = db.query(models.Organization).filter(models.Organization.id == user.organization_id).first()
        return schemas.UserResponse(
            id=user.id,
            full_name=user.full_name,
            email=user.email,
            global_role=user.role,
            phone=user.phone,
            unique_code=user.unique_code,
            is_active=user.is_active,
            last_login_at=user.last_login_at,
            created_at=user.created_at,
            center_id=f"CTR-{org.unique_code}" if org else None,
            organization_name=org.organization_name if org else None,
        )
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
        user.password_hash = get_password_hash(payload.new_password)
        db.commit()
        _otp_store.pop(user.id, None)
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail={"msg": "Password change failed", "error": str(e)})

    return {"msg": "Password changed successfully"}
