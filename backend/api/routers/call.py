"""
/api/v1/calls — Full call state machine.
LiveKit token minting is stubbed — fill in when LIVEKIT_* env vars are set.
"""
import json
import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import or_
from sqlalchemy.orm import Session

from backend.api.deps import get_db
from backend.api.routers.auth import _get_current_user
from backend import models
from backend.ws.ws_manager import ws_manager

router = APIRouter(prefix="/calls", tags=["Calls"])

INVITE_TTL_SECONDS = 60  # 1 minute ringing timeout
TERMINAL_CALL_STATES = {"declined", "canceled", "timeout", "ended", "failed"}


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
    """Notify both caller and callee via WS."""
    payload = {
        "type": event_type,
        "call_id": call.id,
        "state": call.state,
        "kind": call.kind,
        "room_id": call.room_id,
        "timestamp": _now().isoformat(),
        **(extra or {}),
    }
    for uid in [call.created_by_user_id, call.callee_user_id]:
        if uid:
            actor_key = f"admin:{uid}" if False else f"user:{uid}"
            await ws_manager.broadcast_actor(actor_key, payload)
            # Also try admin key
            await ws_manager.broadcast_actor(f"admin:{uid}", payload)

async def _ws_send_to_user(user_id: int | None, payload: dict):
    if not user_id:
        return

    actor_keys = [f"user:{user_id}", f"admin:{user_id}"]
    print("DEBUG ws actor_keys", actor_keys)

    for actor_key in actor_keys:
        await ws_manager.broadcast_actor(actor_key, payload)

# ── Schemas ───────────────────────────────────────────────────────────────────

class StartCallRequest(BaseModel):
    callee_user_id: int
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
    )


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

    if caller_id == payload.callee_user_id:
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
        models.Call.callee_user_id == payload.callee_user_id,
        models.Call.state == "active",
    ).first()
    if active:
        raise HTTPException(status_code=409, detail="Callee is busy.")

    ringing = db.query(models.Call).filter(
        models.Call.callee_user_id == payload.callee_user_id,
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
        callee_user_id=payload.callee_user_id,
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
            user_id=payload.callee_user_id,
            role_at_call_time="callee",
            livekit_identity=f"usr_{payload.callee_user_id}",
        )
    )

    _add_event(db, call.id, "invite_sent", caller_id, {"kind": payload.kind})
    db.commit()
    db.refresh(call)

    invite_payload = {
        "type": "call.invite",
        "call_id": call.id,
        "state": call.state,
        "kind": call.kind,
        "room_id": call.room_id,
        "timestamp": _now().isoformat(),
        "caller_user_id": caller_id,
        "expires_at": expires_at.isoformat(),
    }

    print("DEBUG call.invite send", {
        "call_id": call.id,
        "callee_user_id": call.callee_user_id,
        "payload": invite_payload,
    })

    await _ws_send_to_user(call.callee_user_id, invite_payload)

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
    return _fmt_call(call)


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
    if expired:
        db.commit()
    return len(expired)