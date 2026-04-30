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
from sqlalchemy.orm import Session

from backend.api.deps import get_db
from backend.api.routers.auth import _get_current_user
from backend import models
from backend.ws.ws_manager import ws_manager

router = APIRouter(tags=["Calls"])

INVITE_TTL_SECONDS = 60  # 1 minute ringing timeout
_legacy_calls: dict[int, dict] = {}


# ── Helpers ──────────────────────────────────────────────────────────────────

def _now() -> datetime:
    return datetime.now(timezone.utc)

def _gen_room_id() -> str:
    return "room_" + uuid.uuid4().hex

def _get_org_id(current_user) -> int:
    if isinstance(current_user, models.Admin):
        return int(current_user.organization_id)
    if hasattr(current_user, 'global_role'):
        # Staff — get org via admin
        return int(getattr(current_user, 'organization_id', 0) or 0)
    return 0

def _get_user_id(current_user) -> int:
    return int(current_user.id)

def _get_role(current_user) -> str:
    if isinstance(current_user, models.Admin):
        return "admin"
    return getattr(current_user, 'global_role', 'staff') or 'staff'

def _mint_livekit_token(room_id: str, identity: str, display_name: str) -> Optional[str]:
    """
    Stub — returns None until LIVEKIT_* env vars are configured.
    Replace with: from livekit import api; ...
    """
    import os
    lk_key = os.getenv("LIVEKIT_API_KEY")
    lk_secret = os.getenv("LIVEKIT_API_SECRET")
    if not lk_key or not lk_secret:
        return None
    try:
        from livekit.api import AccessToken, VideoGrants
        token = (
            AccessToken(lk_key, lk_secret)
            .with_identity(identity)
            .with_name(display_name)
            .with_grants(VideoGrants(room_join=True, room=room_id))
            .with_ttl(timedelta(minutes=15))
            .to_jwt()
        )
        return token
    except Exception:
        return None

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

@router.post("/calls", response_model=CallResponse)
async def start_call(
    payload: StartCallRequest,
    current_user=Depends(_get_current_user),
    db: Session = Depends(get_db),
):
    """Start a call — creates ringing invite, returns caller join payload."""
    caller_id = _get_user_id(current_user)
    caller_role = _get_role(current_user)
    org_id = _get_org_id(current_user)

    if caller_id == payload.callee_user_id:
        raise HTTPException(status_code=400, detail="Cannot call yourself.")

    # Check callee not already in active call
    active = db.query(models.Call).filter(
        models.Call.callee_user_id == payload.callee_user_id,
        models.Call.state == "active",
    ).first()
    if active:
        raise HTTPException(status_code=409, detail="Callee is busy.")

    # Check no pending ringing invite
    ringing = db.query(models.Call).filter(
        models.Call.callee_user_id == payload.callee_user_id,
        models.Call.state == "ringing",
    ).first()
    if ringing:
        raise HTTPException(status_code=409, detail="Callee already has a pending invite.")

    room_id = _gen_room_id()
    expires_at = _now() + timedelta(seconds=INVITE_TTL_SECONDS)

    # Mint caller token (stub if no LiveKit)
    caller_identity = f"usr_{caller_id}"
    livekit_url = _livekit_url()
    caller_token = _mint_livekit_token(room_id, caller_identity, str(caller_id))
    if not livekit_url or not caller_token:
        raise HTTPException(
            status_code=503,
            detail="LiveKit is not configured correctly. Check LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET in backend/.env.",
        )

    call = models.Call(
        org_id=org_id,
        room_id=room_id,
        state="ringing",
        kind=payload.kind,
        created_by_user_id=caller_id,
        callee_user_id=payload.callee_user_id,
        invite_expires_at=expires_at,
        livekit_url=livekit_url,
        caller_token=caller_token,
    )
    db.add(call)
    db.flush()

    # Add participants
    db.add(models.CallParticipant(
        call_id=call.id, user_id=caller_id, role_at_call_time=caller_role,
        livekit_identity=caller_identity,
    ))
    db.add(models.CallParticipant(
        call_id=call.id, user_id=payload.callee_user_id, role_at_call_time="callee",
        livekit_identity=f"usr_{payload.callee_user_id}",
    ))

    _add_event(db, call.id, "invite_sent", caller_id, {"kind": payload.kind})
    db.commit()
    db.refresh(call)

    # Notify callee via WS
    await _ws_broadcast_call_event(call, "call.invite", {
        "caller_user_id": caller_id,
        "kind": payload.kind,
        "expires_at": expires_at.isoformat(),
    })

    join = JoinPayload(
        call_id=call.id,
        room_id=room_id,
        livekit_url=call.livekit_url,
        access_token=caller_token,
        expires_at=expires_at.isoformat(),
        state="ringing",
    )
    return _fmt_call(call, join)


