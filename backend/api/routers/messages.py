from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session, joinedload

from backend.api.deps import get_current_auth_context, get_db
from backend import models, schemas
from backend.services import notification_service

router = APIRouter(tags=["Messages"])


def _require_admin_id(auth: dict) -> int:
    admin_id = auth.get("admin_id")
    if not admin_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Missing admin scope")
    return int(admin_id)


def _actor_identity(auth: dict) -> tuple[str, int]:
    role = auth.get("role")
    user_id = auth.get("user_id")

    if role == "admin" and user_id:
        return "admin", int(user_id)
    if user_id:
        return "user", int(user_id)

    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing user scope")


def _normalize_participant_type(value: Optional[str]) -> str:
    # Mobile clients connect as user:<id>. Some older staff UI code wrote
    # participant_type="client", which makes delivery target client:<id>
    # and breaks realtime messaging. Treat client/family/staff accounts as user.
    value = (value or "user").strip().lower()
    if value in {"client", "resident", "staff", "family", "family_contact"}:
        return "user"
    return value


def _actor_key(actor_type: str, actor_id: int) -> str:
    return f"{_normalize_participant_type(actor_type)}:{actor_id}"


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _format_participant(p: models.ConversationParticipant) -> schemas.ConversationParticipantResponse:
    return schemas.ConversationParticipantResponse(
        id=p.id,
        user_id=p.user_id,
        participant_type=_normalize_participant_type(p.participant_type),
        display_name=p.display_name,
        role=p.role,
        last_read_at=p.last_read_at,
        joined_at=p.joined_at,
    )


def _message_is_self(message: models.Message, actor_type: str, actor_id: int) -> bool:
    return (
        int(getattr(message, "sender_user_id", 0) or 0) == int(actor_id)
        and _normalize_participant_type(getattr(message, "sender_participant_type", None)) == _normalize_participant_type(actor_type)
    )


def _format_message(message: models.Message, actor_type: str, actor_id: int) -> schemas.MessageResponse:
    return schemas.MessageResponse(
        id=message.id,
        conversation_id=message.conversation_id,
        sender_name=message.sender_name,
        sender_role=message.sender_role,
        sender_user_id=message.sender_user_id,
        sender_participant_type=getattr(message, "sender_participant_type", "user"),
        content=message.content,
        message_type=message.message_type,
        is_self=_message_is_self(message, actor_type, actor_id),
        created_at=message.created_at,
    )


def _participant_matches(participant: models.ConversationParticipant, actor_type: str, actor_id: int) -> bool:
    return (
        _normalize_participant_type(participant.participant_type) == _normalize_participant_type(actor_type)
        and int(participant.user_id or 0) == int(actor_id)
    )


def _find_actor_participant(
    conversation: models.Conversation,
    actor_type: str,
    actor_id: int,
) -> Optional[models.ConversationParticipant]:
    for participant in conversation.participants:
        if _participant_matches(participant, actor_type, actor_id):
            return participant
    return None


def _resolve_actor_profile(db: Session, auth: dict, actor_type: str, actor_id: int) -> tuple[str, str]:
    if actor_type == "admin":
        admin = db.query(models.Admin).filter(models.Admin.id == actor_id).first()
        if admin:
            return admin.full_name, "admin"
        return auth.get("email") or "Admin", "admin"

    user = db.query(models.User).filter(models.User.id == actor_id).first()
    if user:
        role = getattr(user, "global_role", None) or auth.get("role") or "user"
        return user.full_name, role

    return auth.get("email") or "User", auth.get("role") or "user"


def _add_participant_if_missing(
    conversation: models.Conversation,
    *,
    actor_type: str,
    actor_id: int,
    display_name: str,
    role: Optional[str],
):
    for participant in conversation.participants:
        if _participant_matches(participant, actor_type, actor_id):
            if display_name and not participant.display_name:
                participant.display_name = display_name
            if role and not participant.role:
                participant.role = role
            return participant

    participant = models.ConversationParticipant(
        conversation_id=conversation.id,
        user_id=actor_id,
        participant_type=actor_type,
        display_name=display_name,
        role=role,
    )
    conversation.participants.append(participant)
    return participant


def _ensure_resident_conversation_participants(db: Session, conversation: models.Conversation) -> None:
    """Repair resident conversations so linked mobile clients are real participants.

    Older staff UI flows could create a resident conversation before the client
    accepted the invitation, or without adding the client participant. Then the
    client can read /messages/conversations successfully but receives 0 rows and
    no realtime/new message notification. This function auto-heals that state.
    """
    if (conversation.category or "") != "resident":
        return

    raw_name = (conversation.name or "").strip()
    resident_name = raw_name
    prefix = "Resident Care:"
    if resident_name.lower().startswith(prefix.lower()):
        resident_name = resident_name[len(prefix):].strip()

    resident = None
    if resident_name:
        resident = db.query(models.Resident).filter(
            models.Resident.admin_id == conversation.admin_id,
            models.Resident.full_name == resident_name,
        ).first()

    # Fallback: if the conversation already has exactly one client/user participant,
    # no need to guess by name.
    if not resident:
        return

    if getattr(resident, "client_user_id", None):
        client = db.query(models.User).filter(models.User.id == resident.client_user_id).first()
        if client:
            _add_participant_if_missing(
                conversation,
                actor_type="user",
                actor_id=int(client.id),
                display_name=client.full_name or resident.full_name or client.email,
                role="client",
            )

    admin = db.query(models.Admin).filter(models.Admin.id == conversation.admin_id).first()
    if admin:
        _add_participant_if_missing(
            conversation,
            actor_type="admin",
            actor_id=int(admin.id),
            display_name=admin.full_name or "Admin",
            role="admin",
        )


