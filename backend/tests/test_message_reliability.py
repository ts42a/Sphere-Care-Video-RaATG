"""Unit tests for messaging reliability helpers (no DB required)."""
import json

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
            self.message_id = 10
            self.conversation_id = 20
            self.admin_id = 1
            self.actor_key = "user:1"
            self.payload = json.dumps({"type": "new_message", "message": {}})
            self.attempts = 0
            self.max_attempts = 3
            self.processed = False
            self.failed = False
            self.error = None
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

    async def fake_broadcast_actor(actor_key, data):
        calls.append((actor_key, data))

    import backend.outbox.outbox_processor as outbox_mod

    orig = outbox_mod.ws_manager.broadcast_actor
    outbox_mod.ws_manager.broadcast_actor = fake_broadcast_actor
    try:
        n = await mr.flush_pending_message_outbox(fake_db, limit=10)
        assert n == 1
        assert row.processed is True
        assert row.processed_at is not None
        assert len(calls) == 1
        assert calls[0][0] == "user:1"
    finally:
        outbox_mod.ws_manager.broadcast_actor = orig
