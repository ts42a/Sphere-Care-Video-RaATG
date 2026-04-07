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


def _actor_key(actor_type: str, actor_id: int) -> str:
    return f"{actor_type}:{actor_id}"


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _format_participant(p: models.ConversationParticipant) -> schemas.ConversationParticipantResponse:
    return schemas.ConversationParticipantResponse(
        id=p.id,
        user_id=p.user_id,
        participant_type=p.participant_type or "user",
        display_name=p.display_name,
        role=p.role,
        last_read_at=p.last_read_at,
        joined_at=p.joined_at,
    )


def _message_is_self(message: models.Message, actor_type: str, actor_id: int) -> bool:
    return (
        int(getattr(message, "sender_user_id", 0) or 0) == int(actor_id)
        and (getattr(message, "sender_participant_type", None) or "user") == actor_type
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
        (participant.participant_type or "user") == actor_type
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
        participants=[_format_participant(item) for item in participants],
    )


def _delivery_payload_for_message(message: models.Message, conversation: models.Conversation) -> dict[str, dict]:
    deliveries: dict[str, dict] = {}
    created_at = message.created_at.isoformat() if message.created_at else None

    for participant in conversation.participants:
        if participant.notifications_muted:
            continue
        actor_type = participant.participant_type or "user"
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
                "is_self": actor_type == (getattr(message, "sender_participant_type", "user") or "user") and actor_id == int(message.sender_user_id or 0),
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
            deduped[(item.participant_type or "user", int(item.user_id))] = item
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
                resolved_name, resolved_role = _resolve_actor_profile(db, fake_auth, item.participant_type or "user", int(item.user_id))
                display_name = display_name or resolved_name
                role = role or resolved_role
            conversation.participants.append(
                models.ConversationParticipant(
                    conversation_id=conversation.id,
                    user_id=int(item.user_id),
                    participant_type=item.participant_type or "user",
                    display_name=display_name,
                    role=role,
                    last_read_at=_now_utc() if int(item.user_id) == actor_id and (item.participant_type or "user") == actor_type else None,
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
        _actor_key((participant.participant_type or "user"), int(participant.user_id or 0)): {"type": "conversations_update"}
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

    deliveries = _delivery_payload_for_message(message, conversation)
    await notification_service.notify_new_message(message, conversation.admin_id, deliveries=deliveries)
    if deliveries:
        await notification_service.notify_conversation_changed(conversation.admin_id, deliveries=deliveries)

    return _format_message(message, actor_type, actor_id)