def _ensure_client_resident_conversation(db: Session, admin_id: int, actor_type: str, actor_id: int) -> None:
    """When a client opens Messages, ensure their resident conversation exists.

    This makes old invitation data self-healing: if the client accepted an
    invitation but no resident conversation exists, create one. If the
    conversation exists but lacks the client participant, repair it.
    """
    if _normalize_participant_type(actor_type) != "user":
        return

    user = db.query(models.User).filter(models.User.id == actor_id).first()
    if not user or (getattr(user, "global_role", None) or "") != "client":
        return

    resident = db.query(models.Resident).filter(
        models.Resident.admin_id == admin_id,
        models.Resident.client_user_id == actor_id,
    ).first()
    if not resident:
        return

    conv_name = f"Resident Care: {resident.full_name or user.full_name or user.email}"
    conversation = db.query(models.Conversation).options(joinedload(models.Conversation.participants)).filter(
        models.Conversation.admin_id == admin_id,
        models.Conversation.category == "resident",
        models.Conversation.name == conv_name,
    ).first()

    if not conversation:
        conversation = models.Conversation(
            admin_id=admin_id,
            name=conv_name,
            category="resident",
            created_by=admin_id,
            unread_count=0,
        )
        db.add(conversation)
        db.flush()

    _add_participant_if_missing(
        conversation,
        actor_type="user",
        actor_id=actor_id,
        display_name=user.full_name or resident.full_name or user.email,
        role="client",
    )

    admin = db.query(models.Admin).filter(models.Admin.id == admin_id).first()
    if admin:
        _add_participant_if_missing(
            conversation,
            actor_type="admin",
            actor_id=int(admin.id),
            display_name=admin.full_name or "Admin",
            role="admin",
        )


def _persist_message_notifications(db: Session, message: models.Message, conversation: models.Conversation) -> None:
    """Persist notification rows for message recipients.

    WebSocket updates are temporary. The mobile Notifications page reads
    /notifications/, so a message should also create a Notification plus
    recipient rows for non-sender user participants.
    """
    recipients = []
    sender_type = _normalize_participant_type(getattr(message, "sender_participant_type", "user"))
    sender_id = int(getattr(message, "sender_user_id", 0) or 0)

    for participant in conversation.participants or []:
        p_type = _normalize_participant_type(participant.participant_type)
        p_id = int(participant.user_id or 0)
        if not p_id or participant.notifications_muted:
            continue
        if p_type == sender_type and p_id == sender_id:
            continue
        # NotificationRecipient has a user_id field only, so persist user clients/staff.
        if p_type == "user":
            recipients.append(p_id)

    if not recipients:
        return

    notification = models.Notification(
        admin_id=conversation.admin_id,
        category="message",
        title=f"New message from {message.sender_name}",
        body=message.content,
        related_entity_type="conversation",
        related_entity_id=conversation.id,
        is_priority=False,
    )
    db.add(notification)
    db.flush()

    for user_id in sorted(set(recipients)):
        db.add(models.NotificationRecipient(
            notification_id=notification.id,
            user_id=user_id,
            is_read=False,
        ))


def _default_team_participants(
    db: Session,
    admin_id: int,
    creator_type: str,
    creator_id: int,
    creator_name: str,
    creator_role: str,
):
    participants: dict[tuple[str, int], dict] = {
        (creator_type, creator_id): {
            "participant_type": creator_type,
            "user_id": creator_id,
            "display_name": creator_name,
            "role": creator_role,
        }
    }

    admin = db.query(models.Admin).filter(models.Admin.id == admin_id).first()
    if admin:
        participants[("admin", admin.id)] = {
            "participant_type": "admin",
            "user_id": admin.id,
            "display_name": admin.full_name,
            "role": "admin",
        }

    staff_rows = (
        db.query(models.Staff, models.User)
        .join(models.User, models.User.id == models.Staff.user_id)
        .filter(
            models.Staff.admin_id == admin_id,
            models.Staff.approval_status == "approved",
        )
        .all()
    )
    for staff, user in staff_rows:
        participants[("user", user.id)] = {
            "participant_type": "user",
            "user_id": user.id,
            "display_name": user.full_name or staff.full_name,
            "role": getattr(user, "global_role", None) or getattr(staff, "role", None) or "staff",
        }

    return list(participants.values())


