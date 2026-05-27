"""
hazard_detection.py — Hazard & Sharp-Object Detection Service

Scans message content and call transcripts for keywords indicating
sharp objects, weapons, or dangerous situations.

When triggered, automatically creates:
  1. An Alert  (via models.Alert)
  2. An AI Flag (via models.Flag)

Usage:
  from backend.services.hazard_detection import check_and_flag_hazard

  # In send_message:
  await check_and_flag_hazard(db, content=msg.content, source="message", ...)

  # In call transcript handler:
  await check_and_flag_hazard(db, content=transcript, source="call", ...)
"""

from __future__ import annotations

import logging
import re
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy.orm import Session

from backend import models

logger = logging.getLogger(__name__)

# ── Detection keyword groups ──────────────────────────────────────────────────
# Each group has a severity and a human-readable event_type label.
# Patterns are matched case-insensitively against the full content string.

HAZARD_GROUPS: list[dict] = [
    {
        "event_type": "Sharp Object Detected",
        "severity": "Critical",
        "sev_desc": "Message or call contained reference to a sharp/bladed object which may pose an immediate risk.",
        "keywords": [
            r"\bknife\b", r"\bknives\b", r"\bblade\b", r"\bscalpel\b",
            r"\bsyringe\b", r"\bneedle\b", r"\bsharp\b", r"\bstab\b",
            r"\bcut\s+me\b", r"\bcutting\s+myself\b", r"\bscissor\b",
            r"\bscissors\b", r"\brazor\b", r"\bshard\b", r"\bglass\b.*\bcut\b",
            r"\bpoke\b", r"\bpierced?\b", r"\bspiked?\b",
        ],
    },
    {
        "event_type": "Weapon Detected",
        "severity": "Critical",
        "sev_desc": "Message or call contained reference to a weapon. Immediate review required.",
        "keywords": [
            r"\bgun\b", r"\bpistol\b", r"\brifle\b", r"\bshotgun\b",
            r"\bbullet\b", r"\bfirearm\b", r"\bweapon\b", r"\bshot\s+me\b",
            r"\bshooting\b", r"\baxe\b", r"\bcleaver\b", r"\bmachete\b",
            r"\bclub\b.*\bhit\b", r"\bstab\s+me\b",
        ],
    },
    {
        "event_type": "Self-Harm Concern",
        "severity": "High",
        "sev_desc": "Message or call may indicate self-harm intent. Welfare check recommended.",
        "keywords": [
            r"\bhurt\s+(my)?self\b", r"\bself[\s-]?harm\b", r"\bsuicid\w*\b",
            r"\bend\s+(it|my\s+life)\b", r"\bkill\s+myself\b",
            r"\bdon'?t\s+want\s+to\s+(live|be\s+here)\b",
            r"\bwrist\b.*\bcut\b", r"\boverdo?se\b",
        ],
    },
    {
        "event_type": "Violence / Aggression Detected",
        "severity": "High",
        "sev_desc": "Message or call contained language indicating violence or aggression toward others.",
        "keywords": [
            r"\bhit\s+(him|her|them|you)\b", r"\bbeat\s+(him|her|them|you)\b",
            r"\battack\b", r"\bthreaten\b", r"\bkill\s+(him|her|them|you)\b",
            r"\bchok(e|ing)\b", r"\bstrangle\b", r"\bpunch(ed|ing)?\b",
            r"\bfight\b", r"\bassault\b",
        ],
    },
]

# Minimum confidence score to assign to AI-detected flags (0.00–1.00)
AI_CONFIDENCE_DEFAULT = 0.82


# ── Core detection logic ──────────────────────────────────────────────────────

def _detect_hazards(content: str) -> list[dict]:
    """
    Returns a list of matched hazard groups (may be >1 if content triggers multiple groups).
    Each item: { event_type, severity, sev_desc, matched_keywords: [str] }
    """
    hits: list[dict] = []
    lowered = content.lower()

    for group in HAZARD_GROUPS:
        matched: list[str] = []
        for pattern in group["keywords"]:
            if re.search(pattern, lowered):
                # Extract the readable keyword from the pattern
                readable = re.sub(r"[\\b\\s\(\)\?\+\*\.\[\]]", "", pattern).strip()
                matched.append(readable)

        if matched:
            hits.append({
                "event_type": group["event_type"],
                "severity": group["severity"],
                "sev_desc": group["sev_desc"],
                "matched_keywords": list(set(matched)),
            })

    return hits


