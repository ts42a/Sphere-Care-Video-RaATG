from datetime import date, datetime
from typing import Optional

from pydantic import BaseModel, EmailStr, computed_field


class UserResponse(BaseModel):
    id: int
    full_name: str
    email: EmailStr
    global_role: str
    phone: Optional[str] = None

    @computed_field
    @property
    def role(self) -> str:
        """Alias so frontend code that reads 'role' works without normalization."""
        return self.global_role
    date_of_birth: Optional[date] = None
    gender: Optional[str] = None
    unique_code: Optional[str] = None
    center_id: Optional[str] = None
    organization_name: Optional[str] = None
    profile_photo_url: Optional[str] = None
    is_active: bool = True
    last_login_at: Optional[datetime] = None
    created_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class UserUpdate(BaseModel):
    full_name: Optional[str] = None
    email: Optional[EmailStr] = None
    phone: Optional[str] = None
    profile_photo_url: Optional[str] = None