def _bootstrap_legacy_participants(db: Session, conversation: models.Conversation):
    if conversation.participants:
        return

    creator_type = "admin"
    creator_id = int(conversation.admin_id)
    creator_name = "Care Team"
    creator_role = "admin"

    admin = db.query(models.Admin).filter(models.Admin.id == conversation.admin_id).first()
    if admin:
        creator_name = admin.full_name

    for payload in _default_team_participants(
        db,
        conversation.admin_id,
        creator_type,
        creator_id,
        creator_name,
        creator_role,
    ):
        conversation.participants.append(models.ConversationParticipant(**payload))

    db.flush()


def _ensure_conversation_access(
    db: Session,
    conversation_id: int,
    auth: dict,
) -> tuple[models.Conversation, models.ConversationParticipant, str, int]:
    admin_id = _require_admin_id(auth)
    actor_type, actor_id = _actor_identity(auth)

    conversation = (
        db.query(models.Conversation)
        .options(
            joinedload(models.Conversation.participants),
            joinedload(models.Conversation.messages),
        )
        .filter(
            models.Conversation.id == conversation_id,
            models.Conversation.admin_id == admin_id,
        )
        .first()
    )
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found.")

    if not conversation.participants:
        _bootstrap_legacy_participants(db, conversation)

    _ensure_resident_conversation_participants(db, conversation)

    actor_name, actor_role = _resolve_actor_profile(db, auth, actor_type, actor_id)
    participant = _find_actor_participant(conversation, actor_type, actor_id)

    if not participant:
        raise HTTPException(status_code=403, detail="You do not have access to this conversation")

    if not participant.display_name and actor_name:
        participant.display_name = actor_name
    if not participant.role and actor_role:
        participant.role = actor_role

    return conversation, participant, actor_type, actor_id


def _compute_unread_count(
    conversation: models.Conversation,
    participant: Optional[models.ConversationParticipant],
    actor_type: str,
    actor_id: int,
) -> int:
    messages = sorted(conversation.messages, key=lambda item: item.created_at or datetime.min.replace(tzinfo=timezone.utc))
    if not messages:
        return 0

    last_read_at = participant.last_read_at if participant else None
    unread = 0
    for message in messages:
        if _message_is_self(message, actor_type, actor_id):
            continue
        if last_read_at and message.created_at and message.created_at <= last_read_at:
            continue
        unread += 1
    return unread

def _display_name_for_actor(
    conversation: models.Conversation,
    actor_type: str,
    actor_id: int,
) -> str:
    participants = list(conversation.participants or [])

    if conversation.category == "direct":
        for participant in participants:
            p_type = participant.participant_type or "user"
            p_id = int(participant.user_id or 0)

            if p_type == actor_type and p_id == int(actor_id):
                continue

            if participant.display_name:
                return participant.display_name

    return conversation.name

def _format_conversation(
    conversation: models.Conversation,
    participant: Optional[models.ConversationParticipant],
    actor_type: str,
    actor_id: int,
) -> schemas.ConversationResponse:
    participants = list(conversation.participants or [])
    return schemas.ConversationResponse(
        id=conversation.id,
        name=_display_name_for_actor(conversation, actor_type, actor_id),
        category=conversation.category,
        last_message=conversation.last_message,
        last_message_at=conversation.last_message_at,
        unread_count=_compute_unread_count(conversation, participant, actor_type, actor_id),
        created_at=conversation.created_at,
        participant_count=len(participants),
        participants=[_format_participant(item) for item in participants if item.id is not None],
    )


def _delivery_payload_for_message(message: models.Message, conversation: models.Conversation) -> dict[str, dict]:
    deliveries: dict[str, dict] = {}
    created_at = message.created_at.isoformat() if message.created_at else None

    for participant in conversation.participants:
        if participant.notifications_muted:
            continue
        actor_type = _normalize_participant_type(participant.participant_type)
        actor_id = int(participant.user_id or 0)
        if not actor_id:
            continue
        deliveries[_actor_key(actor_type, actor_id)] = {
            "type": "new_message",
            "conversation_id": message.conversation_id,
            "message": {
                "id": message.id,
                "conversation_id": message.conversation_id,
                "sender_name": message.sender_name,
                "sender_role": message.sender_role or "",
                "sender_user_id": message.sender_user_id,
                "sender_participant_type": getattr(message, "sender_participant_type", "user"),
                "content": message.content,
                "message_type": message.message_type,
                "is_self": _normalize_participant_type(actor_type) == _normalize_participant_type(getattr(message, "sender_participant_type", "user")) and actor_id == int(message.sender_user_id or 0),
                "created_at": created_at,
            },
        }
    return deliveries