# ── Public API ────────────────────────────────────────────────────────────────

async def check_and_flag_hazard(
    db: Session,
    *,
    content: str,
    admin_id: int,
    source: str,                          # "message" | "call" | "transcript"
    sender_name: str = "Unknown",
    resident_name: Optional[str] = None,
    resident_id: Optional[int] = None,
    conversation_id: Optional[int] = None,
    call_room_id: Optional[str] = None,
    video_timestamp: Optional[str] = None,
) -> list[dict]:
    """
    Scan `content` for hazard keywords.
    For each match, create one Alert + one AI Flag in the DB.

    Returns list of created flag dicts (empty if no hazard detected).
    """
    if not content or not content.strip():
        return []

    hits = _detect_hazards(content)
    if not hits:
        return []

    created: list[dict] = []
    now = datetime.now(timezone.utc)

    # Build context snippet for descriptions (truncated to 200 chars)
    snippet = content[:200] + ("…" if len(content) > 200 else "")
    source_label = {
        "message": "Chat message",
        "call": "Video/audio call",
        "transcript": "Call transcript",
    }.get(source, source.capitalize())

    context_parts = [f'Source: {source_label}', f'Sender: {sender_name}']
    if resident_name:
        context_parts.append(f'Resident: {resident_name}')
    if conversation_id:
        context_parts.append(f'Conversation ID: {conversation_id}')
    if call_room_id:
        context_parts.append(f'Call room: {call_room_id}')
    context_str = " | ".join(context_parts)

    for hit in hits:
        keywords_str = ", ".join(hit["matched_keywords"])
        description = (
            f'{hit["event_type"]} detected in {source_label.lower()}. '
            f'Matched: [{keywords_str}]. '
            f'Content snippet: "{snippet}"'
        )

        # ── 1. Create Alert ──────────────────────────────────────────────────
        alert_level = "critical" if hit["severity"] == "Critical" else "warning"
        alert = models.Alert(
            admin_id=admin_id,
            level=alert_level,
            title=f'⚠ {hit["event_type"]} ({source_label})',
            message=f'{context_str}\n\nMatched keywords: {keywords_str}\n\nSnippet: "{snippet}"',
            source="AI",
            related_entity_type="conversation" if conversation_id else "call",
            related_entity_id=conversation_id or None,
            is_read=False,
            created_at=now,
        )
        db.add(alert)

        # ── 2. Create AI Flag ────────────────────────────────────────────────
        # structured context stored in sev_desc for frontend routing
        import json as _json
        context_meta = _json.dumps({
            "source": source,
            "conversation_id": conversation_id,
            "call_room_id": call_room_id,
            "sev_desc": hit["sev_desc"],
        })

        flag = models.Flag(
            admin_id=admin_id,
            resident_id=resident_id,
            resident_name=resident_name or sender_name,
            event_type=hit["event_type"],
            description=description,
            severity=hit["severity"],
            source="AI",
            status="Open",
            sev_desc=context_meta,
            transcript=content if source in ("call", "transcript") else None,
            video_timestamp=video_timestamp,
            ai_confidence=AI_CONFIDENCE_DEFAULT,
            flagged_at=now,
            created_at=now,
        )
        db.add(flag)

        created.append({
            "event_type": hit["event_type"],
            "severity": hit["severity"],
            "matched_keywords": hit["matched_keywords"],
        })

        logger.warning(
            "hazard_detected",
            extra={
                "admin_id": admin_id,
                "source": source,
                "event_type": hit["event_type"],
                "severity": hit["severity"],
                "keywords": keywords_str,
                "sender": sender_name,
                "conversation_id": conversation_id,
                "call_room_id": call_room_id,
            },
        )

    try:
        db.commit()
    except Exception as exc:
        db.rollback()
        logger.error("hazard_detection_db_error", extra={"error": str(exc)})
        return []

    return created