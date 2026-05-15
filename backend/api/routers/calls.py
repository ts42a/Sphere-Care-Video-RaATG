"""
calls.py — Call router with integrated hazard detection + call signaling

Endpoints:
  POST /calls                Create a new call (rings the callee via WebSocket)
  GET  /calls/{call_id}      Poll call state
  POST /calls/{call_id}/cancel  Cancel a ringing call
  POST /calls/{call_id}/end     End an active call
  POST /calls/transcript     Submit a call transcript for hazard scanning
  POST /calls/event          Log a call event
"""

from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.api.deps import get_current_auth_context, get_db
from backend.services.hazard_detection import check_and_flag_hazard
from backend.ws.ws_manager import ws_manager

logger = logging.getLogger(__name__)
router = APIRouter(tags=["Calls"])

# ── In-memory call store (replace with DB if you want persistence) ────────────
_calls: dict[str, dict] = {}


# ── Signaling schemas ─────────────────────────────────────────────────────────

class CreateCallRequest(BaseModel):
    callee_user_id: int
    kind: Optional[str] = "audio"   # "audio" | "video"


class CallResponse(BaseModel):
    call_id: str
    state: str   # ringing | active | declined | ended | timeout | cancelled


# ── Signaling endpoints ───────────────────────────────────────────────────────

@router.post("/calls", response_model=CallResponse, status_code=status.HTTP_201_CREATED)
async def create_call(
    body: CreateCallRequest,
    auth=Depends(get_current_auth_context),
):
    """Admin/staff initiates a call. Rings the callee via WebSocket."""
    caller_user_id = auth.get("user_id")
    caller_name = auth.get("full_name") or auth.get("name") or "Someone"

    call_id = str(uuid.uuid4())
    _calls[call_id] = {
        "call_id":        call_id,
        "caller_user_id": caller_user_id,
        "callee_user_id": body.callee_user_id,
        "kind":           body.kind,
        "state":          "ringing",
        "created_at":     datetime.now(timezone.utc).isoformat(),
    }

    # Push incoming_call to the callee's WebSocket
    callee_actor = f"user:{body.callee_user_id}"
    await ws_manager.broadcast_actor(callee_actor, {
        "type": "incoming_call",
        "call_id": call_id,
        "caller_name": caller_name,
        "caller_user_id": caller_user_id,
        "kind": body.kind,
    })

    return CallResponse(call_id=call_id, state="ringing")


@router.get("/calls/{call_id}", response_model=CallResponse)
def get_call(call_id: str, auth=Depends(get_current_auth_context)):
    """Poll call state."""
    call = _calls.get(call_id)
    if not call:
        raise HTTPException(status_code=404, detail="Call not found")
    return CallResponse(call_id=call_id, state=call["state"])


@router.post("/calls/{call_id}/cancel", status_code=status.HTTP_204_NO_CONTENT)
async def cancel_call(call_id: str, auth=Depends(get_current_auth_context)):
    """Caller cancels a ringing call."""
    call = _calls.get(call_id)
    if not call:
        return
    call["state"] = "cancelled"
    callee_actor = f"user:{call['callee_user_id']}"
    await ws_manager.broadcast_actor(callee_actor, {
        "type": "call_cancelled",
        "call_id": call_id,
    })


@router.post("/calls/{call_id}/end", status_code=status.HTTP_204_NO_CONTENT)
async def end_call(call_id: str, auth=Depends(get_current_auth_context)):
    """End an active call."""
    call = _calls.get(call_id)
    if not call:
        return
    call["state"] = "ended"
    # Notify both parties
    for actor in [f"user:{call['callee_user_id']}", f"user:{call['caller_user_id']}"]:
        await ws_manager.broadcast_actor(actor, {
            "type": "call_ended",
            "call_id": call_id,
        })


@router.post("/calls/{call_id}/accept", status_code=status.HTTP_204_NO_CONTENT)
async def accept_call(call_id: str, auth=Depends(get_current_auth_context)):
    """Callee accepts the call."""
    call = _calls.get(call_id)
    if not call:
        raise HTTPException(status_code=404, detail="Call not found")
    call["state"] = "active"
    caller_actor = f"user:{call['caller_user_id']}"
    await ws_manager.broadcast_actor(caller_actor, {
        "type": "call_accepted",
        "call_id": call_id,
        "state": "active",
    })


