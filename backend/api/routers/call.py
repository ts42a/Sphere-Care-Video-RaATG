from datetime import datetime, timezone
from typing import List, Literal, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from backend.ws.ws_manager import ws_manager

router = APIRouter(tags=["Call"])


class TranscriptItem(BaseModel):
    id: int
    speaker: str
    role: Literal["doctor", "patient", "ai"]
    content: str
    created_at: str


class CallParticipant(BaseModel):
    name: str
    role: str
    initials: str


class CurrentCallResponse(BaseModel):
    call_id: int
    mode: Literal["audio", "video"]
    started_at: str
    duration: str
    doctor: CallParticipant
    patient: CallParticipant
    consultation_status: str
    transcribing: bool
    transcript: List[TranscriptItem]


class StartCallRequest(BaseModel):
    doctor_name: str
    patient_name: str
    patient_initials: str = "PT"
    doctor_initials: str = "DR"
    mode: Literal["audio", "video"] = "audio"


class AddTranscriptRequest(BaseModel):
    speaker: str
    role: Literal["doctor", "patient", "ai"]
    content: str


class ToggleTranscribingRequest(BaseModel):
    transcribing: bool


class CallControlResponse(BaseModel):
    message: str
    call_id: int
    muted: Optional[bool] = None
    transcribing: Optional[bool] = None
    ended: Optional[bool] = None


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def iso_now() -> str:
    return now_utc().isoformat()


def parse_iso(dt_str: str) -> datetime:
    return datetime.fromisoformat(dt_str)


def format_duration_from_started_at(
    started_at: str,
    ended: bool = False,
    ended_at: Optional[str] = None,
) -> str:
    start_dt = parse_iso(started_at)

    if ended and ended_at:
        end_dt = parse_iso(ended_at)
    else:
        end_dt = now_utc()

    total_seconds = max(0, int((end_dt - start_dt).total_seconds()))
    minutes = total_seconds // 60
    seconds = total_seconds % 60
    return f"{minutes:02d}:{seconds:02d}"


mock_call = {
    "call_id": 1,
    "mode": "audio",
    "started_at": iso_now(),
    "ended_at": None,
    "doctor": {
        "name": "Dr. Sarah Wilson",
        "role": "Cardiologist",
        "initials": "SW",
    },
    "patient": {
        "name": "Client User",
        "role": "Patient",
        "initials": "CU",
    },
    "consultation_status": "Consultation in progress",
    "transcribing": True,
    "muted": False,
    "ended": False,
    "transcript": [
        {
            "id": 1,
            "speaker": "Patient",
            "role": "patient",
            "content": "It's more of a dull ache, especially after I've been sitting for long periods. Sometimes it radiates down to my lower back.",
            "created_at": "2026-03-13T09:30:00+00:00",
        },
        {
            "id": 2,
            "speaker": "Doctor",
            "role": "doctor",
            "content": "I understand. Can you describe the intensity on a scale of 1 to 10? And when did you first notice this discomfort?",
            "created_at": "2026-03-13T09:30:15+00:00",
        },
        {
            "id": 3,
            "speaker": "Patient",
            "role": "patient",
            "content": "I'd say it's around a 6 most days, but it can spike to an 8 when I'm stressed or after long work sessions.",
            "created_at": "2026-03-13T09:30:35+00:00",
        },
    ],
}


def build_current_call_response() -> dict:
    duration = format_duration_from_started_at(
        mock_call["started_at"],
        ended=mock_call["ended"],
        ended_at=mock_call["ended_at"],
    )

    return {
        "call_id": mock_call["call_id"],
        "mode": mock_call["mode"],
        "started_at": mock_call["started_at"],
        "duration": duration,
        "doctor": mock_call["doctor"],
        "patient": mock_call["patient"],
        "consultation_status": mock_call["consultation_status"],
        "transcribing": mock_call["transcribing"],
        "transcript": mock_call["transcript"],
    }


async def broadcast_call_connection_state(call_id: int, state: str):
    await ws_manager.broadcast_call(
        str(call_id),
        {
            "type": "call_connection_state",
            "payload": {
                "call_id": str(call_id),
                "state": state,
            },
        },
    )


async def broadcast_call_ended(call_id: int):
    await ws_manager.broadcast_call(
        str(call_id),
        {
            "type": "call_ended",
            "payload": {
                "call_id": str(call_id),
            },
        },
    )


async def broadcast_call_remote_media(call_id: int, audio_enabled: bool, video_enabled: bool):
    await ws_manager.broadcast_call(
        str(call_id),
        {
            "type": "call_remote_media_updated",
            "payload": {
                "call_id": str(call_id),
                "audio_enabled": audio_enabled,
                "video_enabled": video_enabled,
                "camera_facing": "front",
            },
        },
    )


