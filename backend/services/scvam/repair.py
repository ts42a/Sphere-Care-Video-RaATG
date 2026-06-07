"""One-shot repair for org SCVAM staging: sync records, dedupe flags/alerts, fix paths."""

from __future__ import annotations

import json
import re
import shutil
from collections import defaultdict
from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session

from backend import models
from backend.services.scvam import paths as scvam_paths
from backend.services.scvam.inbox import list_staging_videos, staging_vault_id
from backend.services.scvam.staging_jobs import _ensure_staging_record
from backend.services.scvam.video_meta import probe_video_duration_sec


def _rename_staging_folder(org_id: int, old_name: str, new_name: str) -> bool:
    root = scvam_paths.scvam_input_root(org_id) / "jobs"
    src = root / old_name
    dest = root / new_name
    if not src.is_dir() or dest.exists():
        return False
    shutil.move(str(src), str(dest))
    return True


def _patch_output_metadata(out_dir: Path, *, vault_record_id: str, staging_folder: str, db_record_id: int | None) -> None:
    meta_path = out_dir / "metadata.json"
    if not meta_path.is_file():
        return
    try:
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
    except Exception:
        meta = {}
    meta["vault_record_id"] = vault_record_id
    meta["staging_folder"] = staging_folder
    if db_record_id is not None:
        meta["db_record_id"] = db_record_id
    meta_path.write_text(json.dumps(meta, ensure_ascii=True, indent=2), encoding="utf-8")

    for name in ("events.json", "llm_summary.json"):
        p = out_dir / name
        if not p.is_file():
            continue
        try:
            data = json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            continue
        if isinstance(data, dict) and "video" in data:
            data["video"] = re.sub(
                r"jobs/[^/]+/",
                f"jobs/{staging_folder}/",
                str(data.get("video") or ""),
            )
            p.write_text(json.dumps(data, ensure_ascii=True, indent=2), encoding="utf-8")


def sync_staging_records(db: Session, *, org_id: int, admin_id: int) -> int:
    """Ensure each staging video has a records row linked to scvam_output when present."""
    admin = db.query(models.Admin).filter(models.Admin.id == admin_id).first()
    if not admin:
        return 0

    jobs_root = scvam_paths.scvam_input_root(org_id) / "jobs"
    if not jobs_root.is_dir():
        return 0

    count = 0
    for folder in sorted(jobs_root.iterdir()):
        if not folder.is_dir() or folder.name.startswith("."):
            continue
        for video in list_staging_videos(folder):
            duration = probe_video_duration_sec(video)
            duration_sec = int(round(duration)) if duration else None
            record = _ensure_staging_record(
                db,
                admin=admin,
                folder_name=folder.name,
                input_video=video,
                duration_sec=duration_sec,
            )
            out_dir = scvam_paths.scvam_output_dir(org_id, video.stem)
            if out_dir.is_dir():
                rel = out_dir.relative_to(scvam_paths.vault_root()).as_posix()
                record.scvam_output_path = rel
                record.scvam_status = "ready"
                summary_path = out_dir / "summary.txt"
                if summary_path.is_file():
                    lines = summary_path.read_text(encoding="utf-8").splitlines()
                    for line in lines[4:]:
                        if line.strip() and not line.startswith("-"):
                            record.ai_summary = line.strip()
                            break
                vault_id = staging_vault_id(folder.name, video.name)
                _patch_output_metadata(
                    out_dir,
                    vault_record_id=vault_id,
                    staging_folder=folder.name,
                    db_record_id=int(record.id),
                )
            count += 1
    db.commit()
    return count


