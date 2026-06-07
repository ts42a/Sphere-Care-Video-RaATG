from __future__ import annotations

import json
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from sqlalchemy.orm import Session

from backend import models
from backend.core import config as app_config
from backend.services.scvam import paths as scvam_paths
from backend.services.scvam.video_meta import probe_video_duration_sec

VIDEO_EXTS = {".mp4", ".webm", ".mov", ".avi", ".mkv", ".m4v", ".wmv"}


def _is_video(path: Path) -> bool:
    return path.is_file() and path.suffix.lower() in VIDEO_EXTS


def resolve_staging_input(staging_dir: Path, video_name: str | None = None) -> Path:
    """Find input video inside a job staging folder."""
    staging_dir = staging_dir.resolve()
    if not staging_dir.is_dir():
        raise FileNotFoundError(f"Staging dir not found: {staging_dir}")

    if video_name:
        named = staging_dir / Path(video_name).name
        if named.is_file() and _is_video(named):
            return named
        raise FileNotFoundError(f"Video not found in {staging_dir}: {video_name}")

    for name in ("input.webm", "input.mp4", "input.mov", "input.mkv"):
        p = staging_dir / name
        if p.is_file():
            return p

    videos = [p for p in staging_dir.iterdir() if _is_video(p) and p.name.lower().startswith("input")]
    if not videos:
        videos = sorted(
            [p for p in staging_dir.iterdir() if _is_video(p)],
            key=lambda p: p.name.lower(),
        )
    if len(videos) == 1:
        return videos[0]
    if len(videos) > 1:
        return max(videos, key=lambda p: p.stat().st_mtime)
    raise FileNotFoundError(f"No input video in {staging_dir}")


def is_pipeline_staging_video(video_name: str) -> bool:
    """True for SCVAM internal copies (input.webm, input.mp4, …), not user test files."""
    stem = Path(str(video_name or "")).stem.lower()
    return stem == "input" or stem.startswith("input.")


def is_user_staging_folder(folder_name: str) -> bool:
    """Playback test list — exclude rolling-camera segment staging dirs (rec_*_sN)."""
    name = str(folder_name or "").strip()
    return bool(name) and not name.startswith("rec_")


def _is_staging_list_video(path: Path) -> bool:
    """User-facing staging videos only — skip SCVAM pipeline copies (input.mp4, etc.)."""
    if not _is_video(path):
        return False
    return not is_pipeline_staging_video(path.name)


def list_staging_videos(staging_dir: Path) -> list[Path]:
    """All user video files in a staging folder, sorted by name."""
    staging_dir = staging_dir.resolve()
    if not staging_dir.is_dir():
        return []
    return sorted(
        [p for p in staging_dir.iterdir() if _is_staging_list_video(p)],
        key=lambda p: p.name.lower(),
    )


def staging_vault_id(folder_name: str, video_name: str) -> str:
    """Unique job key for one video inside a shared staging folder."""
    from backend.services.scvam import paths as scvam_paths

    folder = scvam_paths._safe_folder_name(folder_name)
    stem = scvam_paths._safe_folder_name(Path(video_name).stem)
    return f"{folder}__{stem}"


def parse_staging_vault_id(vault_record_id: str) -> tuple[str, str | None]:
    """Return (folder_name, video_stem) for composite staging ids like testing__test2."""
    vid = str(vault_record_id or "")
    if "__" in vid and not vid.startswith("rec_"):
        folder, stem = vid.split("__", 1)
        if folder and stem:
            return folder, stem
    return vid, None


def _find_record_for_vault_id(db: Session, vault_record_id: str, admin_id: int) -> Optional[models.Record]:
    return (
        db.query(models.Record)
        .filter(
            models.Record.admin_id == admin_id,
            models.Record.file_name.contains(vault_record_id),
        )
        .order_by(models.Record.id.desc())
        .first()
    )


