"""Reliable messaging: envelopes, outbox fanout, rate limits, delivery receipts."""
from __future__ import annotations

import json
import logging
import time
import uuid
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session, joinedload

from backend import models
from backend.ws.ws_manager import ws_manager

logger = logging.getLogger(__name__)

# actor_key -> list of unix timestamps in last 60s
_send_timestamps: dict[str, list[float]] = defaultdict(list)
MAX_MESSAGES_PER_MINUTE = 60


def check_message_send_rate_limit(actor_key: str) -> None:
    from fastapi import HTTPException, status

    now = time.time()
    bucket = _send_timestamps[actor_key]
    bucket[:] = [t for t in bucket if now - t < 60.0]
    if len(bucket) >= MAX_MESSAGES_PER_MINUTE:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many messages. Try again shortly.",
        )
    bucket.append(now)


def _message_dict_for_ws(
    message: "models.Message",
    *,
    for_actor_type: str,
    for_actor_id: int,
) -> dict[str, Any]:
    created_at = message.created_at
    created_iso = created_at.isoformat() if isinstance(created_at, datetime) else str(created_at)
    st = getattr(message, "sender_participant_type", None) or "user"
    suid = int(message.sender_user_id or 0)
    is_self = st == for_actor_type and suid == int(for_actor_id)
    return {
        "id": message.id,
        "conversation_id": message.conversation_id,
        "sender_name": message.sender_name,
        "sender_role": message.sender_role or "",
        "sender_user_id": message.sender_user_id,
        "sender_participant_type": st,
        "content": message.content,
        "message_type": message.message_type,
        "is_self": is_self,
        "created_at": created_iso,
        "client_message_id": getattr(message, "client_message_id", None),
        "fanout_event_id": getattr(message, "fanout_event_id", None),
    }


def build_per_recipient_ws_events(
    message: "models.Message",
    conversation: "models.Conversation",
    *,
    actor_key_fn,
) -> dict[str, dict[str, Any]]:
    """Build websocket payloads keyed by actor (e.g. user:12)."""
    event_id = getattr(message, "fanout_event_id", None) or str(uuid.uuid4())
    created_at = message.created_at
    server_ts = created_at.isoformat() if isinstance(created_at, datetime) else str(created_at)
    deliveries: dict[str, dict[str, Any]] = {}

    for participant in conversation.participants or []:
        if participant.notifications_muted:
            continue
        actor_type = participant.participant_type or "user"
        actor_id = int(participant.user_id or 0)
        if not actor_id:
            continue
        key = actor_key_fn(actor_type, actor_id)
        msg_dict = _message_dict_for_ws(message, for_actor_type=actor_type, for_actor_id=actor_id)
        inner_payload = {
            "eventId": event_id,
            "messageId": message.id,
            "conversationId": message.conversation_id,
            "conversation_id": message.conversation_id,
            "serverTimestamp": server_ts,
            "deliveryState": "sent",
            "message": msg_dict,
            "senderActor": {
                "participant_type": getattr(message, "sender_participant_type", None) or "user",
                "user_id": message.sender_user_id,
            },
        }
        deliveries[key] = {
            "type": "new_message",
            "event_id": event_id,
            "payload": inner_payload,
            "conversation_id": message.conversation_id,
            "message": msg_dict,
        }
    return deliveries


def enqueue_message_fanout(db: Session, admin_id: int, deliveries: dict[str, dict[str, Any]]) -> models.MessageOutbox:
    row = models.MessageOutbox(
        admin_id=admin_id,
        kind="new_message",
        payload_json=json.dumps({"deliveries": deliveries}),
        status="pending",
        attempt_count=0,
    )
    db.add(row)
    return row


async def flush_pending_message_outbox(db: Session, *, limit: int = 50) -> int:
    """Process pending outbox rows; returns number of rows completed."""
    rows = (
        db.query(models.MessageOutbox)
        .filter(models.MessageOutbox.status == "pending")
        .order_by(models.MessageOutbox.id.asc())
        .limit(limit)
        .all()
    )
    processed = 0
    now = datetime.now(timezone.utc)
    for row in rows:
        try:
            data = json.loads(row.payload_json)
            deliveries = data.get("deliveries") or {}
            if deliveries:
                await ws_manager.broadcast_many(deliveries)
            row.status = "sent"
            row.processed_at = now
            row.last_error = None
            processed += 1
            logger.info(
                "message_outbox_flushed",
                extra={"outbox_id": row.id, "admin_id": row.admin_id, "kind": row.kind},
            )
        except Exception as exc:  # noqa: BLE001
            row.attempt_count = int(row.attempt_count or 0) + 1
            row.last_error = str(exc)[:2000]
            logger.warning(
                "message_outbox_failed",
                extra={"outbox_id": row.id, "attempt": row.attempt_count, "error": row.last_error},
            )
            if row.attempt_count >= 8:
                row.status = "failed"
                row.processed_at = now
    db.commit()
    return processed


def create_delivery_receipts_for_message(
    db: Session,
    message: "models.Message",
    conversation: "models.Conversation",
    *,
    sender_participant_type: str,
    sender_user_id: int,
) -> None:
    """Receipt rows for recipients (excludes sender)."""
    for p in conversation.participants or []:
        pt = p.participant_type or "user"
        uid = int(p.user_id or 0)
        if not uid:
            continue
        if pt == sender_participant_type and uid == int(sender_user_id):
            continue
        existing = (
            db.query(models.MessageDeliveryReceipt)
            .filter(
                models.MessageDeliveryReceipt.message_id == message.id,
                models.MessageDeliveryReceipt.participant_id == p.id,
            )
            .first()
        )
        if existing:
            continue
        db.add(
            models.MessageDeliveryReceipt(
                message_id=message.id,
                participant_id=p.id,
            )
        )


def apply_receipt_from_ws(
    db: Session,
    *,
    conversation_id: int,
    message_id: int,
    state: str,
    auth_payload: dict,
) -> bool:
    """Update delivery receipt for current actor. Returns True if updated."""
    admin_id = int(auth_payload.get("admin_id") or 0)
    role = auth_payload.get("role")
    user_id = auth_payload.get("user_id")
    if not admin_id or not user_id:
        return False
    actor_type = "admin" if role == "admin" else "user"
    actor_id = int(user_id)

    conv = (
        db.query(models.Conversation)
        .options(joinedload(models.Conversation.participants))
        .filter(
            models.Conversation.id == conversation_id,
            models.Conversation.admin_id == admin_id,
        )
        .first()
    )
    if not conv:
        return False

    participant = None
    for p in conv.participants or []:
        if (p.participant_type or "user") == actor_type and int(p.user_id or 0) == actor_id:
            participant = p
            break
    if not participant:
        return False

    msg = (
        db.query(models.Message)
        .filter(
            models.Message.id == message_id,
            models.Message.conversation_id == conversation_id,
        )
        .first()
    )
    if not msg:
        return False

    rec = (
        db.query(models.MessageDeliveryReceipt)
        .filter(
            models.MessageDeliveryReceipt.message_id == message_id,
            models.MessageDeliveryReceipt.participant_id == participant.id,
        )
        .first()
    )
    if not rec:
        rec = models.MessageDeliveryReceipt(
            message_id=message_id,
            participant_id=participant.id,
        )
        db.add(rec)

    now = datetime.now(timezone.utc)
    if state == "delivered":
        if not rec.delivered_at:
            rec.delivered_at = now
    elif state == "read":
        if not rec.delivered_at:
            rec.delivered_at = now
        rec.read_at = now

    db.commit()
    return True
