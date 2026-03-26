from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class CenterJoinRequestCreate(BaseModel):
    center_id: str
    message: Optional[str] = None


class CenterJoinRequestReview(BaseModel):
    reason: Optional[str] = None


class LeaveCenterRequest(BaseModel):
    password: str


class AdminInvitePayload(BaseModel):
    account_id: str


class CenterJoinRequestResponse(BaseModel):
    id: int
    user_id: int
    user_email: Optional[str] = None
    user_full_name: Optional[str] = None
    organization_id: int
    center_code: Optional[str] = None
    center_name: Optional[str] = None
    membership_role: str
    status: str
    initiated_by: str
    request_message: Optional[str] = None
    rejection_reason: Optional[str] = None
    requested_at: datetime
    reviewed_at: Optional[datetime] = None
    approved_at: Optional[datetime] = None
    left_at: Optional[datetime] = None


class CenterMembershipStatusResponse(BaseModel):
    is_member: bool
    membership_status: str
    membership_role: Optional[str] = None
    joined_center_organization_id: Optional[int] = None
    joined_center_code: Optional[str] = None
    joined_center_name: Optional[str] = None
    pending_request: Optional[CenterJoinRequestResponse] = None
    latest_request: Optional[CenterJoinRequestResponse] = None