def _enqueue_staging_folder(
    db: Session,
    *,
    org_id: int,
    admin_id: int,
    vault_record_id: str,
    staging_dir: Path,
    input_video: Path,
    original_filename: str,
    duration_sec: Optional[int] = None,
    db_record_id: Optional[int] = None,
    source: str = "raw_inbox",
) -> Optional[models.ScvamJob]:
    record = None
    if db_record_id:
        record = db.query(models.Record).filter(models.Record.id == db_record_id).first()
    if not record:
        record = _find_record_for_vault_id(db, vault_record_id, admin_id)
    if not record:
        admin = db.query(models.Admin).filter(models.Admin.id == admin_id).first()
        if admin:
            from backend.services.scvam.staging_jobs import _ensure_staging_record

            folder, _stem = parse_staging_vault_id(vault_record_id)
            folder_name = folder or staging_dir.name
            probed = probe_video_duration_sec(input_video)
            duration_val = duration_sec
            if duration_val is None and probed is not None:
                duration_val = max(1, int(round(probed)))
            record = _ensure_staging_record(
                db,
                admin=admin,
                folder_name=folder_name,
                input_video=input_video,
                duration_sec=duration_val,
            )
    if not record:
        return None

    if duration_sec is None:
        probed = probe_video_duration_sec(input_video)
        if probed is not None:
            duration_sec = max(1, int(round(probed)))

    video_stem = scvam_paths._safe_folder_name(Path(original_filename).stem)
    output_rel = scvam_paths.scvam_output_dir_relative(org_id, video_stem)

    work_dir = staging_dir / "work"
    work_dir.mkdir(parents=True, exist_ok=True)
    staging_rel = staging_dir.relative_to(scvam_paths.vault_root()).as_posix()
    segment_index = scvam_paths.parse_segment_index(vault_record_id)

    if str(vault_record_id).startswith("rec_"):
        job_resident = record.resident_name
        job_room = None
    else:
        job_resident = f"Test · {Path(original_filename).stem}"
        folder_part, _ = parse_staging_vault_id(vault_record_id)
        job_room = f"TEST-{folder_part}"

    folder_part, _ = parse_staging_vault_id(vault_record_id)
    manifest = {
        "vault_record_id": vault_record_id,
        "staging_folder": folder_part or staging_dir.name,
        "organization_id": org_id,
        "admin_id": admin_id,
        "db_record_id": int(record.id),
        "input_file": input_video.name,
        "original_filename": original_filename,
        "video_name": video_stem,
        "duration_sec": duration_sec,
        "staging_path": staging_rel,
        "scvam_output_path": output_rel,
        "source": source,
        "ingested_at": datetime.now(timezone.utc).isoformat(),
    }
    (staging_dir / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=True, indent=2), encoding="utf-8")

    existing = (
        db.query(models.ScvamJob)
        .filter(
            models.ScvamJob.vault_record_id == vault_record_id,
            models.ScvamJob.segment_index == segment_index,
        )
        .first()
    )
    if existing and existing.status in {"pending", "running"}:
        return existing
    if existing and existing.status == "done" and source not in {"staging_manual", "raw_inbox"}:
        return None
    if existing:
        existing.status = "pending"
        existing.attempts = 0
        existing.error_message = None
        existing.staging_path = staging_rel
        existing.work_path = f"{staging_rel}/work"
        existing.db_record_id = int(record.id)
        existing.duration_sec = duration_sec
        existing.resident_name = job_resident
        existing.room = job_room
        job = existing
    else:
        job = models.ScvamJob(
            organization_id=org_id,
            admin_id=admin_id,
            vault_record_id=vault_record_id,
            db_record_id=int(record.id),
            enc_relative_path=record.file_name or "",
            segment_index=segment_index,
            status="pending",
            staging_path=staging_rel,
            work_path=f"{staging_rel}/work",
            max_attempts=app_config.SCVAM_MAX_ATTEMPTS,
            duration_sec=duration_sec,
            resident_name=job_resident,
            room=job_room,
        )
        db.add(job)

    record.scvam_status = "pending"
    db.flush()
    return job


def _safe_inbox_id(stem: str) -> str:
    safe = re.sub(r"[^a-zA-Z0-9_-]+", "_", stem).strip("_")
    return safe[:80] or "video"


def scan_org_inbox(db: Session, org_id: int = 1, admin_id: int = 1) -> list[models.ScvamJob]:
    """
    Intake order:
    1. RAW/ — first drop zone (source videos)
    2. jobs/{id}/ — vault uploads or promoted RAW copies
    """
    if not app_config.SCVAM_ENABLED:
        return []

    created: list[models.ScvamJob] = []
    input_root = scvam_paths.scvam_input_root(org_id)
    raw_dir = scvam_paths.raw_inbox_dir(org_id)
    jobs_root = input_root / "jobs"
    raw_dir.mkdir(parents=True, exist_ok=True)
    jobs_root.mkdir(parents=True, exist_ok=True)
    scvam_paths.scvam_output_root(org_id).mkdir(parents=True, exist_ok=True)

    # 1) RAW folder — primary intake
    for path in sorted(raw_dir.iterdir()):
        if not _is_video(path):
            continue
        original_name = path.name
        vault_id = f"raw_{_safe_inbox_id(path.stem)}"
        dest_dir = jobs_root / vault_id
        dest_dir.mkdir(parents=True, exist_ok=True)
        dest_input = dest_dir / f"input{path.suffix.lower()}"
        if not dest_input.exists():
            shutil.copy2(path, dest_input)
        # Move RAW file to processed subfolder so it is not re-queued
        processed_dir = raw_dir / "_processed"
        processed_dir.mkdir(parents=True, exist_ok=True)
        processed_dest = processed_dir / path.name
        if path.exists() and not processed_dest.exists():
            shutil.move(str(path), str(processed_dest))
        elif path.exists():
            path.unlink(missing_ok=True)

        job = _enqueue_staging_folder(
            db,
            org_id=org_id,
            admin_id=admin_id,
            vault_record_id=vault_id,
            staging_dir=dest_dir,
            input_video=dest_input,
            original_filename=original_name,
            duration_sec=None,
            db_record_id=None,
            source="raw_inbox",
        )
        if job:
            created.append(job)
            print(f"[scvam_inbox] RAW -> jobs/{vault_id} ({original_name})")

    # 2) Job folders — one queue entry per user video (e.g. testing/test4.mp4)
    for folder in sorted(jobs_root.iterdir()):
        if not folder.is_dir() or folder.name.startswith("."):
            continue
        for input_video in list_staging_videos(folder):
            vault_id = staging_vault_id(folder.name, input_video.name)
            if (
                db.query(models.ScvamJob)
                .filter(
                    models.ScvamJob.vault_record_id == vault_id,
                    models.ScvamJob.status.in_(("pending", "running", "done")),
                )
                .first()
            ):
                continue

            job = _enqueue_staging_folder(
                db,
                org_id=org_id,
                admin_id=admin_id,
                vault_record_id=vault_id,
                staging_dir=folder,
                input_video=input_video,
                original_filename=input_video.name,
                db_record_id=None,
                source="jobs_folder",
            )
            if job:
                created.append(job)
                print(f"[scvam_inbox] queued jobs/{folder.name}/{input_video.name} -> {vault_id}")

    if created:
        db.commit()
    return created
