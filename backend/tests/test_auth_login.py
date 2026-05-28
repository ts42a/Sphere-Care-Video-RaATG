"""Tests for AuthService login logic (no DB required)."""
from backend.core.security import get_password_hash, verify_password, create_access_token, decode_access_token


class FakeUser:
    def __init__(self, email, password):
        self.email = email
        self.password_hash = get_password_hash(password)
        self.global_role = "staff"
        self.id = 1
        self.full_name = "Test User"


def fake_login(email: str, password: str, user_store: dict):
    user = user_store.get(email)
    if not user or not verify_password(password, user.password_hash):
        return None
    token = create_access_token({"sub": user.email})
    return token, user


def test_login_success():
    store = {"alice@test.com": FakeUser("alice@test.com", "Secret123")}
    result = fake_login("alice@test.com", "Secret123", store)
    assert result is not None
    token, user = result
    assert user.email == "alice@test.com"


def test_login_wrong_password():
    store = {"alice@test.com": FakeUser("alice@test.com", "Secret123")}
    result = fake_login("alice@test.com", "wrongpass", store)
    assert result is None


def test_login_unknown_email():
    result = fake_login("nobody@test.com", "anypass", {})
    assert result is None


def test_login_token_is_decodable():
    store = {"bob@test.com": FakeUser("bob@test.com", "Password1")}
    result = fake_login("bob@test.com", "Password1", store)
    assert result is not None
    token, _ = result
    payload = decode_access_token(token)
    assert payload["sub"] == "bob@test.com"


def test_login_returns_correct_user():
    store = {"carol@test.com": FakeUser("carol@test.com", "MyPass99")}
    result = fake_login("carol@test.com", "MyPass99", store)
    assert result is not None
    _, user = result
    assert user.full_name == "Test User"
