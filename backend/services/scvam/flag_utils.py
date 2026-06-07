"""Shared helpers for SCVAM flag creation and alert prioritization."""

from __future__ import annotations

from sqlalchemy.orm import Session

from backend import models


def primary_scvam_flag(flags: list[models.Flag]) -> models.Flag | None:
    """Pick the most important flag for camera alerts and insights (prefer fall-like)."""
    if not flags:
        return None

    def score(flag: models.Flag) -> tuple[int, int]:
        et = str(flag.event_type or "").lower()
        fall_rank = 0
        if "fall" in et:
            fall_rank = 3
        elif "immobility" in et:
            fall_rank = 1
        sev = str(flag.severity or "").lower()
        sev_rank = 2 if sev == "high" else 1 if sev == "medium" else 0
        return (fall_rank, sev_rank)

    return max(flags, key=score)


def scvam_flag_exists(
    db: Session,
    *,
    admin_id: int,
    resident_name: str,
    event_type: str,
    video_timestamp: str,
) -> bool:
    """True if an open AI flag already exists for this staging run signature."""
    row = (
        db.query(models.Flag.id)
        .filter(
            models.Flag.admin_id == admin_id,
            models.Flag.resident_name == resident_name,
            models.Flag.event_type == event_type,
            models.Flag.video_timestamp == video_timestamp,
            models.Flag.source == "AI",
            models.Flag.status == "Pending Review",
            models.Flag.is_deleted == False,  # noqa: E712
        )
        .first()
    )
    return row is not None
