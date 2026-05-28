from __future__ import annotations

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, Query, WebSocket, WebSocketDisconnect
from sqlalchemy.orm import Session

from backend.api.deps import get_db
from backend.api.rbac import resolve_staff_admin_scope_id
from backend.schemas.ai_explainer import (
    ExplainerChunkResponse,
    ExplainerDigestResponse,
    ExplainerJobCreate,
    ExplainerJobResponse,
)
from backend.services.ai_explainer_service import (
    broadcast_job_chunks,
    chunk_to_dict,
    digest,
    run_explainer_job,
    search_timeline,
)
from backend.services.ai_explainer_stream import ai_explainer_stream_hub

router = APIRouter(prefix="/ai/explainer", tags=["AI Explainer"])


@router.post("/jobs", response_model=ExplainerJobResponse)
async def create_job(
    payload: ExplainerJobCreate,
    admin_id: int = Depends(resolve_staff_admin_scope_id),
    db: Session = Depends(get_db),
):
    result = run_explainer_job(
        db,
        admin_id=admin_id,
        video_path=payload.video_path,
        camera_id=payload.camera_id,
        chunk_seconds=payload.chunk_seconds,
        max_frames=payload.max_frames,
    )
    await broadcast_job_chunks(payload.camera_id, result["chunks"])
    return ExplainerJobResponse(**{k: result[k] for k in ExplainerJobResponse.model_fields.keys()})


@router.get("/timeline", response_model=list[ExplainerChunkResponse])
def get_timeline(
    camera_id: Optional[str] = Query(None),
    q: Optional[str] = Query(None, description="Search query for headline/summary/zone"),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    admin_id: int = Depends(resolve_staff_admin_scope_id),
    db: Session = Depends(get_db),
):
    rows = search_timeline(db, admin_id=admin_id, camera_id=camera_id, q=q, limit=limit, offset=offset)
    return [ExplainerChunkResponse(**chunk_to_dict(row)) for row in rows]


@router.get("/digest", response_model=ExplainerDigestResponse)
def get_digest(
    camera_id: Optional[str] = Query(None),
    from_ts: Optional[datetime] = Query(None),
    to_ts: Optional[datetime] = Query(None),
    admin_id: int = Depends(resolve_staff_admin_scope_id),
    db: Session = Depends(get_db),
):
    return ExplainerDigestResponse(**digest(db, admin_id=admin_id, camera_id=camera_id, from_ts=from_ts, to_ts=to_ts))


@router.websocket("/ws/{camera_id}")
async def ws_explainer(camera_id: str, websocket: WebSocket):
    await ai_explainer_stream_hub.subscribe(camera_id, websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        ai_explainer_stream_hub.unsubscribe(camera_id, websocket)