@router.get("/conversations", response_model=list[schemas.ConversationResponse])
def get_conversations(
    category: Optional[str] = Query(None, description="team | resident | alerts | direct"),
    search: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    auth: dict = Depends(get_current_auth_context),
):
    admin_id = _require_admin_id(auth)
    actor_type, actor_id = _actor_identity(auth)

    _ensure_client_resident_conversation(db, admin_id, actor_type, actor_id)
    db.flush()

    rows = (
        db.query(models.Conversation)
        .options(joinedload(models.Conversation.participants), joinedload(models.Conversation.messages))
        .filter(models.Conversation.admin_id == admin_id)
        .order_by(models.Conversation.last_message_at.desc().nullslast(), models.Conversation.id.desc())
        .all()
    )

    normalized_search = (search or "").strip().lower()
    results: list[schemas.ConversationResponse] = []

    for conversation in rows:
        if category and conversation.category != category:
            continue

        if not conversation.participants:
            _bootstrap_legacy_participants(db, conversation)

        _ensure_resident_conversation_participants(db, conversation)

        participant = _find_actor_participant(conversation, actor_type, actor_id)
        if not participant:
            continue

        if normalized_search:
            haystack = " ".join(
                filter(
                    None,
                    [
                        conversation.name,
                        conversation.category,
                        conversation.last_message or "",
                    ],
                )
            ).lower()
            if normalized_search not in haystack:
                continue

        results.append(_format_conversation(conversation, participant, actor_type, actor_id))

    db.commit()
    return results


@router.get("/conversations/{conversation_id}", response_model=schemas.ConversationResponse)
def get_conversation(
    conversation_id: int,
    db: Session = Depends(get_db),
    auth: dict = Depends(get_current_auth_context),
):
    conversation, participant, actor_type, actor_id = _ensure_conversation_access(db, conversation_id, auth)
    db.commit()
    db.refresh(conversation)
    return _format_conversation(conversation, participant, actor_type, actor_id)


@router.post("/conversations", response_model=schemas.ConversationResponse, status_code=status.HTTP_201_CREATED)
async def create_conversation(
    conv_in: schemas.ConversationCreate,
    db: Session = Depends(get_db),
    auth: dict = Depends(get_current_auth_context),
):
    admin_id = _require_admin_id(auth)
    actor_type, actor_id = _actor_identity(auth)
    actor_name, actor_role = _resolve_actor_profile(db, auth, actor_type, actor_id)

    conversation = models.Conversation(
        admin_id=admin_id,
        name=conv_in.name,
        category=conv_in.category,
        created_by=actor_id,
        unread_count=0,
    )
    db.add(conversation)
    db.flush()

    participant_payloads = list(conv_in.participants or [])
    if participant_payloads:
        deduped: dict[tuple[str, int], schemas.ConversationParticipantCreate] = {}
        for item in participant_payloads:
            deduped[(_normalize_participant_type(item.participant_type), int(item.user_id))] = item
        deduped[(actor_type, actor_id)] = schemas.ConversationParticipantCreate(
            user_id=actor_id,
            participant_type=actor_type,
            display_name=actor_name,
            role=actor_role,
        )
        for item in deduped.values():
            display_name = item.display_name
            role = item.role
            if not display_name or not role:
                fake_auth = {"role": "admin" if item.participant_type == "admin" else "staff", "user_id": item.user_id, "email": None}
                resolved_name, resolved_role = _resolve_actor_profile(db, fake_auth, _normalize_participant_type(item.participant_type), int(item.user_id))
                display_name = display_name or resolved_name
                role = role or resolved_role
            conversation.participants.append(
                models.ConversationParticipant(
                    conversation_id=conversation.id,
                    user_id=int(item.user_id),
                    participant_type=_normalize_participant_type(item.participant_type),
                    display_name=display_name,
                    role=role,
                    last_read_at=_now_utc() if int(item.user_id) == actor_id and _normalize_participant_type(item.participant_type) == _normalize_participant_type(actor_type) else None,
                )
            )
    else:
        for payload in _default_team_participants(db, admin_id, actor_type, actor_id, actor_name, actor_role):
            conversation.participants.append(
                models.ConversationParticipant(
                    conversation_id=conversation.id,
                    user_id=payload["user_id"],
                    participant_type=payload["participant_type"],
                    display_name=payload["display_name"],
                    role=payload["role"],
                    last_read_at=_now_utc() if payload["participant_type"] == actor_type and int(payload["user_id"]) == actor_id else None,
                )
            )

    db.commit()
    db.refresh(conversation)

    deliveries = {
        _actor_key(_normalize_participant_type(participant.participant_type), int(participant.user_id or 0)): {"type": "conversations_update"}
        for participant in conversation.participants
        if participant.user_id
    }
    await notification_service.notify_conversation_changed(admin_id, deliveries=deliveries)

    current_participant = _find_actor_participant(conversation, actor_type, actor_id)
    return _format_conversation(conversation, current_participant, actor_type, actor_id)


@router.patch("/conversations/{conversation_id}/read", response_model=schemas.ConversationResponse)
def mark_conversation_read(
    conversation_id: int,
    db: Session = Depends(get_db),
    auth: dict = Depends(get_current_auth_context),
):
    conversation, participant, actor_type, actor_id = _ensure_conversation_access(db, conversation_id, auth)
    latest_message_time = max((message.created_at for message in conversation.messages if message.created_at), default=_now_utc())
    participant.last_read_at = latest_message_time
    db.commit()
    db.refresh(conversation)
    refreshed_participant = _find_actor_participant(conversation, actor_type, actor_id)
    return _format_conversation(conversation, refreshed_participant, actor_type, actor_id)


