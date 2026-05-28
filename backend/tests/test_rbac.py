"""Tests for RBAC role resolution logic."""


def get_role_permissions(role: str) -> set:
    permissions = {
        "admin":           {"read", "write", "delete", "manage_users"},
        "staff":           {"read", "write"},
        "client":          {"read"},
        "family_contact":  {"read"},
        "external_doctor": {"read"},
        "auditor":         {"read"},
    }
    return permissions.get(role, set())


def test_admin_has_all_permissions():
    perms = get_role_permissions("admin")
    assert "read" in perms
    assert "write" in perms
    assert "delete" in perms
    assert "manage_users" in perms


def test_staff_can_read_and_write():
    perms = get_role_permissions("staff")
    assert "read" in perms
    assert "write" in perms
    assert "delete" not in perms


def test_client_can_only_read():
    perms = get_role_permissions("client")
    assert perms == {"read"}


def test_family_contact_can_only_read():
    perms = get_role_permissions("family_contact")
    assert "read" in perms
    assert "write" not in perms


def test_unknown_role_has_no_permissions():
    perms = get_role_permissions("hacker")
    assert len(perms) == 0


def test_auditor_can_only_read():
    perms = get_role_permissions("auditor")
    assert perms == {"read"}
