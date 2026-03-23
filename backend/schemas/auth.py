from pydantic import BaseModel, EmailStr
from typing import Optional

from backend.schemas.user import UserResponse


class UserCreate(BaseModel):
    full_name: str
    email: EmailStr
    password: str
    phone: Optional[str] = None
    role: str = "staff"
    organization_name: Optional[str] = None  # For admin registration
    email_confirmation: Optional[str] = None  # Used by web frontend
    retype_password: Optional[str] = None  # Used by web frontend


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