@router.get("/calls/{call_id}", response_model=CallResponse)
def get_call(
    call_id: int,
    current_user=Depends(_get_current_user),
    db: Session = Depends(get_db),
):
    call = db.query(models.Call).filter(models.Call.id == call_id).first()
    if not call:
        raise HTTPException(status_code=404, detail="Call not found.")
    return _fmt_call(call)


@router.post("/calls/{call_id}/accept", response_model=CallResponse)
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
    if call.state != "ringing":
        raise HTTPException(status_code=409, detail=f"Call is already {call.state}.")
    if _now() > call.invite_expires_at:
        call.state = "timeout"
        _add_event(db, call.id, "timeout")
        db.commit()
        raise HTTPException(status_code=410, detail="Invite has expired.")

    # Mint callee token
    callee_identity = f"usr_{callee_id}"
    livekit_url = call.livekit_url or _livekit_url()
    callee_token = _mint_livekit_token(call.room_id, callee_identity, str(callee_id))
    if not livekit_url or not callee_token:
        raise HTTPException(
            status_code=503,
            detail="LiveKit is not configured correctly. Check LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET in backend/.env.",
        )

    # Update participant
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

    await _ws_broadcast_call_event(call, "call.accepted", {"callee_user_id": callee_id})

    join = JoinPayload(
        call_id=call.id,
        room_id=call.room_id,
        livekit_url=livekit_url,
        access_token=callee_token,
        expires_at=call.invite_expires_at.isoformat(),
        state="active",
    )
    return _fmt_call(call, join)


@router.post("/calls/{call_id}/decline", response_model=CallResponse)
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


@router.post("/calls/{call_id}/cancel", response_model=CallResponse)
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


@router.post("/calls/{call_id}/end", response_model=CallResponse)
async def end_call(
    call_id: int,
    current_user=Depends(_get_current_user),
    db: Session = Depends(get_db),
):
    user_id = _get_user_id(current_user)
    call = db.query(models.Call).filter(models.Call.id == call_id).first()
    if not call:
        raise HTTPException(status_code=404, detail="Call not found.")
    if call.state != "active":
        raise HTTPException(status_code=409, detail=f"Call is {call.state}, cannot end.")
    if user_id not in [call.created_by_user_id, call.callee_user_id]:
        raise HTTPException(status_code=403, detail="Not a participant.")

    # Update participant left_at
    p = db.query(models.CallParticipant).filter(
        models.CallParticipant.call_id == call_id,
        models.CallParticipant.user_id == user_id,
    ).first()
    if p:
        p.left_at = _now()

    call.state = "ended"
    call.ended_at = _now()
    call.ended_by_user_id = user_id
    call.end_reason = "ended_by_participant"
    _add_event(db, call.id, "ended", user_id)
    db.commit()
    db.refresh(call)

    await _ws_broadcast_call_event(call, "call.ended", {"ended_by": user_id})
    return _fmt_call(call)


@router.get("/calls/{call_id}/events")
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


# ── Legacy /api/v1/call/* compatibility endpoints ────────────────────────────

