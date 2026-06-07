"""List / enqueue / delete SCVAM job folders under scvam_input/jobs/."""

from __future__ import annotations

import json
import shutil
from pathlib import Path
from types import SimpleNamespace
from typing import Any

from sqlalchemy.orm import Session

from backend import models
from backend.core import config as app_config
from backend.services.scvam import paths as scvam_paths
from backend.services.scvam.inbox import (
    _enqueue_staging_folder,
    is_pipeline_staging_video,
    list_staging_videos,
    parse_staging_vault_id,
    resolve_staging_input,
    staging_vault_id,
)
from backend.services.scvam.script_reader import read_scvam_script_for_record, _coerce_duration_sec
from backend.services.scvam.video_meta import probe_video_duration_sec


def _safe_folder_name(name: str) -> str:
    safe = "".join(ch for ch in str(name) if ch.isalnum() or ch in {"_", "-"})
    if not safe:
        raise ValueError("Invalid folder name")
    return safe


def _scvam_unable_marker(staging_dir: Path, video_name: str | None) -> Path:
    if video_name:
        return staging_dir / f".scvam_unable.{Path(video_name).stem}"
    return staging_dir / ".scvam_unable"


def _is_scvam_unable(staging_dir: Path, video_name: str | None) -> bool:
    return _scvam_unable_marker(staging_dir, video_name).is_file()


def _set_scvam_unable(staging_dir: Path, video_name: str | None) -> None:
    _scvam_unable_marker(staging_dir, video_name).touch()


def _clear_scvam_unable(staging_dir: Path, video_name: str | None) -> None:
    _scvam_unable_marker(staging_dir, video_name).unlink(missing_ok=True)


def _job_scvam_status(job: models.ScvamJob | None) -> str:
    if not job:
        return "none"
    st = str(job.status or "").lower()
    if st == "done":
        return "ready"
    if st == "running":
        return "processing"
    if st == "pending":
        return "pending"
    if st == "failed":
        return "failed"
    return st or "none"


def _latest_job(db: Session, vault_record_id: str) -> models.ScvamJob | None:
    return (
        db.query(models.ScvamJob)
        .filter(
            models.ScvamJob.vault_record_id == vault_record_id,
            models.ScvamJob.status != "cancelled",
        )
        .order_by(models.ScvamJob.created_at.desc())
        .first()
    )


def _output_matches_video(out_dir: Path, video_stem: str) -> bool:
    """True if SCVAM output directory belongs to the requested video stem."""
    meta_path = out_dir / "metadata.json"
    if meta_path.is_file():
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
            for key in ("video_name", "original_filename"):
                val = meta.get(key)
                if val and Path(str(val)).stem == video_stem:
                    return True
            return False
        except Exception:
            pass
    # Fallback: output folder named after video stem (e.g. scvam_output/test1/)
    return out_dir.name == video_stem


def _resolve_staging_output_dir(
    db: Session,
    *,
    org_id: int,
    folder_name: str,
    job: models.ScvamJob | None,
    video_stem: str,
) -> Path | None:
    """SCVAM output folder for one video — never reuse another file's output."""
    if job and job.db_record_id:
        record = db.query(models.Record).filter(models.Record.id == job.db_record_id).first()
        if record and record.file_name:
            record_stem = Path(record.file_name).stem
            if record_stem != video_stem:
                job = None
            elif record.scvam_output_path:
                out_dir = scvam_paths.vault_root() / record.scvam_output_path
                if out_dir.is_dir() and _output_matches_video(out_dir, video_stem):
                    return out_dir

    out_dir = scvam_paths.scvam_output_dir(org_id, video_stem)
    if out_dir.is_dir() and (out_dir / "summary.txt").is_file() and _output_matches_video(out_dir, video_stem):
        return out_dir
    return None