@router.delete("/conversations/{conversation_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_conversation(
    conversation_id: int,
    db: Session = Depends(get_db),
    auth: dict = Depends(get_current_auth_context),
):
    conversation, _, _, _ = _ensure_conversation_access(db, conversation_id, auth)
    db.delete(conversation)
    db.commit()


@router.get("/conversations/{conversation_id}/messages", response_model=list[schemas.MessageResponse])
def get_messages(
    conversation_id: int,
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    auth: dict = Depends(get_current_auth_context),
):
    conversation, _, actor_type, actor_id = _ensure_conversation_access(db, conversation_id, auth)
    messages = sorted(conversation.messages, key=lambda item: item.created_at or datetime.min.replace(tzinfo=timezone.utc))
    return [_format_message(message, actor_type, actor_id) for message in messages[:limit]]


@router.post("/conversations/{conversation_id}/messages", response_model=schemas.MessageResponse, status_code=status.HTTP_201_CREATED)
async def send_message(
    conversation_id: int,
    msg_in: schemas.MessageCreate,
    db: Session = Depends(get_db),
    auth: dict = Depends(get_current_auth_context),
):
    conversation, participant, actor_type, actor_id = _ensure_conversation_access(db, conversation_id, auth)

    if msg_in.conversation_id != conversation_id:
        raise HTTPException(status_code=400, detail="conversation_id mismatch.")

    sender_name, sender_role = _resolve_actor_profile(db, auth, actor_type, actor_id)
    message = models.Message(
        admin_id=conversation.admin_id,
        conversation_id=conversation_id,
        sender_user_id=actor_id,
        sender_participant_type=actor_type,
        sender_name=msg_in.sender_name or sender_name,
        sender_role=msg_in.sender_role or sender_role,
        content=msg_in.content,
        message_type=msg_in.message_type,
        is_self=True,
    )
    db.add(message)

    conversation.last_message = msg_in.content
    conversation.last_message_at = _now_utc()
    participant.last_read_at = conversation.last_message_at
    conversation.unread_count = 0

    db.commit()
    db.refresh(message)
    db.refresh(conversation)

    _ensure_resident_conversation_participants(db, conversation)
    _persist_message_notifications(db, message, conversation)
    db.commit()
    db.refresh(conversation)

    deliveries = _delivery_payload_for_message(message, conversation)
    await notification_service.notify_new_message(message, conversation.admin_id, deliveries=deliveries)
    if deliveries:
        await notification_service.notify_conversation_changed(conversation.admin_id, deliveries=deliveries)

    return _format_message(message, actor_type, actor_id)
# ════════════════════════════════════════════════════════════════
# NEW ENDPOINTS — messaging features
# ════════════════════════════════════════════════════════════════

# ── 1. Mute / unmute conversation ────────────────────────────────
from pydantic import BaseModel as _BM

class MuteRequest(_BM):
    muted: bool

@router.patch("/conversations/{conversation_id}/mute")
def mute_conversation(
    conversation_id: int,
    payload: MuteRequest,
    db: Session = Depends(get_db),
    auth: dict = Depends(get_current_auth_context),
):
    """Mute or unmute notifications for a conversation."""
    conversation, participant, actor_type, actor_id = _ensure_conversation_access(db, conversation_id, auth)
    participant.notifications_muted = payload.muted
    db.commit()
    return {"conversation_id": conversation_id, "muted": payload.muted}


# ── 2. Edit a message ─────────────────────────────────────────────
class MessageEditRequest(_BM):
    content: str

@router.patch("/conversations/{conversation_id}/messages/{message_id}", response_model=schemas.MessageResponse)
def edit_message(
    conversation_id: int,
    message_id: int,
    payload: MessageEditRequest,
    db: Session = Depends(get_db),
    auth: dict = Depends(get_current_auth_context),
):
    """Edit a message (only sender can edit)."""
    conversation, participant, actor_type, actor_id = _ensure_conversation_access(db, conversation_id, auth)
    message = db.query(models.Message).filter(
        models.Message.id == message_id,
        models.Message.conversation_id == conversation_id,
    ).first()
    if not message:
        raise HTTPException(status_code=404, detail="Message not found.")
    if message.sender_user_id != actor_id:
        raise HTTPException(status_code=403, detail="You can only edit your own messages.")
    message.content = payload.content.strip()
    message.message_type = "text"
    db.commit()
    db.refresh(message)
    return _format_message(message, actor_type, actor_id)