async def broadcast_call_transcript_updated(call_id: int, item: dict):
    await ws_manager.broadcast_call(
        str(call_id),
        {
            "type": "call_transcript_updated",
            "payload": {
                "call_id": str(call_id),
                "item": item,
            },
        },
    )


async def broadcast_call_transcribing_updated(call_id: int, transcribing: bool):
    await ws_manager.broadcast_call(
        str(call_id),
        {
            "type": "call_transcribing_updated",
            "payload": {
                "call_id": str(call_id),
                "transcribing": transcribing,
            },
        },
    )


@router.get("/current", response_model=CurrentCallResponse)
async def get_current_call():
    return build_current_call_response()


@router.post("/start", response_model=CurrentCallResponse)
async def start_call(payload: StartCallRequest):
    mock_call["call_id"] += 1
    mock_call["mode"] = payload.mode
    mock_call["started_at"] = iso_now()
    mock_call["ended_at"] = None
    mock_call["doctor"] = {
        "name": payload.doctor_name,
        "role": "Doctor",
        "initials": payload.doctor_initials,
    }
    mock_call["patient"] = {
        "name": payload.patient_name,
        "role": "Patient",
        "initials": payload.patient_initials,
    }
    mock_call["consultation_status"] = "Consultation in progress"
    mock_call["transcribing"] = True
    mock_call["muted"] = False
    mock_call["ended"] = False
    mock_call["transcript"] = []

    await broadcast_call_connection_state(mock_call["call_id"], "connected")
    await broadcast_call_remote_media(
        mock_call["call_id"],
        audio_enabled=True,
        video_enabled=payload.mode == "video",
    )

    return build_current_call_response()


@router.get("/{call_id}/transcript", response_model=List[TranscriptItem])
async def get_call_transcript(call_id: int):
    if call_id != mock_call["call_id"]:
        raise HTTPException(status_code=404, detail="Call not found")

    return mock_call["transcript"]


@router.post("/{call_id}/transcript", response_model=TranscriptItem)
async def add_transcript(call_id: int, payload: AddTranscriptRequest):
    if call_id != mock_call["call_id"]:
        raise HTTPException(status_code=404, detail="Call not found")

    new_item = {
        "id": len(mock_call["transcript"]) + 1,
        "speaker": payload.speaker,
        "role": payload.role,
        "content": payload.content,
        "created_at": iso_now(),
    }

    mock_call["transcript"].append(new_item)
    await broadcast_call_transcript_updated(call_id, new_item)
    return new_item


@router.patch("/{call_id}/transcribing", response_model=CallControlResponse)
async def toggle_transcribing(call_id: int, payload: ToggleTranscribingRequest):
    if call_id != mock_call["call_id"]:
        raise HTTPException(status_code=404, detail="Call not found")

    mock_call["transcribing"] = payload.transcribing
    await broadcast_call_transcribing_updated(call_id, mock_call["transcribing"])

    return {
        "message": "Transcribing updated successfully",
        "call_id": call_id,
        "transcribing": mock_call["transcribing"],
    }


@router.post("/{call_id}/mute", response_model=CallControlResponse)
async def mute_call(call_id: int):
    if call_id != mock_call["call_id"]:
        raise HTTPException(status_code=404, detail="Call not found")

    mock_call["muted"] = not mock_call["muted"]

    await broadcast_call_remote_media(
        call_id,
        audio_enabled=not mock_call["muted"],
        video_enabled=mock_call["mode"] == "video",
    )

    return {
        "message": "Mute status updated successfully",
        "call_id": call_id,
        "muted": mock_call["muted"],
    }


@router.post("/{call_id}/end", response_model=CallControlResponse)
async def end_call(call_id: int):
    if call_id != mock_call["call_id"]:
        raise HTTPException(status_code=404, detail="Call not found")

    mock_call["ended"] = True
    mock_call["ended_at"] = iso_now()
    mock_call["consultation_status"] = "Consultation ended"

    await broadcast_call_connection_state(call_id, "ended")
    await broadcast_call_ended(call_id)

    return {
        "message": "Call ended successfully",
        "call_id": call_id,
        "ended": True,
    }


@router.post("/{call_id}/stop", response_model=CallControlResponse)
async def stop_transcript_or_recording(call_id: int):
    if call_id != mock_call["call_id"]:
        raise HTTPException(status_code=404, detail="Call not found")

    mock_call["transcribing"] = False
    await broadcast_call_transcribing_updated(call_id, False)

    return {
        "message": "Recording or transcription stopped successfully",
        "call_id": call_id,
        "transcribing": False,
    }