def _migrate_legacy_folder_jobs(db: Session, *, org_id: int) -> None:
    """Re-key old folder-level jobs (vault_record_id=testing) to per-video ids."""
    all_jobs = (
        db.query(models.ScvamJob)
        .filter(models.ScvamJob.organization_id == org_id)
        .all()
    )
    legacy_jobs = [
        j
        for j in all_jobs
        if j.vault_record_id
        and "__" not in str(j.vault_record_id)
        and not str(j.vault_record_id).startswith("rec_")
    ]
    changed = False
    for job in legacy_jobs:
        folder = str(job.vault_record_id or "")
        if not folder or folder.startswith("rec_"):
            continue
        record = (
            db.query(models.Record).filter(models.Record.id == job.db_record_id).first()
            if job.db_record_id
            else None
        )
        video_name = Path(record.file_name).name if record and record.file_name else None
        if not video_name:
            continue
        new_vault_id = staging_vault_id(folder, video_name)
        if job.vault_record_id != new_vault_id:
            conflict = (
                db.query(models.ScvamJob)
                .filter(
                    models.ScvamJob.vault_record_id == new_vault_id,
                    models.ScvamJob.id != job.id,
                )
                .first()
            )
            if conflict:
                job.status = "cancelled"
                job.error_message = "Superseded by duplicate legacy staging job"
                changed = True
                continue
            job.vault_record_id = new_vault_id
            job.resident_name = f"Test · {Path(video_name).stem}"
            job.room = f"TEST-{folder}"
            changed = True
        if record and record.category == f"SCVAM staging: {folder}":
            record.category = f"SCVAM staging: {folder}/{video_name}"
            changed = True
    if changed:
        db.commit()


def _status_for_staging_video(
    job: models.ScvamJob | None,
    out_dir: Path | None,
    *,
    staging_dir: Path | None = None,
    video_name: str | None = None,
) -> str:
    """Ready only when SCVAM output exists for this exact video."""
    if staging_dir is not None and _is_scvam_unable(staging_dir, video_name):
        return "unable"
    if out_dir is not None:
        return "ready"
    if job:
        st = _job_scvam_status(job)
        if st in {"pending", "processing", "running", "failed"}:
            return st
    return "none"


def _latest_job_for_video(
    db: Session,
    *,
    folder_name: str,
    video_name: str,
) -> models.ScvamJob | None:
    vault_id = staging_vault_id(folder_name, video_name)
    job = _latest_job(db, vault_id)
    if job:
        return job
    # Legacy: one job per folder — match if record points at this video
    legacy = _latest_job(db, folder_name)
    if not legacy:
        return None
    record = (
        db.query(models.Record).filter(models.Record.id == legacy.db_record_id).first()
        if legacy.db_record_id
        else None
    )
    if record and record.file_name and Path(record.file_name).name == Path(video_name).name:
        return legacy
    return None


def _folder_entry_label(folder_name: str) -> str:
    """Display name for a jobs/ subfolder (e.g. rec_* segment staging dirs)."""
    return str(folder_name or "").strip() or "staging"


def _job_for_folder(db: Session, folder_name: str) -> models.ScvamJob | None:
    return _latest_job(db, folder_name)


def _resolve_folder_output_dir(
    db: Session,
    *,
    org_id: int,
    folder_name: str,
    job: models.ScvamJob | None,
    video_stem: str,
) -> Path | None:
    if job and job.db_record_id:
        record = db.query(models.Record).filter(models.Record.id == job.db_record_id).first()
        if record and record.scvam_output_path:
            out_dir = scvam_paths.vault_root() / record.scvam_output_path
            if out_dir.is_dir() and (out_dir / "summary.txt").is_file():
                return out_dir
    return _resolve_staging_output_dir(
        db,
        org_id=org_id,
        folder_name=folder_name,
        job=job,
        video_stem=video_stem,
    )


