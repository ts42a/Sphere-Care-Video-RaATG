"""
/api/v1/calls — Full call state machine.
LiveKit token minting is stubbed — fill in when LIVEKIT_* env vars are set.
"""
import asyncio
import json
import uuid
from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import or_
from sqlalchemy.orm import Session, joinedload

from backend.api.deps import get_db
from backend.api.routers.auth import _get_current_user
from backend import models
from backend.ws.ws_manager import ws_manager
from backend.services.livekit_asr_service import livekit_asr_manager
from backend.services.livekit_asl_service import livekit_asl_manager

router = APIRouter(prefix="/calls", tags=["Calls"])

INVITE_TTL_SECONDS = 60  # 1 minute ringing timeout
TERMINAL_CALL_STATES = {"declined", "canceled", "timeout", "ended", "failed"}

# Admin IDs are offset to avoid colliding with users.id values in the calls table.
# IMPORTANT: message conversations store admin participants as participant_type="admin"
# with the real admin.id. Calls store a single numeric participant id, so admin
# participants must be converted to/from this offset consistently.
ADMIN_ID_OFFSET = 1_000_000


def _normalize_actor_type(value: Optional[str]) -> str:
    value = (value or "user").strip().lower()
    if value in {"admin", "administrator"}:
        return "admin"
    return "user"


def _to_call_storage_id(actor_type: Optional[str], user_id: int) -> int:
    actor_type = _normalize_actor_type(actor_type)
    raw_id = int(user_id)
    if actor_type == "admin":
        return raw_id if raw_id >= ADMIN_ID_OFFSET else raw_id + ADMIN_ID_OFFSET
    return raw_id


def _from_call_storage_id(storage_id: int, role_hint: Optional[str] = None) -> tuple[str, int]:
    role = (role_hint or "").strip().lower()
    raw_id = int(storage_id)
    if role == "admin" or raw_id >= ADMIN_ID_OFFSET:
        return "admin", raw_id - ADMIN_ID_OFFSET if raw_id >= ADMIN_ID_OFFSET else raw_id
    return "user", raw_id


def _actor_key_from_call_storage_id(storage_id: int, role_hint: Optional[str] = None) -> str:
    actor_type, real_id = _from_call_storage_id(storage_id, role_hint)
    return f"{actor_type}:{real_id}"


# ── Helpers ──────────────────────────────────────────────────────────────────

def _now() -> datetime:
    return datetime.now(timezone.utc)

def _gen_room_id() -> str:
    return "room_" + uuid.uuid4().hex

def _get_org_id(current_user, db: Session | None = None) -> int:
    if isinstance(current_user, models.Admin):
        return int(current_user.organization_id)

    role = getattr(current_user, "global_role", None)
    if role == "staff" and db is not None:
        staff = db.query(models.Staff).filter(models.Staff.user_id == current_user.id).first()
        return int(staff.admin_id) if staff else 0
    if role == "client" and db is not None:
        resident = db.query(models.Resident).filter(models.Resident.client_user_id == current_user.id).first()
        return int(resident.admin_id) if resident else 0
    return int(getattr(current_user, "organization_id", 0) or 0)

def _get_user_id(current_user) -> int:
    """
    Admin rows live in a separate table so we offset their id by ADMIN_ID_OFFSET
    to guarantee they never collide with a users.id value.
    """
    if isinstance(current_user, models.Admin):
        return int(current_user.id) + ADMIN_ID_OFFSET
    return int(current_user.id)

def _get_role(current_user) -> str:
    if isinstance(current_user, models.Admin):
        return "admin"
    return getattr(current_user, 'global_role', 'staff') or 'staff'

TOKEN_TTL_MINUTES = 15

def _mint_livekit_token(room_id: str, identity: str, display_name: str) -> tuple[Optional[str], Optional[datetime]]:
    """
    Mint a participant token when LIVEKIT_* env vars are configured.
    Returns both the JWT and its expiry so the mobile app can rehydrate calls.
    """
    import os
    lk_key = os.getenv("LIVEKIT_API_KEY")
    lk_secret = os.getenv("LIVEKIT_API_SECRET")
    if not lk_key or not lk_secret:
        return None, None
    expires_at = _now() + timedelta(minutes=TOKEN_TTL_MINUTES)
    try:
        from livekit.api import AccessToken, VideoGrants
        token = (
            AccessToken(lk_key, lk_secret)
            .with_identity(identity)
            .with_name(display_name)
            .with_metadata(json.dumps({"display_name": display_name}))
            .with_grants(VideoGrants(room_join=True, room=room_id))
            .with_ttl(timedelta(minutes=TOKEN_TTL_MINUTES))
            .to_jwt()
        )
        return token, expires_at
    except Exception:
        return None, None

def _livekit_url() -> Optional[str]:
    import os
    return os.getenv("LIVEKIT_URL")

def _add_event(db: Session, call_id: int, event_type: str, actor_id: Optional[int] = None, meta: dict = None):
    db.add(models.CallEvent(
        call_id=call_id,
        event_type=event_type,
        actor_user_id=actor_id,
        event_data=json.dumps(meta) if meta else None,
    ))

async def _ws_broadcast_call_event(call: models.Call, event_type: str, extra: dict = None):
    """Notify both caller and callee via WS using the same actor key rules as messages."""
    payload = {
        "type": event_type,
        "call_id": call.id,
        "state": call.state,
        "kind": call.kind,
        "room_id": call.room_id,
        "timestamp": _now().isoformat(),
        **(extra or {}),
    }

    for stored_uid in [call.created_by_user_id, call.callee_user_id]:
        if not stored_uid:
            continue
        actor_key = _actor_key_from_call_storage_id(stored_uid)
        await ws_manager.broadcast_actor(actor_key, payload)

        # Compatibility fallback for older rows or older clients that may have
        # connected under the wrong key during development.
        actor_type, real_id = _from_call_storage_id(stored_uid)
        await ws_manager.broadcast_actor(f"user:{real_id}", payload)
        await ws_manager.broadcast_actor(f"admin:{real_id}", payload)