def dedupe_scvam_flags(db: Session, *, admin_id: int) -> dict[str, int]:
    """Remove duplicate SCVAM flags; keep newest id per (resident, event, timestamp)."""
    flags = (
        db.query(models.Flag)
        .filter(
            models.Flag.admin_id == admin_id,
            models.Flag.source == "AI",
        )
        .order_by(models.Flag.id.asc())
        .all()
    )
    groups: dict[tuple[str, str, str], list[models.Flag]] = defaultdict(list)
    for f in flags:
        key = (str(f.resident_name or ""), str(f.event_type or ""), str(f.video_timestamp or ""))
        groups[key].append(f)

    removed_flags = 0
    removed_alerts = 0
    removed_camera = 0
    for _key, rows in groups.items():
        if len(rows) <= 1:
            continue
        keep = rows[-1]
        for dup in rows[:-1]:
            dup_id = int(dup.id)
            alerts = (
                db.query(models.Alert)
                .filter(
                    models.Alert.related_entity_type == "flag",
                    models.Alert.related_entity_id == dup_id,
                )
                .all()
            )
            for a in alerts:
                db.delete(a)
                removed_alerts += 1
            db.delete(dup)
            removed_flags += 1

    # Dedupe camera alerts with same title (keep newest)
    cam_groups: dict[str, list[models.CameraAlert]] = defaultdict(list)
    for ca in (
        db.query(models.CameraAlert)
        .filter(models.CameraAlert.admin_id == admin_id)
        .order_by(models.CameraAlert.id.asc())
        .all()
    ):
        cam_groups[str(ca.title or "")].append(ca)
    for _title, rows in cam_groups.items():
        if len(rows) <= 1:
            continue
        for dup in rows[:-1]:
            db.delete(dup)
            removed_camera += 1

    db.commit()
    return {
        "removed_flags": removed_flags,
        "removed_alerts": removed_alerts,
        "removed_camera_alerts": removed_camera,
    }


def relink_ai_insights(db: Session, *, admin_id: int) -> int:
    """Point orphaned SCVAM insights at the newest matching flag when possible."""
    insights = (
        db.query(models.AiInsight)
        .filter(
            models.AiInsight.admin_id == admin_id,
            models.AiInsight.generated_by_model == "scvam2.1",
            models.AiInsight.related_flag_id.is_(None),
        )
        .all()
    )
    updated = 0
    for ins in insights:
        if not ins.resident_name:
            continue
        flag = (
            db.query(models.Flag)
            .filter(
                models.Flag.admin_id == admin_id,
                models.Flag.resident_name == ins.resident_name,
                models.Flag.source == "AI",
            )
            .order_by(models.Flag.id.desc())
            .first()
        )
        if flag:
            ins.related_flag_id = int(flag.id)
            updated += 1
    db.commit()
    return updated


def purge_orphan_staging_records(db: Session, *, admin_id: int) -> int:
    """Remove staging records whose input file no longer exists on disk."""
    from backend.services.records_purge import purge_record

    root = scvam_paths.vault_root()
    removed = 0
    rows = (
        db.query(models.Record)
        .filter(
            models.Record.admin_id == admin_id,
            models.Record.category.like("SCVAM staging:%"),
        )
        .all()
    )
    for record in rows:
        rel = str(record.file_name or "")
        if not rel:
            continue
        if not (root / rel).is_file():
            purge_record(db, record)
            removed += 1
    db.commit()
    return removed


def repair_org_scvam(
    db: Session,
    *,
    org_id: int = 1,
    admin_id: int = 1,
    rename_test_folder: bool = True,
) -> dict[str, Any]:
    """
    Repair org_1-style SCVAM state:
    - optional jobs/test -> jobs/testing rename
    - sync staging records + output paths
    - dedupe flags/alerts
    - relink ai_insights
    """
    result: dict[str, Any] = {"org_id": org_id, "admin_id": admin_id}
    if rename_test_folder:
        result["renamed_test_to_testing"] = _rename_staging_folder(org_id, "test", "testing")
    result["orphan_records_removed"] = purge_orphan_staging_records(db, admin_id=admin_id)
    result["records_synced"] = sync_staging_records(db, org_id=org_id, admin_id=admin_id)
    result.update(dedupe_scvam_flags(db, admin_id=admin_id))
    result["insights_relinked"] = relink_ai_insights(db, admin_id=admin_id)
    return result
