from datetime import datetime
from typing import List, Optional, Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/call", tags=["Call"])


# Pydantic Schemas

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


# Mock Data

mock_call = {
    "call_id": 1,
    "duration": "00:30",
    "doctor": {
        "name": "Dr. Sarah Wilson",
        "role": "Cardiologist",
        "initials": "SW"
    },
    "patient": {
        "name": "Dr. Sarah Mitchell",
        "role": "Consultation in progress",
        "initials": "SM"
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
            "created_at": "2026-03-13T09:30:00"
        },
        {
            "id": 2,
            "speaker": "Doctor",
            "role": "doctor",
            "content": "I understand. Can you describe the intensity on a scale of 1-10? And when did you first notice this discomfort?",
            "created_at": "2026-03-13T09:30:15"
        },
        {
            "id": 3,
            "speaker": "Patient",
            "role": "patient",
            "content": "I'd say it's around a 6 most days, but it can spike to an 8 when I'm stressed or after long work sessions.",
            "created_at": "2026-03-13T09:30:35"
        }
    ]
}


# Routes

@router.get("/current", response_model=CurrentCallResponse)
def get_current_call():
    """
    Return the current live consultation data
    for the mobile call/transcript screen.
    """
    return mock_call


@router.post("/start", response_model=CurrentCallResponse)
def start_call(payload: StartCallRequest):
    """
    Start a new consultation call.
    """
    mock_call["call_id"] += 1
    mock_call["duration"] = "00:00"
    mock_call["doctor"] = {
        "name": payload.doctor_name,
        "role": "Cardiologist",
        "initials": payload.doctor_initials
    }
    mock_call["patient"] = {
        "name": payload.patient_name,
        "role": "Consultation in progress",
        "initials": payload.patient_initials
    }
    mock_call["consultation_status"] = "Consultation in progress"
    mock_call["transcribing"] = True
    mock_call["muted"] = False
    mock_call["ended"] = False
    mock_call["transcript"] = []

    return mock_call


@router.get("/{call_id}/transcript", response_model=List[TranscriptItem])
def get_call_transcript(call_id: int):
    """
    Return transcript messages for a specific call.
    """
    if call_id != mock_call["call_id"]:
        raise HTTPException(status_code=404, detail="Call not found")

    return mock_call["transcript"]


@router.post("/{call_id}/transcript", response_model=TranscriptItem)
def add_transcript(call_id: int, payload: AddTranscriptRequest):
    """
    Add a new transcript message (doctor/patient/ai).
    Useful for prototype testing and live UI updates.
    """
    if call_id != mock_call["call_id"]:
        raise HTTPException(status_code=404, detail="Call not found")

    new_item = {
        "id": len(mock_call["transcript"]) + 1,
        "speaker": payload.speaker,
        "role": payload.role,
        "content": payload.content,
        "created_at": datetime.utcnow().isoformat()
    }

    mock_call["transcript"].append(new_item)
    return new_item


@router.patch("/{call_id}/transcribing", response_model=CallControlResponse)
def toggle_transcribing(call_id: int, payload: ToggleTranscribingRequest):
    """
    Turn AI live transcription on or off.
    """
    if call_id != mock_call["call_id"]:
        raise HTTPException(status_code=404, detail="Call not found")

    mock_call["transcribing"] = payload.transcribing

    return {
        "message": "Transcribing updated successfully",
        "call_id": call_id,
        "transcribing": mock_call["transcribing"]
    }


@router.post("/{call_id}/mute", response_model=CallControlResponse)
def mute_call(call_id: int):
    """
    Toggle mute state.
    """
    if call_id != mock_call["call_id"]:
        raise HTTPException(status_code=404, detail="Call not found")

    mock_call["muted"] = not mock_call["muted"]

    return {
        "message": "Mute status updated successfully",
        "call_id": call_id,
        "muted": mock_call["muted"]
    }


@router.post("/{call_id}/end", response_model=CallControlResponse)
def end_call(call_id: int):
    """
    End the current consultation call.
    """
    if call_id != mock_call["call_id"]:
        raise HTTPException(status_code=404, detail="Call not found")

    mock_call["ended"] = True
    mock_call["consultation_status"] = "Consultation ended"

    return {
        "message": "Call ended successfully",
        "call_id": call_id,
        "ended": True
    }


@router.post("/{call_id}/stop", response_model=CallControlResponse)
def stop_transcript_or_recording(call_id: int):
    """
    Stop AI transcription / recording for the current call.
    Matches the 'Stop' button in the UI.
    """
    if call_id != mock_call["call_id"]:
        raise HTTPException(status_code=404, detail="Call not found")

    mock_call["transcribing"] = False

    return {
        "message": "Recording/transcription stopped successfully",
        "call_id": call_id,
        "transcribing": False
    }