async def _ws_send_to_call_participant(stored_user_id: int | None, payload: dict, role_hint: Optional[str] = None):
    if not stored_user_id:
        return

    actor_key = _actor_key_from_call_storage_id(stored_user_id, role_hint)
    print("DEBUG ws actor_key", actor_key)
    await ws_manager.broadcast_actor(actor_key, payload)

    # Compatibility fallback for old dev tokens / old rows.
    _, real_id = _from_call_storage_id(stored_user_id, role_hint)
    await ws_manager.broadcast_actor(f"user:{real_id}", payload)
    await ws_manager.broadcast_actor(f"admin:{real_id}", payload)




def _schedule_asr_start(call: models.Call) -> None:
    """Start the backend LiveKit ASR worker without blocking the call API."""
    try:
        asyncio.create_task(
            livekit_asr_manager.start_call(
                call_id=call.id,
                room_id=call.room_id,
                livekit_url=call.livekit_url,
            )
        )
        print("DEBUG livekit-asr start scheduled", {
            "call_id": call.id,
            "room_id": call.room_id,
            "livekit_url": call.livekit_url,
        })
    except Exception as exc:
        print(f"[livekit-asr] failed to schedule worker for call={call.id}: {exc}")


def _schedule_asr_stop(call_id: int | str) -> None:
    """Stop the backend LiveKit ASR worker without blocking the call API."""
    try:
        asyncio.create_task(livekit_asr_manager.stop_call(call_id))
        print("DEBUG livekit-asr stop scheduled", {"call_id": call_id})
    except Exception as exc:
        print(f"[livekit-asr] failed to schedule stop for call={call_id}: {exc}")


def _schedule_asl_start(call: models.Call) -> None:
    """Start the backend LiveKit ASL worker for video calls without blocking the call API."""
    if getattr(call, "kind", None) != "video":
        return

    try:
        asyncio.create_task(
            livekit_asl_manager.start_call(
                call_id=call.id,
                room_id=call.room_id,
                livekit_url=call.livekit_url,
            )
        )
        print("DEBUG livekit-asl start scheduled", {
            "call_id": call.id,
            "room_id": call.room_id,
            "livekit_url": call.livekit_url,
        })
    except Exception as exc:
        print(f"[livekit-asl] failed to schedule worker for call={call.id}: {exc}")


def _schedule_asl_stop(call_id: int | str) -> None:
    """Stop the backend LiveKit ASL worker without blocking the call API."""
    try:
        asyncio.create_task(livekit_asl_manager.stop_call(call_id))
        print("DEBUG livekit-asl stop scheduled", {"call_id": call_id})
    except Exception as exc:
        print(f"[livekit-asl] failed to schedule stop for call={call_id}: {exc}")


# ── Schemas ───────────────────────────────────────────────────────────────────

class StartCallRequest(BaseModel):
    callee_user_id: int
    # message conversations distinguish admin/user participants, but the old
    # call API only accepted callee_user_id. Keep default user for compatibility.
    callee_participant_type: Optional[str] = "user"
    kind: str = "audio"  # "audio" | "video"

class JoinPayload(BaseModel):
    call_id: int
    room_id: str
    livekit_url: Optional[str] = None
    access_token: Optional[str] = None
    expires_at: str
    state: str

class CallResponse(BaseModel):
    call_id: int
    room_id: str
    state: str
    kind: str
    caller_user_id: int
    callee_user_id: int
    invite_expires_at: str
    started_at: Optional[str] = None
    ended_at: Optional[str] = None
    livekit_url: Optional[str] = None
    join_payload: Optional[JoinPayload] = None
    ai_summary: Optional[str] = None

class CallSummaryResponse(BaseModel):
    today_calls: int
    missed_calls: int
    total_duration_minutes: int
    total_duration_label: str
    pending_calls_text: str

class CallHistoryItem(BaseModel):
    call_id: int
    state: str
    kind: str
    direction: str
    remote_user_id: int
    remote_name: str
    remote_role: Optional[str] = None
    started_at: Optional[str] = None
    ended_at: Optional[str] = None
    created_at: str
    duration_seconds: int
    duration_label: str

class UpdateCallModeRequest(BaseModel):
    kind: str


def _fmt_call(call: models.Call, join_payload: Optional[JoinPayload] = None) -> CallResponse:
    return CallResponse(
        call_id=call.id,
        room_id=call.room_id,
        state=call.state,
        kind=call.kind,
        caller_user_id=call.created_by_user_id,
        callee_user_id=call.callee_user_id,
        invite_expires_at=call.invite_expires_at.isoformat(),
        started_at=call.started_at.isoformat() if call.started_at else None,
        ended_at=call.ended_at.isoformat() if call.ended_at else None,
        livekit_url=call.livekit_url,
        join_payload=join_payload,
        ai_summary=call.ai_summary,
    )

def _format_duration_label(total_minutes: int) -> str:
    if total_minutes <= 0:
        return "0m"

    hours = total_minutes // 60
    minutes = total_minutes % 60

    if hours and minutes:
        return f"{hours}h {minutes}m"
    if hours:
        return f"{hours}h"
    return f"{minutes}m"

