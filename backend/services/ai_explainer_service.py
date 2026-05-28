from __future__ import annotations

import json
import uuid
from datetime import datetime
from pathlib import Path
from typing import Optional

from sqlalchemy import desc, or_, text
from sqlalchemy.orm import Session

from backend import models
from backend.services.ai_explainer_stream import ai_explainer_stream_hub


def _format_digest(total: int, notable: int, incident: int, avg_conf: float) -> str:
    return (
        f"Processed {total} chunks. "
        f"Notable: {notable}. "
        f"Incident-linked: {incident}. "
        f"Avg confidence: {avg_conf:.2f}."
    )


def run_explainer_job(
    db: Session,
    *,
    admin_id: int,
    video_path: str,
    camera_id: str,
    chunk_seconds: float,
    max_frames: int,
) -> dict:
    from ai.training.ai_explainer.pipeline import run_explainer_offline

    run_id = uuid.uuid4().hex[:16]
    result = run_explainer_offline(
        source=video_path,
        camera_id=camera_id,
        chunk_seconds=chunk_seconds,
        max_frames=max_frames,
        max_fps=2.0,
        detector="auto",
        db_path=None,
    )
    source_video_name = Path(video_path).name
    created_rows = []
    for n in result["narrations"]:
        row = models.AiExplainerChunk(
            admin_id=admin_id,
            camera_id=camera_id,
            chunk_id=str(n["chunk_id"]),
            zone=str(n["zone"]),
            start_ts=float(n["start_ts"]),
            end_ts=float(n["end_ts"]),
            headline=str(n["headline"]),
            summary=str(n["summary"]),
            details_json=json.dumps(n.get("details", [])),
            severity=str(n["severity"]),
            confidence=float(n["confidence"]),
            source_video=source_video_name,
            run_id=run_id,
        )
        db.add(row)
        created_rows.append(row)

    db.commit()
    for row in created_rows:
        db.refresh(row)

    return {
        "run_id": run_id,
        "camera_id": camera_id,
        "chunk_count": int(result["chunk_count"]),
        "selected_frames": int(result["selected_frames"]),
        "digest": str(result["digest"]),
        "perception_backend": str(result["perception_backend"]),
        "chunks": created_rows,
    }


def chunk_to_dict(chunk: models.AiExplainerChunk) -> dict:
    return {
        "id": int(chunk.id),
        "camera_id": chunk.camera_id,
        "chunk_id": chunk.chunk_id,
        "zone": chunk.zone,
        "start_ts": float(chunk.start_ts),
        "end_ts": float(chunk.end_ts),
        "headline": chunk.headline,
        "summary": chunk.summary,
        "details": json.loads(chunk.details_json or "[]"),
        "severity": chunk.severity,
        "confidence": float(chunk.confidence),
        "source_video": chunk.source_video,
        "run_id": chunk.run_id,
        "created_at": chunk.created_at,
    }


def search_timeline(
    db: Session,
    *,
    admin_id: int,
    camera_id: Optional[str],
    q: Optional[str],
    limit: int,
    offset: int,
) -> list[models.AiExplainerChunk]:
    query = db.query(models.AiExplainerChunk).filter(models.AiExplainerChunk.admin_id == admin_id)
    if camera_id:
        query = query.filter(models.AiExplainerChunk.camera_id == camera_id)
    if q:
        q_clean = q.strip()
        term = f"%{q_clean}%"
        # Prefer PostgreSQL full-text, fallback to ILIKE.
        fts_filter = text(
            "to_tsvector('english', coalesce(headline,'') || ' ' || coalesce(summary,'') || ' ' || coalesce(zone,'')) @@ plainto_tsquery('english', :q)"
        )
        try:
            query = query.filter(or_(fts_filter, models.AiExplainerChunk.summary.ilike(term), models.AiExplainerChunk.headline.ilike(term), models.AiExplainerChunk.zone.ilike(term))).params(q=q_clean)
        except Exception:
            query = query.filter(
                or_(
                    models.AiExplainerChunk.summary.ilike(term),
                    models.AiExplainerChunk.headline.ilike(term),
                    models.AiExplainerChunk.zone.ilike(term),
                )
            )
    return query.order_by(desc(models.AiExplainerChunk.created_at), desc(models.AiExplainerChunk.id)).offset(offset).limit(limit).all()


def digest(
    db: Session,
    *,
    admin_id: int,
    camera_id: Optional[str],
    from_ts: Optional[datetime],
    to_ts: Optional[datetime],
) -> dict:
    q = db.query(models.AiExplainerChunk).filter(models.AiExplainerChunk.admin_id == admin_id)
    if camera_id:
        q = q.filter(models.AiExplainerChunk.camera_id == camera_id)
    if from_ts:
        q = q.filter(models.AiExplainerChunk.created_at >= from_ts)
    if to_ts:
        q = q.filter(models.AiExplainerChunk.created_at <= to_ts)
    rows = q.all()
    total = len(rows)
    notable = sum(1 for r in rows if r.severity in {"notable", "incident_linked"})
    incident = sum(1 for r in rows if r.severity == "incident_linked")
    avg_conf = (sum(float(r.confidence) for r in rows) / max(1, total)) if rows else 0.0
    return {
        "camera_id": camera_id,
        "from_ts": from_ts,
        "to_ts": to_ts,
        "total_chunks": total,
        "notable_chunks": notable,
        "incident_linked_chunks": incident,
        "average_confidence": round(avg_conf, 3),
        "summary": _format_digest(total, notable, incident, avg_conf),
    }


async def broadcast_job_chunks(camera_id: str, chunks: list[models.AiExplainerChunk]) -> None:
    for chunk in chunks:
        await ai_explainer_stream_hub.publish(
            camera_id,
            {
                "type": "ai_explainer.chunk",
                "payload": chunk_to_dict(chunk),
            },
        )
