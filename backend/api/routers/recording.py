"""
Recording Console API

  POST   /recording/start          Start a recording session for a camera
  POST   /recording/stop/{id}      Stop a session and trigger analysis + merge
  GET    /recording/sessions        List all sessions
  GET    /recording/sessions/{id}   Session detail + analysis results
  GET    /recording/download/{id}   Stream the merged MP4 (model-internal only)
"""
from __future__ import annotations

from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import FileResponse
from pydantic import BaseModel

from backend.api.deps import get_db
from backend.api.rbac import resolve_staff_admin_scope_id
from backend.services.ai.vision.recorder import recording_manager

router = APIRouter(prefix="/recording", tags=["Recording"])


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------
class StartRecordingRequest(BaseModel):
    camera_id: int
    stream_url: str
    resident_id: Optional[int] = None
    resident_name: str = "Unknown"


class SessionSummary(BaseModel):
    session_id: str
    camera_id: int
    stream_url: str
    resident_name: str
    started_at: str
    status: str
    clips_recorded: int
    events_detected: int
    merged_path: Optional[str]


def _summarise(s) -> SessionSummary:
    return SessionSummary(
        session_id=s.session_id,
        camera_id=s.camera_id,
        stream_url=s.stream_url,
        resident_name=s.resident_name,
        started_at=s.started_at.isoformat(),
        status=s.status,
        clips_recorded=len(s.clips),
        events_detected=sum(len(r) for r in s.analysis_results),
        merged_path=str(s.merged_path) if s.merged_path else None,
    )


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------
@router.post("/start", status_code=status.HTTP_201_CREATED)
async def start_recording(
    body: StartRecordingRequest,
    admin_id: int = Depends(resolve_staff_admin_scope_id),
):
    """Begin continuous recording for a camera stream."""
    session_id = await recording_manager.start(
        camera_id=body.camera_id,
        stream_url=body.stream_url,
        admin_id=admin_id,
        resident_id=body.resident_id,
        resident_name=body.resident_name,
    )
    return {"session_id": session_id, "status": "recording"}


@router.post("/stop/{session_id}")
async def stop_recording(
    session_id: str,
    admin_id: int = Depends(resolve_staff_admin_scope_id),
):
    """
    Stop recording.  Triggers clip analysis and merge.
    Returns when the full pipeline (analysis + merge) completes.
    """
    session = await recording_manager.stop(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found.")
    return _summarise(session)


@router.get("/sessions", response_model=List[SessionSummary])
def list_sessions(
    admin_id: int = Depends(resolve_staff_admin_scope_id),
):
    return [_summarise(s) for s in recording_manager.list_sessions()]


@router.get("/sessions/{session_id}", response_model=SessionSummary)
def get_session(
    session_id: str,
    admin_id: int = Depends(resolve_staff_admin_scope_id),
):
    s = recording_manager.get(session_id)
    if not s:
        raise HTTPException(status_code=404, detail="Session not found.")
    return _summarise(s)


@router.get("/download/{session_id}", include_in_schema=False)
def download_merged(
    session_id: str,
    admin_id: int = Depends(resolve_staff_admin_scope_id),
):
    """
    Stream the final merged MP4.  The file lives in the private .recordings
    folder — it is never served via a public static mount.
    """
    merged = recording_manager.merged_path(session_id)
    if not merged or not Path(merged).exists():
        raise HTTPException(status_code=404, detail="Merged file not ready.")
    return FileResponse(
        path=str(merged),
        media_type="video/mp4",
        filename=f"recording_{session_id[:8]}.mp4",
    )