@router.post("/calls/{call_id}/decline", status_code=status.HTTP_204_NO_CONTENT)
async def decline_call(call_id: str, auth=Depends(get_current_auth_context)):
    """Callee declines the call."""
    call = _calls.get(call_id)
    if not call:
        return
    call["state"] = "declined"
    caller_actor = f"user:{call['caller_user_id']}"
    await ws_manager.broadcast_actor(caller_actor, {
        "type": "call_declined",
        "call_id": call_id,
        "state": "declined",
    })





# ── Request / Response schemas ────────────────────────────────────────────────

class CallTranscriptRequest(BaseModel):
    """
    Submitted when a call ends and a transcript is available.
    The transcript may be a full STT dump or a summarised string.
    """
    room_id: str
    admin_id: int
    transcript: str
    sender_name: Optional[str] = "Unknown"
    resident_name: Optional[str] = None
    resident_id: Optional[int] = None
    video_timestamp: Optional[str] = None   # e.g. "00:04:32"
    kind: Optional[str] = "video"           # "audio" | "video"


class CallEventRequest(BaseModel):
    """
    Generic call event payload.
    If it contains a 'transcript' or 'content' field the hazard scanner runs.
    """
    room_id: str
    admin_id: int
    event_type: str          # e.g. "ended" | "participant_left" | "transcript_chunk"
    actor_user_id: Optional[int] = None
    sender_name: Optional[str] = "Unknown"
    resident_name: Optional[str] = None
    resident_id: Optional[int] = None
    transcript: Optional[str] = None        # full or partial transcript
    content: Optional[str] = None           # alternative field name
    video_timestamp: Optional[str] = None
    event_data: Optional[dict] = None


class HazardDetectionResponse(BaseModel):
    scanned: bool
    hazards_found: int
    details: list[dict]


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post(
    "/calls/transcript",
    response_model=HazardDetectionResponse,
    status_code=status.HTTP_200_OK,
    summary="Submit a call transcript for hazard scanning",
)
async def submit_call_transcript(
    body: CallTranscriptRequest,
    db: Session = Depends(get_db),
):
    """
    Called after a video/audio call ends with the full transcript.
    Scans for sharp objects, weapons, self-harm language, and violence.
    Creates Alert + AI Flag for each hazard group matched.
    """
    if not body.transcript or not body.transcript.strip():
        return HazardDetectionResponse(scanned=False, hazards_found=0, details=[])

    results = await check_and_flag_hazard(
        db,
        content=body.transcript,
        admin_id=body.admin_id,
        source="call",
        sender_name=body.sender_name or "Unknown",
        resident_name=body.resident_name,
        resident_id=body.resident_id,
        call_room_id=body.room_id,
        video_timestamp=body.video_timestamp,
    )

    return HazardDetectionResponse(
        scanned=True,
        hazards_found=len(results),
        details=results,
    )


@router.post(
    "/calls/event",
    response_model=HazardDetectionResponse,
    status_code=status.HTTP_200_OK,
    summary="Log a call event; scans transcript/content for hazards if present",
)
async def log_call_event(
    body: CallEventRequest,
    db: Session = Depends(get_db),
):
    """
    Generic call event hook (state transitions, participant events, transcript chunks).
    If the event carries a transcript or content field the hazard scanner runs.
    Falls through silently if no text content is present.
    """
    text = (body.transcript or body.content or "").strip()

    if not text:
        return HazardDetectionResponse(scanned=False, hazards_found=0, details=[])

    results = await check_and_flag_hazard(
        db,
        content=text,
        admin_id=body.admin_id,
        source="transcript" if body.transcript else "call",
        sender_name=body.sender_name or "Unknown",
        resident_name=body.resident_name,
        resident_id=body.resident_id,
        call_room_id=body.room_id,
        video_timestamp=body.video_timestamp,
    )

    logger.info(
        "call_event_processed",
        extra={
            "room_id": body.room_id,
            "event_type": body.event_type,
            "admin_id": body.admin_id,
            "hazards": len(results),
        },
    )

    return HazardDetectionResponse(
        scanned=True,
        hazards_found=len(results),
        details=results,
    )