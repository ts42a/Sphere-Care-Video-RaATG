"""Unit tests for messaging reliability helpers (no DB required)."""
import pytest
from fastapi import HTTPException

from backend.services import message_reliability as mr


def test_rate_limit_allows_burst_under_cap():
    mr._send_timestamps.clear()
    for _ in range(59):
        mr.check_message_send_rate_limit("user:1")
    mr._send_timestamps.clear()


def test_rate_limit_blocks_over_cap():
    mr._send_timestamps.clear()
    for _ in range(60):
        mr.check_message_send_rate_limit("user:99")
    with pytest.raises(HTTPException) as exc:
        mr.check_message_send_rate_limit("user:99")
    assert exc.value.status_code == 429
    mr._send_timestamps.clear()


@pytest.mark.asyncio
async def test_flush_outbox_marks_sent_when_broadcast_ok():
    class FakeRow:
        def __init__(self):
            self.id = 1
            self.admin_id = 1
            self.kind = "new_message"
            self.payload_json = '{"deliveries": {"user:1": {"type": "new_message", "message": {}}}}'
            self.status = "pending"
            self.attempt_count = 0
            self.last_error = None
            self.processed_at = None

    class FakeQuery:
        def __init__(self, rows):
            self._rows = rows

        def filter(self, *a, **k):
            return self

        def order_by(self, *a, **k):
            return self

        def limit(self, *a, **k):
            return self

        def all(self):
            return list(self._rows)

    class FakeSession:
        def __init__(self, rows):
            self._rows = rows

        def query(self, model):
            return FakeQuery(self._rows)

        def commit(self):
            pass

    row = FakeRow()
    fake_db = FakeSession([row])

    calls = []

    async def fake_broadcast_many(deliveries):
        calls.append(deliveries)

    import backend.services.message_reliability as mod

    orig = mod.ws_manager.broadcast_many
    mod.ws_manager.broadcast_many = fake_broadcast_many
    try:
        n = await mod.flush_pending_message_outbox(fake_db, limit=10)
        assert n == 1
        assert row.status == "sent"
        assert len(calls) == 1
    finally:
        mod.ws_manager.broadcast_many = orig
