from pydantic import BaseModel, EmailStr
from typing import Optional
from backend.schemas.user import UserResponse


class ClientGuardianCreate(BaseModel):
    full_name: str
    relationship: Optional[str] = None
    guardian_type: str
    phone: Optional[str] = None
    email: Optional[EmailStr] = None
    address_line_1: Optional[str] = None
    address_line_2: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    postal_code: Optional[str] = None
    country: Optional[str] = None

class ClientEmergencyContactCreate(BaseModel):
    full_name: str
    relationship: Optional[str] = None
    phone: str
    alternate_phone: Optional[str] = None
    email: Optional[EmailStr] = None

class UserCreate(BaseModel):
    full_name: str
    email: EmailStr
    password: str
    phone: Optional[str] = None
    role: str = "staff"  # Maps to global_role on user model
    organization_name: Optional[str] = None  # For admin registration
    email_confirmation: Optional[str] = None  # Used by web frontend
    retype_password: Optional[str] = None  # Used by web frontend
    date_of_birth: Optional[str] = None  # YYYY-MM-DD
    gender: Optional[str] = None
    preferred_name: Optional[str] = None
    # Admin address fields
    address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    postal_code: Optional[str] = None
    country: Optional[str] = None
    # Client residential address (line-based)
    address_line_1: Optional[str] = None
    address_line_2: Optional[str] = None
    # Client optional center join
    center_id: Optional[str] = None
    # Client multi-step registration
    registration_completed_by: Optional[str] = None
    registration_assisted_by_name: Optional[str] = None
    accept_terms: Optional[bool] = None
    accept_privacy: Optional[bool] = None
    sms_consent: Optional[bool] = None
    guardian: Optional[ClientGuardianCreate] = None
    emergency_contacts: Optional[list[ClientEmergencyContactCreate]] = None


class AdminRegisterResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: dict  # Admin info

class LoginRequest(BaseModel):
    email: EmailStr
    password: str

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse

class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str
    otp_code: str

TokenResponse.model_rebuild()