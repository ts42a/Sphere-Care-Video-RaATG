"""
calls.py — Hazard detection hooks for call transcripts and events.

Endpoints:
  POST /calls/transcript   Submit a full call transcript for hazard scanning
  POST /calls/event        Log a call event; scans transcript/content for hazards
"""

from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.api.deps import get_db
from backend.services.hazard_detection import check_and_flag_hazard

logger = logging.getLogger(__name__)
router = APIRouter(tags=["Calls"])


# ── Schemas ───────────────────────────────────────────────────────────────────

class CallTranscriptRequest(BaseModel):
    room_id: str
    admin_id: int
    transcript: str
    sender_name: Optional[str] = "Unknown"
    resident_name: Optional[str] = None
    resident_id: Optional[int] = None
    video_timestamp: Optional[str] = None
    kind: Optional[str] = "video"


class CallEventRequest(BaseModel):
    room_id: str
    admin_id: int
    event_type: str
    actor_user_id: Optional[int] = None
    sender_name: Optional[str] = "Unknown"
    resident_name: Optional[str] = None
    resident_id: Optional[int] = None
    transcript: Optional[str] = None
    content: Optional[str] = None
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