def _staging_entries_for_folder(
    db: Session,
    *,
    org_id: int,
    folder: Path,
) -> list[dict[str, Any]]:
    """One API row per user video, or one row for pipeline-only / work-only folders."""
    folder_name = folder.name
    entries: list[dict[str, Any]] = []
    for input_video in list_staging_videos(folder):
        entries.append(
            _staging_item(
                db,
                org_id=org_id,
                folder_name=folder_name,
                input_video=input_video,
            )
        )
    if entries:
        return entries

    job = _job_for_folder(db, folder_name)
    pipeline_video: Path | None = None
    try:
        pipeline_video = resolve_staging_input(folder)
    except FileNotFoundError:
        pipeline_video = None

    work_dir = folder / "work"
    if not pipeline_video and not work_dir.is_dir() and not job:
        return []

    video_name = pipeline_video.name if pipeline_video else ""
    label = _folder_entry_label(folder_name)
    video_stem = Path(video_name).stem if video_name else label

    duration_sec: int | None = None
    if pipeline_video:
        probed = probe_video_duration_sec(pipeline_video)
        if probed:
            duration_sec = int(round(probed))
    if duration_sec is None and job and job.duration_sec:
        duration_sec = int(job.duration_sec)

    out_dir = _resolve_folder_output_dir(
        db,
        org_id=org_id,
        folder_name=folder_name,
        job=job,
        video_stem=video_stem,
    )
    scvam_status = _status_for_staging_video(
        job, out_dir, staging_dir=folder, video_name=video_name or None
    )
    if work_dir.is_dir() and scvam_status == "none" and job and str(job.status or "").lower() in {
        "pending",
        "running",
    }:
        scvam_status = "processing"

    return [
        {
            "folder_name": folder_name,
            "video_name": video_name,
            "label": label,
            "size_bytes": int(pipeline_video.stat().st_size) if pipeline_video else 0,
            "duration_sec": duration_sec,
            "scvam_status": scvam_status,
            "job_status": job.status if job else None,
            "job_id": int(job.id) if job else None,
            "source": "scvam_staging",
        }
    ]


def _staging_item(
    db: Session,
    *,
    org_id: int,
    folder_name: str,
    input_video: Path,
) -> dict[str, Any]:
    video_name = input_video.name
    video_stem = input_video.stem
    job = _latest_job_for_video(db, folder_name=folder_name, video_name=video_name)
    duration_sec = probe_video_duration_sec(input_video)
    if duration_sec is None and job and job.duration_sec:
        duration_sec = float(job.duration_sec)

    out_dir = _resolve_staging_output_dir(
        db,
        org_id=org_id,
        folder_name=folder_name,
        job=job,
        video_stem=video_stem,
    )
    scvam_status = _status_for_staging_video(
        job, out_dir, staging_dir=input_video.parent, video_name=video_name
    )

    return {
        "folder_name": folder_name,
        "video_name": video_name,
        "label": video_stem,
        "size_bytes": int(input_video.stat().st_size),
        "duration_sec": int(round(duration_sec)) if duration_sec else None,
        "scvam_status": scvam_status,
        "job_status": job.status if job else None,
        "job_id": int(job.id) if job else None,
        "source": "scvam_staging",
    }


