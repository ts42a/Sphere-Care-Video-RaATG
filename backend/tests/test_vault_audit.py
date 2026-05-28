"""Tests for vault recovery request status transitions."""

VALID_REQUEST_STATUSES = {"pending", "approved", "completed", "rejected"}


def can_approve(status: str) -> bool:
    return status == "pending"


def can_complete(status: str) -> bool:
    return status == "approved"


def can_reject(status: str) -> bool:
    return status == "pending"


def test_pending_can_be_approved():
    assert can_approve("pending") is True


def test_approved_cannot_be_approved_again():
    assert can_approve("approved") is False


def test_approved_can_be_completed():
    assert can_complete("approved") is True


def test_pending_cannot_be_completed():
    assert can_complete("pending") is False


def test_pending_can_be_rejected():
    assert can_reject("pending") is True


def test_completed_cannot_be_rejected():
    assert can_reject("completed") is False


def test_all_statuses_defined():
    assert "pending" in VALID_REQUEST_STATUSES
    assert "approved" in VALID_REQUEST_STATUSES
    assert "completed" in VALID_REQUEST_STATUSES
    assert "rejected" in VALID_REQUEST_STATUSES
