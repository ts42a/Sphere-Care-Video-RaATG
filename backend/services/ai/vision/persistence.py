from __future__ import annotations

from typing import Optional

from sqlalchemy.orm import Session

from backend import models
from backend.services.ai.llm_client import LLMNarrative, fallback_narrative, generate_narrative
from backend.services.ai_flag_realtime import broadcast_ai_flag_created_sync

from backend.services.ai.vision.event_schema import RuleHit


def create_flag_and_insight(
    db: Session,
    *,
    admin_id: int,
    resident_name: str,
    resident_id: Optional[int],
    camera_id: Optional[int],
    hit: RuleHit,
    model_label: str,
    use_llm: bool = True,
) -> tuple[models.Flag, models.AiInsight]:
    payload = hit.model_dump()
    narrative: LLMNarrative
    if use_llm:
        llm_out = generate_narrative(payload)
        narrative = llm_out if llm_out else fallback_narrative(payload)
    else:
        narrative = fallback_narrative(payload)

    conf = float(hit.ai_confidence)
    if conf <= 1.0:
        conf = min(100.0, round(conf * 100.0, 1))

    flag = models.Flag(
        admin_id=admin_id,
        resident_name=resident_name,
        resident_id=resident_id,
        camera_id=camera_id,
        event_type=hit.event_type,
        description=hit.description,
        severity=hit.severity,
        source="AI",
        status="Open",
        sev_desc=narrative.body[:2000] if narrative.body else None,
        transcript=hit.transcript_hint or None,
        video_timestamp=hit.video_timestamp,
        ai_confidence=conf,
    )
    db.add(flag)
    db.flush()

    insight = models.AiInsight(
        admin_id=admin_id,
        resident_id=resident_id,
        resident_name=resident_name,
        related_flag_id=flag.id,
        title=narrative.title[:255],
        body=narrative.body,
        category=hit.insight_category,
        priority=hit.insight_priority,
        is_new=True,
        generated_by_model=model_label,
    )
    db.add(insight)
    db.commit()
    db.refresh(flag)
    db.refresh(insight)
    try:
        broadcast_ai_flag_created_sync(flag, db)
    except Exception:
        pass
    return flag, insight