def list_staging_jobs(db: Session, *, org_id: int) -> list[dict[str, Any]]:
    _migrate_legacy_folder_jobs(db, org_id=org_id)

    admin = (
        db.query(models.Admin)
        .filter(models.Admin.organization_id == org_id)
        .order_by(models.Admin.id.asc())
        .first()
    )
    if admin:
        from backend.services.scvam.repair import sync_staging_records

        try:
            sync_staging_records(db, org_id=org_id, admin_id=int(admin.id))
        except Exception:
            db.rollback()

    jobs_root = scvam_paths.scvam_input_root(org_id) / "jobs"
    if not jobs_root.is_dir():
        return []

    items: list[dict[str, Any]] = []
    seen_keys: set[str] = set()

    for folder in sorted(jobs_root.iterdir()):
        if not folder.is_dir() or folder.name.startswith("."):
            continue
        for entry in _staging_entries_for_folder(db, org_id=org_id, folder=folder):
            key = f"{entry['folder_name']}/{entry['video_name'] or '__folder__'}"
            if key in seen_keys:
                continue
            seen_keys.add(key)
            items.append(entry)

    db_jobs = (
        db.query(models.ScvamJob)
        .filter(models.ScvamJob.organization_id == org_id)
        .order_by(models.ScvamJob.created_at.desc())
        .all()
    )
    for job in db_jobs:
        vault_id = str(job.vault_record_id or "")
        if not vault_id:
            continue
        record = (
            db.query(models.Record).filter(models.Record.id == job.db_record_id).first()
            if job.db_record_id
            else None
        )
        if vault_id.startswith("rec_"):
            folder_name = vault_id
            video_name = ""
            label = _folder_entry_label(folder_name)
            stem_for_out = folder_name
        else:
            folder_name, video_stem = parse_staging_vault_id(vault_id)
            video_name = Path(record.file_name).name if record and record.file_name else None
            if not video_name and video_stem:
                video_name = f"{video_stem}.mp4"
            if not video_name:
                video_name = folder_name
            label = Path(video_name).stem
            stem_for_out = Path(video_name).stem
        if is_pipeline_staging_video(video_name) and not folder_name.startswith("rec_"):
            continue
        key = f"{folder_name}/{video_name or '__folder__'}"
        if key in seen_keys:
            continue

        staging_dir = scvam_paths.scvam_input_root(org_id) / "jobs" / folder_name
        if staging_dir.is_dir():
            try:
                input_video = resolve_staging_input(
                    staging_dir,
                    video_name=video_name or None,
                )
            except FileNotFoundError:
                input_video = None
        else:
            input_video = None

        if input_video is None:
            out_dir = _resolve_folder_output_dir(
                db,
                org_id=org_id,
                folder_name=folder_name,
                job=job,
                video_stem=stem_for_out,
            )
            if not out_dir and job.status not in {"pending", "running", "done"}:
                continue
            scvam_status = _status_for_staging_video(
                job, out_dir, staging_dir=staging_dir, video_name=video_name or None
            )
            items.append(
                {
                    "folder_name": folder_name,
                    "video_name": video_name,
                    "label": label,
                    "size_bytes": int(record.file_size or 0) if record else 0,
                    "duration_sec": int(job.duration_sec) if job.duration_sec else None,
                    "scvam_status": scvam_status,
                    "job_status": job.status,
                    "job_id": int(job.id),
                    "source": "scvam_staging",
                }
            )
        else:
            items.append(
                _staging_item(
                    db,
                    org_id=org_id,
                    folder_name=folder_name,
                    input_video=input_video,
                )
            )
        seen_keys.add(key)

    items.sort(key=lambda x: (x["folder_name"], x["video_name"]))
    return items


def job_scvam_status(job: models.ScvamJob | None) -> str:
    return _job_scvam_status(job)


def _ensure_staging_record(
    db: Session,
    *,
    admin: models.Admin,
    folder_name: str,
    input_video: Path,
    duration_sec: int | None,
) -> models.Record:
    label = f"SCVAM staging: {folder_name}/{input_video.name}"
    record = (
        db.query(models.Record)
        .filter(
            models.Record.admin_id == int(admin.id),
            models.Record.category == label,
        )
        .first()
    )
    display_name = f"Test · {input_video.stem}"
    if record:
        record.resident_name = display_name
        record.notes = f"SCVAM test staging · room TEST-{folder_name}"
        record.file_size = int(input_video.stat().st_size)
        if duration_sec:
            record.duration = duration_sec
        return record

    org_id = int(admin.organization_id)
    rel = (scvam_paths.scvam_input_root(org_id) / "jobs" / folder_name / input_video.name).relative_to(
        scvam_paths.vault_root()
    ).as_posix()
    record = models.Record(
        admin_id=int(admin.id),
        created_by=int(admin.id),
        resident_name=display_name,
        category=label,
        record_type="video",
        file_url=f"localvault://staging_{folder_name}_{input_video.stem}",
        file_name=rel,
        mime_type="video/mp4" if input_video.suffix.lower() == ".mp4" else "video/webm",
        file_size=int(input_video.stat().st_size),
        duration=duration_sec,
        notes=f"SCVAM test staging · room TEST-{folder_name}",
    )
    db.add(record)
    db.flush()
    return record