def _format_duration_seconds(total_seconds: int) -> str:
    if total_seconds <= 0:
        return "0m"

    minutes = max(1, (total_seconds + 59) // 60)
    return _format_duration_label(minutes)

def _resolve_call_display_user(db: Session, user_id: int, role_hint: Optional[str] = None) -> tuple[str, str]:
    """Resolve a readable name for call history without depending on conversations."""
    actor_type, real_user_id = _from_call_storage_id(user_id, role_hint)
    role = (role_hint or actor_type or "").lower()

    if role == "admin" or actor_type == "admin":
        admin = db.query(models.Admin).filter(models.Admin.id == real_user_id).first()
        if admin:
            return admin.full_name or admin.email or f"Admin {real_user_id}", "admin"

    user = db.query(models.User).filter(models.User.id == real_user_id).first()
    if user:
        return user.full_name or user.email or f"User {real_user_id}", user.global_role or role or "user"

    staff = db.query(models.Staff).filter(models.Staff.user_id == real_user_id).first()
    if staff:
        return staff.full_name or f"Staff {real_user_id}", staff.role or "staff"

    admin = db.query(models.Admin).filter(models.Admin.id == real_user_id).first()
    if admin:
        return admin.full_name or admin.email or f"Admin {real_user_id}", "admin"

    fallback_role = role_hint or "user"
    return f"User {real_user_id}", fallback_role

def _history_item_for_call(db: Session, call: models.Call, viewer_id: int) -> CallHistoryItem:
    is_outgoing = call.created_by_user_id == viewer_id
    remote_user_id = int(call.callee_user_id if is_outgoing else call.created_by_user_id)
    remote_participant = db.query(models.CallParticipant).filter(
        models.CallParticipant.call_id == call.id,
        models.CallParticipant.user_id == remote_user_id,
    ).first()
    remote_role_hint = remote_participant.role_at_call_time if remote_participant else None
    remote_name, remote_role = _resolve_call_display_user(db, remote_user_id, remote_role_hint)
    _, remote_public_id = _from_call_storage_id(remote_user_id, remote_role_hint)

    duration_seconds = 0
    if call.started_at and call.ended_at and call.ended_at >= call.started_at:
        duration_seconds = int((call.ended_at - call.started_at).total_seconds())

    return CallHistoryItem(
        call_id=int(call.id),
        state=call.state,
        kind=call.kind,
        direction="outgoing" if is_outgoing else "incoming",
        remote_user_id=remote_public_id,
        remote_name=remote_name,
        remote_role=remote_role,
        started_at=call.started_at.isoformat() if call.started_at else None,
        ended_at=call.ended_at.isoformat() if call.ended_at else None,
        created_at=call.created_at.isoformat(),
        duration_seconds=duration_seconds,
        duration_label=_format_duration_seconds(duration_seconds),
    )


def _message_participant_type(actor_type: Optional[str], role: Optional[str] = None) -> str:
    """Conversation participants use admin/user, while call roles may say client/staff."""
    actor_type = _normalize_actor_type(actor_type)
    if actor_type == "admin":
        return "admin"
    return "user"


def _actor_key_for_message_participant(participant_type: Optional[str], user_id: int) -> str:
    participant_type = (participant_type or "user").strip().lower()
    if participant_type in {"client", "resident", "staff", "family", "family_contact"}:
        participant_type = "user"
    return f"{participant_type}:{int(user_id)}"


def _call_party_profiles(db: Session, call: models.Call) -> list[dict]:
    """Resolve caller/callee into message-compatible participant profiles."""
    participant_rows = {
        int(p.user_id): p
        for p in db.query(models.CallParticipant).filter(models.CallParticipant.call_id == call.id).all()
    }
    profiles: list[dict] = []
    for stored_user_id in [call.created_by_user_id, call.callee_user_id]:
        if not stored_user_id:
            continue
        row = participant_rows.get(int(stored_user_id))
        role_hint = row.role_at_call_time if row else None
        actor_type, public_id = _from_call_storage_id(int(stored_user_id), role_hint)
        name, role = _resolve_call_display_user(db, int(stored_user_id), role_hint)
        profiles.append({
            "stored_user_id": int(stored_user_id),
            "actor_type": actor_type,
            "participant_type": _message_participant_type(actor_type, role),
            "user_id": int(public_id),
            "display_name": name or f"User {public_id}",
            "role": role or role_hint or actor_type or "user",
        })
    # Deduplicate caller/callee if older data accidentally repeated the same user.
    unique: dict[tuple[str, int], dict] = {}
    for profile in profiles:
        unique[(profile["participant_type"], profile["user_id"])] = profile
    return list(unique.values())


def _resolve_chat_admin_id(db: Session, call: models.Call, profiles: list[dict]) -> int:
    """Messages use admins.id as admin_id. Resolve it from call participants."""
    for profile in profiles:
        if profile["participant_type"] == "admin":
            return int(profile["user_id"])

    for profile in profiles:
        if profile["participant_type"] != "user":
            continue
        resident = db.query(models.Resident).filter(
            models.Resident.client_user_id == int(profile["user_id"]),
            models.Resident.status == "active",
        ).order_by(models.Resident.id.desc()).first()
        if resident:
            return int(resident.admin_id)

    for profile in profiles:
        if profile["participant_type"] != "user":
            continue
        staff = db.query(models.Staff).filter(models.Staff.user_id == int(profile["user_id"])).first()
        if staff:
            return int(staff.admin_id)

    return int(getattr(call, "org_id", 0) or 0)


def _conversation_has_profiles(conversation: models.Conversation, profiles: list[dict]) -> bool:
    participants = list(conversation.participants or [])
    for profile in profiles:
        wanted_type = _message_participant_type(profile.get("participant_type"), profile.get("role"))
        wanted_id = int(profile.get("user_id") or 0)
        if not any(
            _message_participant_type(p.participant_type, p.role) == wanted_type
            and int(p.user_id or 0) == wanted_id
            for p in participants
        ):
            return False
    return True


def _add_call_profile_to_conversation(conversation: models.Conversation, profile: dict) -> None:
    participant_type = _message_participant_type(profile.get("participant_type"), profile.get("role"))
    user_id = int(profile.get("user_id") or 0)
    if not user_id:
        return
    for participant in conversation.participants or []:
        if (
            _message_participant_type(participant.participant_type, participant.role) == participant_type
            and int(participant.user_id or 0) == user_id
        ):
            if profile.get("display_name") and not participant.display_name:
                participant.display_name = profile["display_name"]
            if profile.get("role") and not participant.role:
                participant.role = profile["role"]
            return
    conversation.participants.append(models.ConversationParticipant(
        conversation_id=conversation.id,
        user_id=user_id,
        participant_type=participant_type,
        display_name=profile.get("display_name") or f"User {user_id}",
        role=profile.get("role"),
    ))


def _find_or_create_call_summary_conversation(
    db: Session,
    *,
    admin_id: int,
    profiles: list[dict],
) -> Optional[models.Conversation]:
    """Find the safest existing chat for the call, or create a direct one."""
    if not admin_id or not profiles:
        return None

    rows = db.query(models.Conversation).options(
        joinedload(models.Conversation.participants)
    ).filter(
        models.Conversation.admin_id == admin_id,
        models.Conversation.category.in_(["resident", "direct"]),
    ).order_by(models.Conversation.updated_at.desc().nullslast(), models.Conversation.id.desc()).all()

    for conversation in rows:
        if _conversation_has_profiles(conversation, profiles):
            return conversation

    # Prefer the resident care conversation when one of the call parties is the linked client.
    client_profile = None
    for profile in profiles:
        if profile.get("participant_type") == "user" and str(profile.get("role") or "").lower() == "client":
            client_profile = profile
            break
    if client_profile is None:
        for profile in profiles:
            if profile.get("participant_type") != "user":
                continue
            resident = db.query(models.Resident).filter(
                models.Resident.admin_id == admin_id,
                models.Resident.client_user_id == int(profile["user_id"]),
            ).first()
            if resident:
                client_profile = profile
                break

    if client_profile is not None:
        resident = db.query(models.Resident).filter(
            models.Resident.admin_id == admin_id,
            models.Resident.client_user_id == int(client_profile["user_id"]),
        ).first()
        if resident:
            conv_name = f"Resident Care: {resident.full_name or client_profile['display_name']}"
            conversation = db.query(models.Conversation).options(
                joinedload(models.Conversation.participants)
            ).filter(
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
            for profile in profiles:
                _add_call_profile_to_conversation(conversation, profile)
            admin = db.query(models.Admin).filter(models.Admin.id == admin_id).first()
            if admin:
                _add_call_profile_to_conversation(conversation, {
                    "participant_type": "admin",
                    "user_id": int(admin.id),
                    "display_name": admin.full_name or "Admin",
                    "role": "admin",
                })
            return conversation

    # Last resort: a direct call-summary chat between the two parties.
    display_names = [profile.get("display_name") or f"User {profile.get('user_id')}" for profile in profiles]
    conversation = models.Conversation(
        admin_id=admin_id,
        name="Call Summary: " + " & ".join(display_names[:2]),
        category="direct",
        created_by=admin_id,
        unread_count=0,
    )
    db.add(conversation)
    db.flush()
    for profile in profiles:
        _add_call_profile_to_conversation(conversation, profile)
    return conversation


def _format_call_summary_chat_message(
    call: models.Call,
    *,
    patient_summary: str,
    duration_seconds: int,
    profiles: list[dict],
) -> str:
    call_type = "Video" if call.kind == "video" else "Audio"
    date_text = (call.ended_at or _now()).astimezone(timezone.utc).strftime("%d %b %Y")
    duration_label = _format_duration_seconds(duration_seconds)

    provider = next((p for p in profiles if str(p.get("role") or "").lower() in {"staff", "admin", "doctor", "external_doctor", "provider"}), None)
    patient = next((p for p in profiles if str(p.get("role") or "").lower() in {"client", "patient", "resident"}), None)

    header = [
        f"📋 {call_type} Call AI Summary",
        f"Date: {date_text} · Duration: {duration_label}",
    ]
    if provider:
        header.append(f"Care team: {provider.get('display_name')}")
    if patient:
        header.append(f"Patient: {patient.get('display_name')}")

    return "\n".join(header + ["", patient_summary.strip(), "", "This is an AI generated summary. Please confirm important care details with your care team."])


def _delivery_payload_for_ai_summary_message(message: models.Message, conversation: models.Conversation) -> dict[str, dict]:
    deliveries: dict[str, dict] = {}
    created_at = message.created_at.isoformat() if message.created_at else None
    for participant in conversation.participants or []:
        if participant.notifications_muted:
            continue
        if not participant.user_id:
            continue
        participant_type = _message_participant_type(participant.participant_type, participant.role)
        actor_key = _actor_key_for_message_participant(participant_type, int(participant.user_id))
        deliveries[actor_key] = {
            "type": "new_message",
            "conversation_id": message.conversation_id,
            "message": {
                "id": message.id,
                "conversation_id": message.conversation_id,
                "sender_name": message.sender_name,
                "sender_role": message.sender_role or "",
                "sender_user_id": message.sender_user_id,
                "sender_participant_type": getattr(message, "sender_participant_type", "system"),
                "content": message.content,
                "message_type": message.message_type,
                "is_self": False,
                "created_at": created_at,
            },
        }
    return deliveries


def _persist_ai_summary_notification(db: Session, message: models.Message, conversation: models.Conversation) -> None:
    recipients: list[int] = []
    for participant in conversation.participants or []:
        participant_type = _message_participant_type(participant.participant_type, participant.role)
        if participant_type == "user" and participant.user_id and not participant.notifications_muted:
            recipients.append(int(participant.user_id))
    if not recipients:
        return

    notification = models.Notification(
        admin_id=conversation.admin_id,
        category="message",
        title="AI call summary ready",
        body=(message.content or "")[:240],
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


async def _send_call_summary_to_chat(
    db: Session,
    call: models.Call,
    *,
    patient_summary: str,
    duration_seconds: int,
    profiles: list[dict],
) -> tuple[Optional[int], Optional[int]]:
    """Persist the patient-safe summary as a system chat message and broadcast it."""
    from backend.services import notification_service

    admin_id = _resolve_chat_admin_id(db, call, profiles)
    conversation = _find_or_create_call_summary_conversation(db, admin_id=admin_id, profiles=profiles)
    if not conversation:
        return None, None

    for profile in profiles:
        _add_call_profile_to_conversation(conversation, profile)

    content = _format_call_summary_chat_message(
        call,
        patient_summary=patient_summary,
        duration_seconds=duration_seconds,
        profiles=profiles,
    )

    # Avoid duplicate summary messages if both participants hit /end at almost the same time.
    duplicate = db.query(models.Message).filter(
        models.Message.conversation_id == conversation.id,
        models.Message.message_type == "call_summary",
        models.Message.content.like(f"%Call AI Summary%"),
        models.Message.content.like(f"%{(call.ended_at or _now()).astimezone(timezone.utc).strftime('%d %b %Y')}%"),
    ).order_by(models.Message.id.desc()).first()
    if duplicate and duplicate.content == content:
        return int(conversation.id), int(duplicate.id)

    message = models.Message(
        admin_id=conversation.admin_id,
        conversation_id=conversation.id,
        sender_user_id=None,
        sender_participant_type="system",
        sender_name="SphereCare AI",
        sender_role="AI Summary",
        content=content,
        message_type="call_summary",
        is_self=False,
    )
    db.add(message)
    conversation.last_message = content
    conversation.last_message_at = _now()
    conversation.unread_count = 0
    db.flush()
    _persist_ai_summary_notification(db, message, conversation)
    db.commit()
    db.refresh(message)
    db.refresh(conversation)

    deliveries = _delivery_payload_for_ai_summary_message(message, conversation)
    await notification_service.notify_new_message(
        message, conversation.admin_id, deliveries=deliveries, db=db
    )
    if deliveries:
        await notification_service.notify_conversation_changed(conversation.admin_id, deliveries=deliveries)
    return int(conversation.id), int(message.id)

# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("", response_model=CallResponse)
async def start_call(
    payload: StartCallRequest,
    current_user=Depends(_get_current_user),
    db: Session = Depends(get_db),
):
    """Start a call — creates ringing invite, returns caller join payload."""
    caller_id = _get_user_id(current_user)
    caller_role = _get_role(current_user)
    org_id = _get_org_id(current_user, db)
    callee_actor_type = _normalize_actor_type(payload.callee_participant_type)
    callee_id = _to_call_storage_id(callee_actor_type, payload.callee_user_id)

    if caller_id == callee_id:
        raise HTTPException(status_code=400, detail="Cannot call yourself.")

    caller_busy = db.query(models.Call).filter(
        or_(
            models.Call.created_by_user_id == caller_id,
            models.Call.callee_user_id == caller_id,
        ),
        models.Call.state.in_(["ringing", "active"]),
    ).first()
    if caller_busy:
        raise HTTPException(status_code=409, detail="You are already in another call.")

    active = db.query(models.Call).filter(
        models.Call.callee_user_id == callee_id,
        models.Call.state == "active",
    ).first()
    if active:
        raise HTTPException(status_code=409, detail="Callee is busy.")

    ringing = db.query(models.Call).filter(
        models.Call.callee_user_id == callee_id,
        models.Call.state == "ringing",
    ).first()
    if ringing:
        raise HTTPException(status_code=409, detail="Callee already has a pending invite.")

    room_id = _gen_room_id()
    expires_at = _now() + timedelta(seconds=INVITE_TTL_SECONDS)

    caller_identity = f"usr_{caller_id}"
    caller_token, caller_token_expires_at = _mint_livekit_token(
        room_id,
        caller_identity,
        str(caller_id),
    )

    print("DEBUG caller join payload", {
        "caller_id": caller_id,
        "room_id": room_id,
        "livekit_url": _livekit_url(),
        "has_token": bool(caller_token),
        "token_prefix": caller_token[:24] if caller_token else None,
        "token_expires_at": caller_token_expires_at.isoformat() if caller_token_expires_at else None,
    })

    call = models.Call(
        org_id=org_id,
        room_id=room_id,
        state="ringing",
        kind=payload.kind,
        created_by_user_id=caller_id,
        callee_user_id=callee_id,
        invite_expires_at=expires_at,
        livekit_url=_livekit_url(),
        caller_token=caller_token,
    )
    db.add(call)
    db.flush()

    db.add(
        models.CallParticipant(
            call_id=call.id,
            user_id=caller_id,
            role_at_call_time=caller_role,
            livekit_identity=caller_identity,
        )
    )
    db.add(
        models.CallParticipant(
            call_id=call.id,
            user_id=callee_id,
            role_at_call_time=callee_actor_type if callee_actor_type == "admin" else "callee",
            livekit_identity=f"usr_{callee_id}",
        )
    )

    _add_event(db, call.id, "invite_sent", caller_id, {"kind": payload.kind})
    db.commit()
    db.refresh(call)

    caller_name = getattr(current_user, "full_name", None) or getattr(current_user, "name", None) or getattr(current_user, "email", None) or str(caller_id)
    caller_actor_type, caller_public_id = _from_call_storage_id(caller_id, caller_role)

    invite_payload = {
        "type": "call.invite",
        "call_id": call.id,
        "state": call.state,
        "kind": call.kind,
        "room_id": call.room_id,
        "timestamp": _now().isoformat(),
        "caller_user_id": caller_public_id,
        "caller_participant_type": caller_actor_type,
        "caller_name": caller_name,
        "caller_role": caller_role,
        "expires_at": expires_at.isoformat(),
    }

    print("DEBUG call.invite send", {
        "call_id": call.id,
        "callee_user_id": call.callee_user_id,
        "payload": invite_payload,
    })

    await _ws_send_to_call_participant(call.callee_user_id, invite_payload, callee_actor_type)

    join = JoinPayload(
        call_id=call.id,
        room_id=room_id,
        livekit_url=call.livekit_url,
        access_token=caller_token,
        expires_at=(caller_token_expires_at or expires_at).isoformat(),
        state="ringing",
    )

    print("DEBUG caller response join", join.model_dump())

    return _fmt_call(call, join)

@router.get("/summary", response_model=CallSummaryResponse)
def get_call_summary(
    current_user=Depends(_get_current_user),
    db: Session = Depends(get_db),
):
    user_id = _get_user_id(current_user)

    now = _now().astimezone(timezone.utc)
    day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    day_end = day_start + timedelta(days=1)

    calls_today = (
        db.query(models.Call)
        .filter(
            or_(
                models.Call.created_by_user_id == user_id,
                models.Call.callee_user_id == user_id,
            ),
            models.Call.created_at >= day_start,
            models.Call.created_at < day_end,
        )
        .all()
    )

    today_calls = len(calls_today)

    # From the callee/client perspective, an unanswered incoming call should be
    # counted as missed even if the caller cancels before the timeout worker runs.
    # Completed calls have started_at set, so only ringing calls that ended before
    # being accepted are counted here.
    missed_calls = sum(
        1
        for call in calls_today
        if call.callee_user_id == user_id
        and call.started_at is None
        and call.state in ["timeout", "canceled"]
    )

    total_duration_minutes = 0
    for call in calls_today:
        if call.started_at and call.ended_at and call.ended_at >= call.started_at:
            total_seconds = int((call.ended_at - call.started_at).total_seconds())
            if total_seconds > 0:
                total_duration_minutes += max(1, (total_seconds + 59) // 60)

    live_or_pending_count = (
        db.query(models.Call)
        .filter(
            or_(
                models.Call.created_by_user_id == user_id,
                models.Call.callee_user_id == user_id,
            ),
            models.Call.state.in_(["ringing", "active"]),
        )
        .count()
    )

    if live_or_pending_count == 1:
        pending_calls_text = "1 live or pending call right now"
    elif live_or_pending_count > 1:
        pending_calls_text = f"{live_or_pending_count} live or pending calls right now"
    else:
        pending_calls_text = "No active calls right now"

    return CallSummaryResponse(
        today_calls=today_calls,
        missed_calls=missed_calls,
        total_duration_minutes=total_duration_minutes,
        total_duration_label=_format_duration_label(total_duration_minutes),
        pending_calls_text=pending_calls_text,
    )

@router.get("/history", response_model=list[CallHistoryItem])
def get_call_history(
    limit: int = Query(30, ge=1, le=100),
    current_user=Depends(_get_current_user),
    db: Session = Depends(get_db),
):
    """Recent call log for the current user.

    This endpoint is intentionally based on the calls table rather than message
    conversations, so completed admin-client calls still appear even when the
    user has no callable contacts listed yet.
    """
    user_id = _get_user_id(current_user)

    calls = (
        db.query(models.Call)
        .filter(
            or_(
                models.Call.created_by_user_id == user_id,
                models.Call.callee_user_id == user_id,
            )
        )
        .order_by(models.Call.created_at.desc())
        .limit(limit)
        .all()
    )

    return [_history_item_for_call(db, call, user_id) for call in calls]

@router.get("/{call_id}", response_model=CallResponse)
def get_call(
    call_id: int,
    current_user=Depends(_get_current_user),
    db: Session = Depends(get_db),
):
    call = db.query(models.Call).filter(models.Call.id == call_id).first()
    if not call:
        raise HTTPException(status_code=404, detail="Call not found.")

    user_id = _get_user_id(current_user)
    if user_id not in [call.created_by_user_id, call.callee_user_id]:
        raise HTTPException(status_code=403, detail="Not a participant.")

    join_payload = None
    if user_id == call.created_by_user_id and call.caller_token:
        join_payload = JoinPayload(
            call_id=call.id,
            room_id=call.room_id,
            livekit_url=call.livekit_url,
            access_token=call.caller_token,
            expires_at=((call.started_at or call.invite_expires_at) + timedelta(minutes=TOKEN_TTL_MINUTES)).isoformat(),
            state=call.state,
        )
    else:
        participant = db.query(models.CallParticipant).filter(
            models.CallParticipant.call_id == call_id,
            models.CallParticipant.user_id == user_id,
        ).first()
        if participant and participant.callee_token:
            join_payload = JoinPayload(
                call_id=call.id,
                room_id=call.room_id,
                livekit_url=call.livekit_url,
                access_token=participant.callee_token,
                expires_at=((call.started_at or call.invite_expires_at) + timedelta(minutes=TOKEN_TTL_MINUTES)).isoformat(),
                state=call.state,
            )

    return _fmt_call(call, join_payload)


@router.post("/{call_id}/accept", response_model=CallResponse)
async def accept_call(
    call_id: int,
    current_user=Depends(_get_current_user),
    db: Session = Depends(get_db),
):
    """Accept a ringing invite — issues callee token, transitions to active."""
    callee_id = _get_user_id(current_user)
    callee_role = _get_role(current_user)

    call = db.query(models.Call).filter(models.Call.id == call_id).first()
    if not call:
        raise HTTPException(status_code=404, detail="Call not found.")
    if call.callee_user_id != callee_id:
        raise HTTPException(status_code=403, detail="Not the callee for this call.")

    if call.state == "active" and call.accepted_by_user_id == callee_id:
        participant = db.query(models.CallParticipant).filter(
            models.CallParticipant.call_id == call_id,
            models.CallParticipant.user_id == callee_id,
        ).first()

        join = JoinPayload(
            call_id=call.id,
            room_id=call.room_id,
            livekit_url=call.livekit_url,
            access_token=participant.callee_token if participant else None,
            expires_at=((call.started_at or call.invite_expires_at) + timedelta(minutes=TOKEN_TTL_MINUTES)).isoformat(),
            state=call.state,
        )

        _schedule_asr_start(call)
        _schedule_asl_start(call)
        print("DEBUG callee existing join", join.model_dump())
        return _fmt_call(call, join)

    if call.state != "ringing":
        raise HTTPException(status_code=409, detail=f"Call is already {call.state}.")

    if _now() > call.invite_expires_at:
        call.state = "timeout"
        _add_event(db, call.id, "timeout")
        db.commit()
        raise HTTPException(status_code=410, detail="Invite has expired.")

    callee_identity = f"usr_{callee_id}"
    callee_token, callee_token_expires_at = _mint_livekit_token(
        call.room_id,
        callee_identity,
        str(callee_id),
    )

    print("DEBUG callee join payload", {
        "callee_id": callee_id,
        "call_id": call.id,
        "room_id": call.room_id,
        "livekit_url": call.livekit_url,
        "has_token": bool(callee_token),
        "token_prefix": callee_token[:24] if callee_token else None,
        "token_expires_at": callee_token_expires_at.isoformat() if callee_token_expires_at else None,
    })

    p = db.query(models.CallParticipant).filter(
        models.CallParticipant.call_id == call_id,
        models.CallParticipant.user_id == callee_id,
    ).first()
    if p:
        p.joined_at = _now()
        p.callee_token = callee_token

    call.state = "active"
    call.accepted_by_user_id = callee_id
    call.started_at = _now()
    _add_event(db, call.id, "accepted", callee_id)
    db.commit()
    db.refresh(call)

    await _ws_broadcast_call_event(call, "call.accepted", {
        "callee_user_id": callee_id,
        "started_at": call.started_at.isoformat() if call.started_at else None,
        "kind": call.kind,
    })

    _schedule_asr_start(call)
    _schedule_asl_start(call)

    join = JoinPayload(
        call_id=call.id,
        room_id=call.room_id,
        livekit_url=call.livekit_url,
        access_token=callee_token,
        expires_at=(callee_token_expires_at or call.invite_expires_at).isoformat(),
        state="active",
    )

    print("DEBUG callee response join", join.model_dump())

    return _fmt_call(call, join)


@router.post("/{call_id}/decline", response_model=CallResponse)
async def decline_call(
    call_id: int,
    current_user=Depends(_get_current_user),
    db: Session = Depends(get_db),
):
    callee_id = _get_user_id(current_user)
    call = db.query(models.Call).filter(models.Call.id == call_id).first()
    if not call:
        raise HTTPException(status_code=404, detail="Call not found.")
    if call.callee_user_id != callee_id:
        raise HTTPException(status_code=403, detail="Not the callee.")
    if call.state in TERMINAL_CALL_STATES:
        return _fmt_call(call)
    if call.state != "ringing":
        raise HTTPException(status_code=409, detail=f"Call is {call.state}, cannot decline.")

    call.state = "declined"
    call.ended_at = _now()
    call.end_reason = "declined"
    _add_event(db, call.id, "declined", callee_id)
    db.commit()
    db.refresh(call)

    await _ws_broadcast_call_event(call, "call.declined", {"callee_user_id": callee_id})
    return _fmt_call(call)


@router.post("/{call_id}/cancel", response_model=CallResponse)
async def cancel_call(
    call_id: int,
    current_user=Depends(_get_current_user),
    db: Session = Depends(get_db),
):
    caller_id = _get_user_id(current_user)
    call = db.query(models.Call).filter(models.Call.id == call_id).first()
    if not call:
        raise HTTPException(status_code=404, detail="Call not found.")
    if call.created_by_user_id != caller_id:
        raise HTTPException(status_code=403, detail="Not the caller.")
    if call.state in TERMINAL_CALL_STATES:
        return _fmt_call(call)
    if call.state != "ringing":
        raise HTTPException(status_code=409, detail=f"Call is {call.state}, cannot cancel.")

    call.state = "canceled"
    call.ended_at = _now()
    call.end_reason = "canceled"
    _add_event(db, call.id, "canceled", caller_id)
    db.commit()
    db.refresh(call)

    await _ws_broadcast_call_event(call, "call.canceled", {"caller_user_id": caller_id})
    return _fmt_call(call)


@router.post("/{call_id}/mode", response_model=CallResponse)
async def update_call_mode(
    call_id: int,
    payload: UpdateCallModeRequest,
    current_user=Depends(_get_current_user),
    db: Session = Depends(get_db),
):
    user_id = _get_user_id(current_user)
    requested_kind = "video" if payload.kind == "video" else "audio"

    call = db.query(models.Call).filter(models.Call.id == call_id).first()
    if not call:
        raise HTTPException(status_code=404, detail="Call not found.")
    if user_id not in [call.created_by_user_id, call.callee_user_id]:
        raise HTTPException(status_code=403, detail="Not a participant.")
    if call.state != "active":
        raise HTTPException(status_code=409, detail=f"Call is {call.state}, cannot change mode.")
    if call.kind == requested_kind:
        return _fmt_call(call)

    previous_kind = call.kind
    call.kind = requested_kind
    _add_event(db, call.id, "mode_changed", user_id, {
        "from": previous_kind,
        "to": requested_kind,
    })
    db.commit()
    db.refresh(call)

    await _ws_broadcast_call_event(call, "call.mode_changed", {
        "kind": requested_kind,
        "previous_kind": previous_kind,
        "changed_by": user_id,
        "started_at": call.started_at.isoformat() if call.started_at else None,
    })

    if requested_kind == "video":
        _schedule_asl_start(call)
    else:
        _schedule_asl_stop(call.id)

    return _fmt_call(call)


@router.post("/{call_id}/end", response_model=CallResponse)
async def end_call(
    call_id: int,
    current_user=Depends(_get_current_user),
    db: Session = Depends(get_db),
):
    user_id = _get_user_id(current_user)
    call = db.query(models.Call).filter(models.Call.id == call_id).first()
    if not call:
        raise HTTPException(status_code=404, detail="Call not found.")
    if user_id not in [call.created_by_user_id, call.callee_user_id]:
        raise HTTPException(status_code=403, detail="Not a participant.")
    if call.state in TERMINAL_CALL_STATES:
        return _fmt_call(call)

    event_type = "ended"
    ws_event = "call.ended"
    extra_payload = {"ended_by": user_id}

    if call.state == "ringing":
        if user_id == call.created_by_user_id:
            call.state = "canceled"
            call.end_reason = "canceled"
            event_type = "canceled"
            ws_event = "call.canceled"
            extra_payload = {"caller_user_id": user_id}
        else:
            call.state = "declined"
            call.end_reason = "declined"
            event_type = "declined"
            ws_event = "call.declined"
            extra_payload = {"callee_user_id": user_id}
        call.ended_at = _now()
    elif call.state == "active":
        participant = db.query(models.CallParticipant).filter(
            models.CallParticipant.call_id == call_id,
            models.CallParticipant.user_id == user_id,
        ).first()
        if participant:
            participant.left_at = _now()

        call.state = "ended"
        call.ended_at = _now()
        call.ended_by_user_id = user_id
        call.end_reason = "ended_by_participant"
    else:
        raise HTTPException(status_code=409, detail=f"Call is {call.state}, cannot end.")

    _add_event(db, call.id, event_type, user_id)
    db.commit()
    db.refresh(call)

    await _ws_broadcast_call_event(call, ws_event, extra_payload)
    _schedule_asr_stop(call.id)
    _schedule_asl_stop(call.id)
    asyncio.create_task(_generate_call_summary(call.id))
    return _fmt_call(call)


async def _generate_call_summary(call_id: int) -> None:
    """Background task: build transcript, summarise it, send patient-safe summary to chat."""
    import asyncio as _asyncio
    from backend.db.session import SessionLocal
    from backend.services import transcript_service
    from backend.services.ai.llm_client import summarize_call_transcript_versions

    transcript = transcript_service.get_and_clear_transcript(call_id)

    db = SessionLocal()
    try:
        call = db.query(models.Call).filter(models.Call.id == call_id).first()
        if not call:
            return

        duration = 0
        if call.started_at and call.ended_at:
            duration = int((call.ended_at - call.started_at).total_seconds())

        versions = await _asyncio.get_event_loop().run_in_executor(
            None, summarize_call_transcript_versions, transcript or "", duration
        )
        if not versions:
            return

        staff_summary = (versions.get("staff_summary") or "").strip()
        patient_summary = (versions.get("patient_summary") or staff_summary or "").strip()
        if not patient_summary and not staff_summary:
            return

        profiles = _call_party_profiles(db, call)
        stored_summary = {
            "staff_summary": staff_summary,
            "patient_summary": patient_summary,
            "generated_at": _now().isoformat(),
        }

        call.transcript = transcript or ""
        call.ai_summary = json.dumps(stored_summary, ensure_ascii=False)
        db.commit()
        db.refresh(call)

        conversation_id, message_id = await _send_call_summary_to_chat(
            db,
            call,
            patient_summary=patient_summary,
            duration_seconds=duration,
            profiles=profiles,
        )

        await _ws_broadcast_call_event(call, "call.summary_ready", {
            "ai_summary": patient_summary,
            "patient_summary": patient_summary,
            "staff_summary": staff_summary,
            "message_conversation_id": conversation_id,
            "message_id": message_id,
        })
    except Exception as exc:
        print(f"[call-summary] failed for call={call_id}: {exc}")
    finally:
        db.close()


@router.get("/{call_id}/events")
def get_call_events(
    call_id: int,
    current_user=Depends(_get_current_user),
    db: Session = Depends(get_db),
):
    """Audit log for a call."""
    call = db.query(models.Call).filter(models.Call.id == call_id).first()
    if not call:
        raise HTTPException(status_code=404, detail="Call not found.")
    events = db.query(models.CallEvent).filter(
        models.CallEvent.call_id == call_id
    ).order_by(models.CallEvent.created_at.asc()).all()
    return [{"id": e.id, "type": e.event_type, "actor": e.actor_user_id, "at": e.created_at.isoformat()} for e in events]


# ── Timeout worker — called from lifespan ────────────────────────────────────
async def expire_timed_out_calls(db: Session):
    """Move ringing calls past invite_expires_at to timeout state."""
    expired = db.query(models.Call).filter(
        models.Call.state == "ringing",
        models.Call.invite_expires_at < _now(),
    ).all()
    for call in expired:
        call.state = "timeout"
        call.ended_at = _now()
        call.end_reason = "timeout"
        _add_event(db, call.id, "timeout")
        await _ws_broadcast_call_event(call, "call.timeout")
        _schedule_asr_stop(call.id)
        _schedule_asl_stop(call.id)
    if expired:
        db.commit()
    return len(expired)