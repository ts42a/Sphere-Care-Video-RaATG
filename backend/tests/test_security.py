"""Unit tests for core/security.py — password hashing and JWT tokens."""
from backend.core.security import (
    get_password_hash,
    verify_password,
    create_access_token,
    decode_access_token,
)


def test_password_hash_is_not_plaintext():
    hashed = get_password_hash("mysecret")
    assert hashed != "mysecret"


def test_verify_password_correct():
    hashed = get_password_hash("hello123")
    assert verify_password("hello123", hashed) is True


def test_verify_password_wrong():
    hashed = get_password_hash("hello123")
    assert verify_password("wrongpass", hashed) is False


def test_create_and_decode_token():
    token = create_access_token({"sub": "user@example.com"})
    payload = decode_access_token(token)
    assert payload is not None
    assert payload["sub"] == "user@example.com"


def test_decode_invalid_token_returns_none():
    result = decode_access_token("not.a.valid.token")
    assert result is None


def test_token_contains_exp():
    token = create_access_token({"sub": "test@test.com"})
    payload = decode_access_token(token)
    assert "exp" in payload