def enqueue_staging_job(
    db: Session,
    *,
    org_id: int,
    admin_id: int,
    folder_name: str,
    video_name: str | None = None,
) -> models.ScvamJob:
    if not app_config.SCVAM_ENABLED:
        raise ValueError("SCVAM is disabled on this server.")

    safe = _safe_folder_name(folder_name)
    staging_dir = scvam_paths.scvam_input_root(org_id) / "jobs" / safe
    if not staging_dir.is_dir():
        raise FileNotFoundError(staging_dir)
    input_video = resolve_staging_input(staging_dir, video_name=video_name)
    _clear_scvam_unable(staging_dir, input_video.name)

    admin = db.query(models.Admin).filter(models.Admin.id == admin_id).first()
    if not admin:
        raise ValueError("Admin not found.")

    duration = probe_video_duration_sec(input_video)
    duration_sec = int(round(duration)) if duration else None
    record = _ensure_staging_record(
        db,
        admin=admin,
        folder_name=safe,
        input_video=input_video,
        duration_sec=duration_sec,
    )

    vault_id = staging_vault_id(safe, input_video.name)
    existing = _latest_job_for_video(db, folder_name=safe, video_name=input_video.name)
    if existing and existing.status in {"pending", "running"}:
        record.scvam_status = "pending"
        db.commit()
        return existing

    if existing and existing.status in {"failed", "done"}:
        existing.status = "pending"
        existing.attempts = 0
        existing.error_message = None
        existing.finished_at = None
        existing.started_at = None
        existing.vault_record_id = vault_id
        existing.staging_path = staging_dir.relative_to(scvam_paths.vault_root()).as_posix()
        existing.work_path = f"{existing.staging_path}/work"
        existing.duration_sec = duration_sec or existing.duration_sec
        existing.db_record_id = int(record.id)
        existing.resident_name = f"Test · {input_video.stem}"
        existing.room = f"TEST-{safe}"
        record.scvam_status = "pending"
        db.commit()
        db.refresh(existing)
        return existing

    job = _enqueue_staging_folder(
        db,
        org_id=org_id,
        admin_id=admin_id,
        vault_record_id=vault_id,
        staging_dir=staging_dir,
        input_video=input_video,
        original_filename=input_video.name,
        duration_sec=duration_sec,
        db_record_id=int(record.id),
        source="staging_manual",
    )
    if not job:
        raise ValueError("Could not enqueue SCVAM job for this folder.")
    record.scvam_status = "pending"
    db.commit()
    db.refresh(job)
    return job


def _delete_staging_scvam_jobs(
    db: Session,
    *,
    safe: str,
    video_name: str | None,
) -> None:
    if video_name:
        vault_id = staging_vault_id(safe, video_name)
        jobs = db.query(models.ScvamJob).filter(
            models.ScvamJob.vault_record_id.in_([vault_id, safe]),
        ).all()
        for job in jobs:
            record = (
                db.query(models.Record).filter(models.Record.id == job.db_record_id).first()
                if job.db_record_id
                else None
            )
            if job.vault_record_id == vault_id or (
                record and record.file_name and Path(record.file_name).name == Path(video_name).name
            ):
                if record:
                    record.scvam_status = "unable"
                    record.ai_summary = None
                db.delete(job)
        db.commit()
        return

    jobs = db.query(models.ScvamJob).filter(models.ScvamJob.vault_record_id == safe).all()
    composite_jobs = db.query(models.ScvamJob).filter(
        models.ScvamJob.vault_record_id.like(f"{safe}__%"),
    ).all()
    for job in (*jobs, *composite_jobs):
        if job.db_record_id:
            record = db.query(models.Record).filter(models.Record.id == job.db_record_id).first()
            if record:
                record.scvam_status = "unable"
                record.ai_summary = None
        db.delete(job)
    db.commit()


