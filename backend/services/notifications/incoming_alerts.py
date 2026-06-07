"""Unified incoming alert feed for real-time staff notifications."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy.orm import Session

from backend import models


def _severity_from_level(level: str | None) -> str:
    lv = str(level or "").lower()
    if lv in ("critical", "high"):
        return "critical"
    if lv in ("warning", "medium"):
        return "high"
    return "medium"


def _severity_from_flag(flag: models.Flag) -> str:
    sev = str(flag.severity or "").lower()
    if sev == "high":
        return "critical"
    if sev == "medium":
        return "high"
    return "medium"


def _iso(dt: datetime | None) -> str:
    if not dt:
        return ""
    return dt.isoformat()


def collect_incoming_alerts(db: Session, admin_id: int, *, limit: int = 30) -> list[dict]:
    """
    Return deduplicated incoming alerts for polling.

    SCVAM creates Alert + Flag + CameraAlert for the same event; we prefer
    dashboard Alert rows and skip duplicate flags / camera alerts.
    """
    items: list[dict] = []
    linked_flag_ids: set[int] = set()
    alert_titles: set[str] = set()

    unread_alerts = (
        db.query(models.Alert)
        .filter(models.Alert.admin_id == admin_id, models.Alert.is_read == False)  # noqa: E712
        .order_by(models.Alert.created_at.desc())
        .limit(limit)
        .all()
    )

    for alert in unread_alerts:
        alert_titles.add(alert.title)
        action_url = "/pages/dashboard.html"
        entity_id = int(alert.id)
        if alert.related_entity_type == "flag" and alert.related_entity_id:
            linked_flag_ids.add(int(alert.related_entity_id))
            entity_id = int(alert.related_entity_id)
            action_url = f"/pages/flags.html?flag={entity_id}"

        items.append(
            {
                "key": f"alert:{alert.id}",
                "alert_type": "alert",
                "title": alert.title,
                "message": (alert.message or "")[:900],
                "severity": _severity_from_level(alert.level),
                "action_url": action_url,
                "created_at": _iso(alert.created_at),
                "entity_id": entity_id,
            }
        )

    pending_flags = (
        db.query(models.Flag)
        .filter(
            models.Flag.admin_id == admin_id,
            models.Flag.is_deleted == False,  # noqa: E712
            models.Flag.status.in_(["Pending Review", "Open", "Escalated"]),
        )
        .order_by(models.Flag.flagged_at.desc())
        .limit(limit)
        .all()
    )

    for flag in pending_flags:
        if int(flag.id) in linked_flag_ids:
            continue
        items.append(
            {
                "key": f"flag:{flag.id}",
                "alert_type": "flag",
                "title": f"{flag.event_type} — {flag.resident_name or 'Resident'}",
                "message": (flag.description or flag.sev_desc or "")[:900],
                "severity": _severity_from_flag(flag),
                "action_url": f"/pages/flags.html?flag={flag.id}",
                "created_at": _iso(flag.flagged_at or flag.created_at),
                "entity_id": int(flag.id),
            }
        )

    camera_alerts = (
        db.query(models.CameraAlert)
        .filter(
            models.CameraAlert.admin_id == admin_id,
            models.CameraAlert.resolved == False,  # noqa: E712
        )
        .order_by(models.CameraAlert.created_at.desc())
        .limit(limit)
        .all()
    )

    for cam in camera_alerts:
        if cam.title in alert_titles:
            continue
        items.append(
            {
                "key": f"camera:{cam.id}",
                "alert_type": "camera",
                "title": cam.title,
                "message": (cam.description or "")[:900],
                "severity": _severity_from_level(cam.severity),
                "action_url": "/pages/recording_console.html",
                "created_at": _iso(cam.created_at),
                "entity_id": int(cam.id),
            }
        )

    items.sort(key=lambda x: x.get("created_at") or "", reverse=True)
    return items[:limit]
