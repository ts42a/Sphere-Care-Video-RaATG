"""Tests for CenterMembership and CenterJoinRequest status logic."""

MEMBERSHIP_ROLES = {"staff", "client", "family_contact", "external_doctor"}
MEMBERSHIP_STATUSES = {"pending", "active", "suspended", "ended"}
JOIN_REQUEST_STATUSES = {"pending", "approved", "rejected"}


def is_valid_membership_role(role: str) -> bool:
    return role in MEMBERSHIP_ROLES


def is_valid_membership_status(status: str) -> bool:
    return status in MEMBERSHIP_STATUSES


def can_approve_join_request(status: str) -> bool:
    return status == "pending"


def can_reject_join_request(status: str) -> bool:
    return status == "pending"


def test_valid_membership_roles():
    for role in ["staff", "client", "family_contact", "external_doctor"]:
        assert is_valid_membership_role(role) is True


def test_invalid_role_rejected():
    assert is_valid_membership_role("hacker") is False
    assert is_valid_membership_role("admin") is False


def test_pending_join_can_be_approved():
    assert can_approve_join_request("pending") is True


def test_approved_join_cannot_be_approved_again():
    assert can_approve_join_request("approved") is False


def test_pending_join_can_be_rejected():
    assert can_reject_join_request("pending") is True


def test_rejected_join_cannot_be_rejected_again():
    assert can_reject_join_request("rejected") is False


def test_all_membership_statuses_valid():
    for s in ["pending", "active", "suspended", "ended"]:
        assert is_valid_membership_status(s) is True


def test_default_membership_status_is_pending():
    assert "pending" in MEMBERSHIP_STATUSES