def delete_staging_scvam_output(
    db: Session,
    *,
    org_id: int,
    folder_name: str,
    video_name: str | None = None,
) -> None:
    """Remove SCVAM output and jobs only; keep the staging input video."""
    safe = _safe_folder_name(folder_name)
    root = scvam_paths.vault_root()
    staging_dir = (scvam_paths.scvam_input_root(org_id) / "jobs" / safe).resolve()
    staging_dir.relative_to(root.resolve())

    if not staging_dir.is_dir():
        raise ValueError(f"Staging folder '{safe}' not found.")

    if video_name:
        video_path = staging_dir / Path(video_name).name
        if not video_path.is_file():
            raise ValueError(f"Video '{Path(video_name).name}' not found in staging folder '{safe}'.")
        out_dir = scvam_paths.scvam_output_dir(org_id, Path(video_name).stem)
        if out_dir.is_dir():
            shutil.rmtree(out_dir, ignore_errors=True)
        work_dir = staging_dir / "work"
        if work_dir.is_dir() and not list_staging_videos(staging_dir):
            shutil.rmtree(work_dir, ignore_errors=True)
        _set_scvam_unable(staging_dir, video_name)
        _delete_staging_scvam_jobs(db, safe=safe, video_name=video_name)
        return

    out_dir = scvam_paths.scvam_output_dir(org_id, safe)
    if out_dir.is_dir():
        shutil.rmtree(out_dir, ignore_errors=True)
    work_dir = staging_dir / "work"
    if work_dir.is_dir():
        shutil.rmtree(work_dir, ignore_errors=True)
    _set_scvam_unable(staging_dir, None)
    _delete_staging_scvam_jobs(db, safe=safe, video_name=None)


def delete_staging_job(
    db: Session,
    *,
    org_id: int,
    folder_name: str,
    video_name: str | None = None,
) -> None:
    safe = _safe_folder_name(folder_name)
    root = scvam_paths.vault_root()
    staging_dir = (scvam_paths.scvam_input_root(org_id) / "jobs" / safe).resolve()
    staging_dir.relative_to(root.resolve())

    if video_name:
        video_path = staging_dir / Path(video_name).name
        if video_path.is_file():
            video_path.unlink(missing_ok=True)
        _clear_scvam_unable(staging_dir, video_name)
        out_dir = scvam_paths.scvam_output_dir(org_id, Path(video_name).stem)
        if out_dir.is_dir():
            shutil.rmtree(out_dir, ignore_errors=True)
        _delete_staging_scvam_jobs(db, safe=safe, video_name=video_name)
        return

    if staging_dir.is_dir():
        shutil.rmtree(staging_dir, ignore_errors=True)

    out_dir = scvam_paths.scvam_output_dir(org_id, safe)
    if out_dir.is_dir():
        shutil.rmtree(out_dir, ignore_errors=True)

    _delete_staging_scvam_jobs(db, safe=safe, video_name=None)


def resolve_staging_video(org_id: int, folder_name: str, video_name: str | None = None) -> Path:
    safe = _safe_folder_name(folder_name)
    staging_dir = scvam_paths.scvam_input_root(org_id) / "jobs" / safe
    if not staging_dir.is_dir():
        raise FileNotFoundError(staging_dir)
    return resolve_staging_input(staging_dir, video_name=video_name)