# ── 3. Delete a message ───────────────────────────────────────────
@router.delete("/conversations/{conversation_id}/messages/{message_id}", status_code=204)
def delete_message(
    conversation_id: int,
    message_id: int,
    db: Session = Depends(get_db),
    auth: dict = Depends(get_current_auth_context),
):
    """Delete (recall) a message (only sender can delete)."""
    conversation, participant, actor_type, actor_id = _ensure_conversation_access(db, conversation_id, auth)
    message = db.query(models.Message).filter(
        models.Message.id == message_id,
        models.Message.conversation_id == conversation_id,
    ).first()
    if not message:
        raise HTTPException(status_code=404, detail="Message not found.")
    if message.sender_user_id != actor_id:
        raise HTTPException(status_code=403, detail="You can only delete your own messages.")
    db.delete(message)
    db.commit()


# ── 4. Read receipts — who has seen the conversation ─────────────
@router.get("/conversations/{conversation_id}/read-receipts")
def get_read_receipts(
    conversation_id: int,
    db: Session = Depends(get_db),
    auth: dict = Depends(get_current_auth_context),
):
    """Return last_read_at for each participant."""
    conversation, _, _, _ = _ensure_conversation_access(db, conversation_id, auth)
    return [
        {
            "participant_id": p.id,
            "display_name": p.display_name,
            "participant_type": _normalize_participant_type(p.participant_type),
            "last_read_at": p.last_read_at.isoformat() if p.last_read_at else None,
        }
        for p in conversation.participants
    ]


# ── 5. Export conversation history ───────────────────────────────
from fastapi.responses import PlainTextResponse

@router.get("/conversations/{conversation_id}/export", response_class=PlainTextResponse)
def export_conversation(
    conversation_id: int,
    db: Session = Depends(get_db),
    auth: dict = Depends(get_current_auth_context),
):
    """Export full conversation as plain text."""
    conversation, _, actor_type, actor_id = _ensure_conversation_access(db, conversation_id, auth)
    messages = (
        db.query(models.Message)
        .filter(models.Message.conversation_id == conversation_id)
        .order_by(models.Message.created_at.asc())
        .all()
    )
    lines = [f"=== {conversation.name} ===", f"Exported: {_now_utc().strftime('%Y-%m-%d %H:%M UTC')}", ""]
    for m in messages:
        ts = m.created_at.strftime("%Y-%m-%d %H:%M") if m.created_at else ""
        lines.append(f"[{ts}] {m.sender_name}: {m.content}")
    return "\n".join(lines)


# ── 6. Add participant to conversation ────────────────────────────
class AddParticipantRequest(_BM):
    user_id: int
    participant_type: str = "user"
    display_name: str
    role: str = ""

@router.post("/conversations/{conversation_id}/participants", response_model=schemas.ConversationParticipantResponse)
def add_participant(
    conversation_id: int,
    payload: AddParticipantRequest,
    db: Session = Depends(get_db),
    auth: dict = Depends(get_current_auth_context),
):
    """Add a member to a group conversation (admin users or conv owner/admin)."""
    conversation, participant, actor_type, actor_id = _ensure_conversation_access(db, conversation_id, auth)
    # Allow if: system admin OR conversation owner/admin
    is_system_admin = (actor_type == "admin")
    is_conv_admin = participant and participant.role in ("owner", "admin")
    if not is_system_admin and not is_conv_admin:
        raise HTTPException(status_code=403, detail="Only admins can add members.")
    # Check not already a participant
    existing = db.query(models.ConversationParticipant).filter(
        models.ConversationParticipant.conversation_id == conversation_id,
        models.ConversationParticipant.user_id == payload.user_id,
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail="User is already a participant.")
    new_p = models.ConversationParticipant(
        conversation_id=conversation_id,
        user_id=payload.user_id,
        participant_type=_normalize_participant_type(payload.participant_type),
        display_name=payload.display_name,
        role=payload.role or "member",
    )
    db.add(new_p)
    db.commit()
    db.refresh(new_p)
    return _format_participant(new_p)


# ── 7. Remove participant from conversation ───────────────────────
@router.get("/conversations/{conversation_id}/participants")
def list_participants(
    conversation_id: int,
    db: Session = Depends(get_db),
    auth: dict = Depends(get_current_auth_context),
):
    """List all participants in a conversation."""
    conversation, _, _, _ = _ensure_conversation_access(db, conversation_id, auth)
    return [
        {
            "id": p.id,
            "user_id": p.user_id,
            "display_name": p.display_name,
            "participant_type": _normalize_participant_type(p.participant_type),
            "role": p.role,
            "joined_at": p.joined_at.isoformat() if p.joined_at else None,
            "last_read_at": p.last_read_at.isoformat() if p.last_read_at else None,
            "notifications_muted": p.notifications_muted,
        }
        for p in conversation.participants
    ]


@router.delete("/conversations/{conversation_id}/participants/{participant_id}", status_code=204)
def remove_participant(
    conversation_id: int,
    participant_id: int,
    db: Session = Depends(get_db),
    auth: dict = Depends(get_current_auth_context),
):
    """Remove a member from a group conversation (admin/owner or self-leave)."""
    conversation, caller_participant, actor_type, actor_id = _ensure_conversation_access(db, conversation_id, auth)
    target = db.query(models.ConversationParticipant).filter(
        models.ConversationParticipant.id == participant_id,
        models.ConversationParticipant.conversation_id == conversation_id,
    ).first()
    if not target:
        raise HTTPException(status_code=404, detail="Participant not found.")
    # Allow self-leave OR system admin OR conv owner/admin
    is_self = target.user_id == actor_id
    is_system_admin = (actor_type == "admin")
    is_conv_admin = caller_participant and caller_participant.role in ("owner", "admin")
    if not is_self and not is_system_admin and not is_conv_admin:
        raise HTTPException(status_code=403, detail="Only admins can remove members.")
    db.delete(target)
    db.commit()