class LegacyStartCallRequest(BaseModel):
    doctor_name: str
    patient_name: str
    doctor_initials: str
    patient_initials: str
    mode: str = "audio"


@router.post("/call/start")
def legacy_start_call(
    payload: LegacyStartCallRequest,
    current_user=Depends(_get_current_user),
):
    call_id = int(uuid.uuid4().int % 1_000_000_000)
    started_at = _now()
    _legacy_calls[call_id] = {
        "owner_user_id": _get_user_id(current_user),
        "doctor": {
            "name": payload.doctor_name,
            "role": "Doctor",
            "initials": payload.doctor_initials,
        },
        "patient": {
            "name": payload.patient_name,
            "role": "Patient",
            "initials": payload.patient_initials,
        },
        "consultation_status": "Consultation ongoing",
        "transcribing": True,
        "muted": False,
        "ended": False,
        "mode": payload.mode if payload.mode in {"audio", "video"} else "audio",
        "started_at": started_at,
        "transcript": [],
    }
    return {
        "call_id": call_id,
        "duration": "00:00",
        "doctor": _legacy_calls[call_id]["doctor"],
        "patient": _legacy_calls[call_id]["patient"],
        "consultation_status": _legacy_calls[call_id]["consultation_status"],
        "transcribing": True,
        "mode": _legacy_calls[call_id]["mode"],
        "transcript": [],
    }


@router.get("/call/current")
def legacy_current_call(
    current_user=Depends(_get_current_user),
):
    user_id = _get_user_id(current_user)
    for call_id, call in _legacy_calls.items():
        if call["owner_user_id"] != user_id or call["ended"]:
            continue
        elapsed = int(max((_now() - call["started_at"]).total_seconds(), 0))
        mm = str(elapsed // 60).zfill(2)
        ss = str(elapsed % 60).zfill(2)
        return {
            "call_id": call_id,
            "duration": f"{mm}:{ss}",
            "doctor": call["doctor"],
            "patient": call["patient"],
            "consultation_status": call["consultation_status"],
            "transcribing": call["transcribing"],
            "mode": call["mode"],
            "transcript": call["transcript"],
        }
    raise HTTPException(status_code=404, detail="No active call")


@router.get("/call/{call_id}/transcript")
def legacy_call_transcript(
    call_id: int,
    current_user=Depends(_get_current_user),
):
    call = _legacy_calls.get(call_id)
    if not call or call["owner_user_id"] != _get_user_id(current_user):
        raise HTTPException(status_code=404, detail="Call not found")
    return call["transcript"]


@router.post("/call/{call_id}/mute")
def legacy_mute_call(
    call_id: int,
    current_user=Depends(_get_current_user),
):
    call = _legacy_calls.get(call_id)
    if not call or call["owner_user_id"] != _get_user_id(current_user):
        raise HTTPException(status_code=404, detail="Call not found")
    call["muted"] = not call["muted"]
    return {
        "message": "Mute state updated",
        "call_id": call_id,
        "muted": call["muted"],
    }


@router.post("/call/{call_id}/stop")
def legacy_stop_call(
    call_id: int,
    current_user=Depends(_get_current_user),
):
    call = _legacy_calls.get(call_id)
    if not call or call["owner_user_id"] != _get_user_id(current_user):
        raise HTTPException(status_code=404, detail="Call not found")
    call["transcribing"] = False
    call["consultation_status"] = "AI transcription stopped"
    return {
        "message": "Transcription stopped",
        "call_id": call_id,
        "transcribing": False,
    }


@router.post("/call/{call_id}/end")
def legacy_end_call(
    call_id: int,
    current_user=Depends(_get_current_user),
):
    call = _legacy_calls.get(call_id)
    if not call or call["owner_user_id"] != _get_user_id(current_user):
        raise HTTPException(status_code=404, detail="Call not found")
    call["ended"] = True
    call["consultation_status"] = "Consultation ended"
    return {
        "message": "Call ended",
        "call_id": call_id,
        "ended": True,
    }