def read_staging_script(
    db: Session,
    *,
    org_id: int,
    folder_name: str,
    video_name: str | None = None,
) -> dict[str, Any]:
    _migrate_legacy_folder_jobs(db, org_id=org_id)

    safe = _safe_folder_name(folder_name)
    staging_dir = scvam_paths.scvam_input_root(org_id) / "jobs" / safe
    if not staging_dir.is_dir():
        raise FileNotFoundError(staging_dir)

    folder_videos = list_staging_videos(staging_dir)
    if len(folder_videos) > 1 and not video_name:
        raise ValueError(
            f"Staging folder '{safe}' has {len(folder_videos)} videos; "
            "pass video_name (e.g. test2.mp4) to load the correct script."
        )

    input_video: Path | None = None
    try:
        input_video = resolve_staging_input(staging_dir, video_name=video_name or None)
    except FileNotFoundError:
        input_video = None

    job = _job_for_folder(db, safe) if not video_name else _latest_job_for_video(
        db, folder_name=safe, video_name=video_name
    )
    if input_video is None and job is None and not (staging_dir / "work").is_dir():
        raise FileNotFoundError(f"No video in staging folder '{safe}'")

    if input_video is None:
        video_stem = _folder_entry_label(safe)
        video_name = video_name or ""
        out_dir = _resolve_folder_output_dir(
            db,
            org_id=org_id,
            folder_name=safe,
            job=job,
            video_stem=video_stem,
        )
        status = _status_for_staging_video(
            job, out_dir, staging_dir=staging_dir, video_name=video_name or None
        )
        if status == "unable":
            return {
                "scvam_status": "unable",
                "duration_sec": int(job.duration_sec) if job and job.duration_sec else None,
                "video_name": video_stem,
                "message": "SCVAM analysis was removed. Click Perform AI to analyze again.",
                "timeline": [],
            }
        if (staging_dir / "work").is_dir() and status == "none" and job and str(job.status or "").lower() in {
            "pending",
            "running",
        }:
            status = "processing"
        if out_dir is not None:
            record = None
            if job and job.db_record_id:
                record = db.query(models.Record).filter(models.Record.id == job.db_record_id).first()
            tmp = SimpleNamespace(
                id=int(record.id) if record else None,
                category=video_stem,
                duration=job.duration_sec if job else None,
                ai_summary=record.ai_summary if record else None,
                scvam_status="ready" if out_dir else status,
                scvam_output_path=out_dir.relative_to(scvam_paths.vault_root()).as_posix(),
            )
            return read_scvam_script_for_record(tmp)

        return {
            "scvam_status": status,
            "duration_sec": int(job.duration_sec) if job and job.duration_sec else None,
            "video_name": video_stem,
            "message": (
                f"SCVAM work in progress for {video_stem}."
                if status == "processing"
                else f"No SCVAM output for {video_stem} yet. Click Perform AI to analyze."
            ),
            "timeline": [],
        }

    video_name = input_video.name
    video_stem = input_video.stem
    job = _latest_job_for_video(db, folder_name=safe, video_name=video_name)

    record = None
    if job and job.db_record_id:
        record = db.query(models.Record).filter(models.Record.id == job.db_record_id).first()
        if record and record.file_name and Path(record.file_name).stem != video_stem:
            record = None
            job = None

    out_dir = _resolve_staging_output_dir(
        db,
        org_id=org_id,
        folder_name=safe,
        job=job,
        video_stem=video_stem,
    )
    out_rel = out_dir.relative_to(scvam_paths.vault_root()).as_posix() if out_dir else None
    status = _status_for_staging_video(
        job, out_dir, staging_dir=staging_dir, video_name=video_name
    )
    if status == "unable":
        probed_duration = probe_video_duration_sec(input_video)
        duration_sec = int(round(probed_duration)) if probed_duration else None
        return {
            "scvam_status": "unable",
            "duration_sec": duration_sec,
            "video_name": video_stem,
            "message": "SCVAM analysis was removed. Click Perform AI to analyze again.",
            "timeline": [],
        }

    probed_duration = probe_video_duration_sec(input_video)
    duration_sec = int(round(probed_duration)) if probed_duration else None

    tmp = SimpleNamespace(
        id=int(record.id) if record else None,
        category=video_stem,
        duration=(record.duration if record and record.duration else None)
        or duration_sec
        or (job.duration_sec if job else None),
        ai_summary=record.ai_summary if record else None,
        scvam_status=status,
        scvam_output_path=out_rel,
    )

    if out_dir is not None:
        meta = out_dir / "metadata.json"
        if meta.is_file():
            try:
                m = json.loads(meta.read_text(encoding="utf-8"))
                meta_stem = Path(str(m.get("original_filename") or m.get("video_name") or "")).stem
                if meta_stem != video_stem:
                    tmp.scvam_status = "none"
                    tmp.scvam_output_path = None
                    out_dir = None
                else:
                    tmp.duration = int(m.get("duration_sec") or 0) or tmp.duration
            except Exception:
                pass

    data = read_scvam_script_for_record(tmp)
    data["record_id"] = tmp.id
    data["source"] = "scvam_staging"
    data["video_name"] = video_stem
    data["duration_sec"] = _coerce_duration_sec(tmp.duration) or duration_sec

    if tmp.scvam_status == "none":
        data["message"] = "No SCVAM analysis yet. Click Perform AI to run the pipeline on this file."
        data["timeline"] = []
        data["heading"] = None
        data["summary_text"] = ""
        data["scvam_status"] = "none"
    elif job and job.error_message and data.get("scvam_status") == "failed":
        data["message"] = f"SCVAM analysis failed: {str(job.error_message)[:480]}"
    elif tmp.scvam_status in {"pending", "processing", "running"}:
        data["message"] = "AI analysis queued or running. Results will appear here when complete."

    return data