# ── 8. Update participant role (owner/admin management) ──────────
class UpdateParticipantRoleRequest(_BM):
    role: str  # "owner" | "admin" | "member"

@router.patch("/conversations/{conversation_id}/participants/{participant_id}/role")
def update_participant_role(
    conversation_id: int,
    participant_id: int,
    payload: UpdateParticipantRoleRequest,
    db: Session = Depends(get_db),
    auth: dict = Depends(get_current_auth_context),
):
    """Change a participant's role (only owner can do this)."""
    conversation, caller_participant, _, _ = _ensure_conversation_access(db, conversation_id, auth)
    if caller_participant.role != "owner":
        raise HTTPException(status_code=403, detail="Only the group owner can change roles.")
    target = db.query(models.ConversationParticipant).filter(
        models.ConversationParticipant.id == participant_id,
        models.ConversationParticipant.conversation_id == conversation_id,
    ).first()
    if not target:
        raise HTTPException(status_code=404, detail="Participant not found.")
    allowed_roles = {"owner", "admin", "member"}
    if payload.role not in allowed_roles:
        raise HTTPException(status_code=400, detail=f"Role must be one of: {allowed_roles}")
    target.role = payload.role
    db.commit()
    return {"participant_id": participant_id, "role": payload.role}


# ── 9. Block / unblock a user ─────────────────────────────────────
# Uses a simple in-memory block list per admin session for now.
# For production, add a BlockList model to the DB.
_block_list: dict[int, set[int]] = {}  # { admin_id: {blocked_user_id, ...} }

class BlockRequest(_BM):
    user_id: int

@router.post("/block")
def block_user(
    payload: BlockRequest,
    auth: dict = Depends(get_current_auth_context),
):
    """Block a user — their messages will be hidden."""
    admin_id = auth.get("admin_id") or 0
    if admin_id not in _block_list:
        _block_list[admin_id] = set()
    _block_list[admin_id].add(payload.user_id)
    return {"blocked_user_id": payload.user_id, "status": "blocked"}

@router.delete("/block/{user_id}")
def unblock_user(
    user_id: int,
    auth: dict = Depends(get_current_auth_context),
):
    """Unblock a previously blocked user."""
    admin_id = auth.get("admin_id") or 0
    if admin_id in _block_list:
        _block_list[admin_id].discard(user_id)
    return {"user_id": user_id, "status": "unblocked"}

@router.get("/block")
def get_blocked_users(
    auth: dict = Depends(get_current_auth_context),
):
    """List all blocked user IDs."""
    admin_id = auth.get("admin_id") or 0
    return {"blocked_users": list(_block_list.get(admin_id, set()))}


# ════════════════════════════════════════════════════════════════
# NEW ENDPOINTS using new model fields
# ════════════════════════════════════════════════════════════════

# ── Real soft-delete (uses is_deleted field) ──────────────────
@router.delete("/conversations/{conversation_id}/messages/{message_id}/soft", status_code=204)
def soft_delete_message(
    conversation_id: int,
    message_id: int,
    db: Session = Depends(get_db),
    auth: dict = Depends(get_current_auth_context),
):
    """Soft-delete a message — marks is_deleted=True, content replaced with placeholder."""
    conversation, participant, actor_type, actor_id = _ensure_conversation_access(db, conversation_id, auth)
    message = db.query(models.Message).filter(
        models.Message.id == message_id,
        models.Message.conversation_id == conversation_id,
    ).first()
    if not message:
        raise HTTPException(status_code=404, detail="Message not found.")
    if message.sender_user_id != actor_id:
        raise HTTPException(status_code=403, detail="You can only delete your own messages.")
    message.is_deleted = True
    message.content = "[Message deleted]"
    db.commit()


# ── Real edit (uses edited_at field) ──────────────────────────
@router.patch("/conversations/{conversation_id}/messages/{message_id}/edit", response_model=schemas.MessageResponse)
def edit_message_v2(
    conversation_id: int,
    message_id: int,
    payload: MessageEditRequest,
    db: Session = Depends(get_db),
    auth: dict = Depends(get_current_auth_context),
):
    """Edit a message — updates content and sets edited_at timestamp."""
    from datetime import timezone, datetime
    conversation, participant, actor_type, actor_id = _ensure_conversation_access(db, conversation_id, auth)
    message = db.query(models.Message).filter(
        models.Message.id == message_id,
        models.Message.conversation_id == conversation_id,
        models.Message.is_deleted == False,
    ).first()
    if not message:
        raise HTTPException(status_code=404, detail="Message not found.")
    if message.sender_user_id != actor_id:
        raise HTTPException(status_code=403, detail="You can only edit your own messages.")
    message.content = payload.content.strip()
    message.edited_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(message)
    return _format_message(message, actor_type, actor_id)


