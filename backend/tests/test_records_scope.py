"""Tests for record admin scoping logic (no DB required)."""


class FakeRecord:
    def __init__(self, id, admin_id, resident_id, category, is_deleted=False):
        self.id = id
        self.admin_id = admin_id
        self.resident_id = resident_id
        self.category = category
        self.is_deleted = is_deleted


def get_records_for_admin(records, admin_id):
    return [r for r in records if r.admin_id == admin_id and not r.is_deleted]


def get_records_for_resident(records, admin_id, resident_id):
    return [
        r for r in records
        if r.admin_id == admin_id and r.resident_id == resident_id and not r.is_deleted
    ]


RECORDS = [
    FakeRecord(1, admin_id=10, resident_id=1, category="medical"),
    FakeRecord(2, admin_id=10, resident_id=2, category="video"),
    FakeRecord(3, admin_id=20, resident_id=1, category="medical"),
    FakeRecord(4, admin_id=10, resident_id=1, category="audio", is_deleted=True),
]


def test_admin_sees_only_own_records():
    result = get_records_for_admin(RECORDS, admin_id=10)
    assert all(r.admin_id == 10 for r in result)
    assert len(result) == 2


def test_deleted_records_excluded():
    result = get_records_for_admin(RECORDS, admin_id=10)
    assert all(not r.is_deleted for r in result)


def test_different_admin_cannot_see_others_records():
    result = get_records_for_admin(RECORDS, admin_id=20)
    assert len(result) == 1
    assert result[0].id == 3


def test_filter_by_resident():
    result = get_records_for_resident(RECORDS, admin_id=10, resident_id=1)
    assert len(result) == 1
    assert result[0].category == "medical"


def test_empty_when_no_match():
    result = get_records_for_admin(RECORDS, admin_id=99)
    assert result == []
