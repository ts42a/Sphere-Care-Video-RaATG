"""Tests for password strength policy."""


def is_strong_password(password: str) -> bool:
    """Password must be at least 8 chars, have upper, lower, digit."""
    if len(password) < 8:
        return False
    if not any(c.isupper() for c in password):
        return False
    if not any(c.islower() for c in password):
        return False
    if not any(c.isdigit() for c in password):
        return False
    return True


def test_short_password_rejected():
    assert is_strong_password("Ab1") is False


def test_no_uppercase_rejected():
    assert is_strong_password("abcdef1!") is False


def test_no_lowercase_rejected():
    assert is_strong_password("ABCDEF1!") is False


def test_no_digit_rejected():
    assert is_strong_password("Abcdefgh") is False


def test_strong_password_accepted():
    assert is_strong_password("StrongPass1") is True


def test_minimum_length_boundary():
    assert is_strong_password("Abcdef1x") is True
    assert is_strong_password("Abcde1x") is False