# ── Mark message as read (per-message read receipts) ─────────
class MarkReadRequest(_BM):
    display_name: str = ""
    participant_type: str = "user"

@router.post("/conversations/{conversation_id}/messages/{message_id}/read", status_code=204)
def mark_message_read(
    conversation_id: int,
    message_id: int,
    payload: MarkReadRequest,
    db: Session = Depends(get_db),
    auth: dict = Depends(get_current_auth_context),
):
    """Record that a specific user has read a specific message (upsert)."""
    from datetime import timezone, datetime
    conversation, participant, actor_type, actor_id = _ensure_conversation_access(db, conversation_id, auth)

    existing = db.query(models.MessageRead).filter(
        models.MessageRead.message_id == message_id,
        models.MessageRead.user_id == actor_id,
        models.MessageRead.participant_type == actor_type,
    ).first()

    if existing:
        existing.read_at = datetime.now(timezone.utc)
    else:
        db.add(models.MessageRead(
            message_id=message_id,
            conversation_id=conversation_id,
            user_id=actor_id,
            participant_type=actor_type,
            display_name=payload.display_name or (participant.display_name if participant else ""),
            read_at=datetime.now(timezone.utc),
        ))
    db.commit()


# ── Get per-message read receipts ─────────────────────────────
@router.get("/conversations/{conversation_id}/messages/{message_id}/read-receipts")
def get_message_read_receipts(
    conversation_id: int,
    message_id: int,
    db: Session = Depends(get_db),
    auth: dict = Depends(get_current_auth_context),
):
    """Who has read a specific message and when."""
    _ensure_conversation_access(db, conversation_id, auth)
    reads = db.query(models.MessageRead).filter(
        models.MessageRead.message_id == message_id,
    ).order_by(models.MessageRead.read_at.asc()).all()
    return [
        {
            "user_id": r.user_id,
            "display_name": r.display_name,
            "participant_type": r.participant_type,
            "read_at": r.read_at.isoformat() if r.read_at else None,
        }
        for r in reads
    ]


# ── Notification preferences ──────────────────────────────────
class NotificationPrefRequest(_BM):
    muted: bool = False
    mute_until: str = None          # ISO datetime string or null
    mention_only: bool = False
    push_enabled: bool = True

@router.put("/conversations/{conversation_id}/notification-preferences")
def set_notification_preferences(
    conversation_id: int,
    payload: NotificationPrefRequest,
    db: Session = Depends(get_db),
    auth: dict = Depends(get_current_auth_context),
):
    """Set notification preferences for a conversation (upsert)."""
    from datetime import timezone, datetime
    _, _, actor_type, actor_id = _ensure_conversation_access(db, conversation_id, auth)

    pref = db.query(models.NotificationPreference).filter(
        models.NotificationPreference.user_id == actor_id,
        models.NotificationPreference.participant_type == actor_type,
        models.NotificationPreference.conversation_id == conversation_id,
    ).first()

    mute_until = None
    if payload.mute_until:
        try:
            mute_until = datetime.fromisoformat(payload.mute_until)
        except Exception:
            pass

    if pref:
        pref.muted = payload.muted
        pref.mute_until = mute_until
        pref.mention_only = payload.mention_only
        pref.push_enabled = payload.push_enabled
        pref.updated_at = datetime.now(timezone.utc)
    else:
        pref = models.NotificationPreference(
            user_id=actor_id,
            participant_type=actor_type,
            conversation_id=conversation_id,
            muted=payload.muted,
            mute_until=mute_until,
            mention_only=payload.mention_only,
            push_enabled=payload.push_enabled,
        )
        db.add(pref)

    db.commit()
    return {
        "conversation_id": conversation_id,
        "muted": pref.muted,
        "mute_until": pref.mute_until.isoformat() if pref.mute_until else None,
        "mention_only": pref.mention_only,
        "push_enabled": pref.push_enabled,
    }

@router.get("/conversations/{conversation_id}/notification-preferences")
def get_notification_preferences(
    conversation_id: int,
    db: Session = Depends(get_db),
    auth: dict = Depends(get_current_auth_context),
):
    """Get current notification preferences for a conversation."""
    _, _, actor_type, actor_id = _ensure_conversation_access(db, conversation_id, auth)
    pref = db.query(models.NotificationPreference).filter(
        models.NotificationPreference.user_id == actor_id,
        models.NotificationPreference.participant_type == actor_type,
        models.NotificationPreference.conversation_id == conversation_id,
    ).first()
    if not pref:
        return {"muted": False, "mute_until": None, "mention_only": False, "push_enabled": True}
    return {
        "muted": pref.muted,
        "mute_until": pref.mute_until.isoformat() if pref.mute_until else None,
        "mention_only": pref.mention_only,
        "push_enabled": pref.push_enabled,
    }