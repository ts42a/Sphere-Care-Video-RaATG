"""
SCVAM2.1 worker — polls scvam_jobs and runs the analysis pipeline.

Standalone:
  python -m backend.workers.scvam_worker

Auto-starts inside uvicorn when SCVAM_WORKER_AUTOSTART=true (see backend.main lifespan).
"""

from __future__ import annotations

import argparse
import os
import sys
import threading
import time
from datetime import datetime, timedelta, timezone
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from threading import Event


def _bootstrap_path() -> None:
    root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
    if root not in sys.path:
        sys.path.insert(0, root)


def _sweep_stale_staging(ttl_hours: int) -> None:
    from backend.core import config as app_config
    from backend.services.scvam import paths as scvam_paths

    root = scvam_paths.vault_root()
    cutoff = datetime.now(timezone.utc) - timedelta(hours=max(1, ttl_hours))
    for org_dir in root.glob("org_*/scvam_input/jobs"):
        if not org_dir.is_dir():
            continue
        for job_dir in org_dir.iterdir():
            if not job_dir.is_dir():
                continue
            try:
                mtime = datetime.fromtimestamp(job_dir.stat().st_mtime, tz=timezone.utc)
            except OSError:
                continue
            if mtime < cutoff:
                import shutil

                shutil.rmtree(job_dir, ignore_errors=True)


def _process_one_job() -> bool:
    from backend import models
    from backend.db.session import SessionLocal
    from backend.services.scvam import paths as scvam_paths
    from backend.services.scvam.persist import apply_scvam_results, cleanup_staging, mark_job_failed
    from backend.services.scvam.results import parse_scvam_outputs
    from backend.services.scvam.runner import run_scvam_pipeline

    db = SessionLocal()
    try:
        q = (
            db.query(models.ScvamJob)
            .filter(
                models.ScvamJob.status == "pending",
                models.ScvamJob.attempts < models.ScvamJob.max_attempts,
            )
            .order_by(models.ScvamJob.created_at.asc())
        )
        try:
            job = q.with_for_update(skip_locked=True).first()
        except Exception:
            job = q.first()
        if not job:
            return False

        job.attempts = int(job.attempts or 0) + 1
        job.status = "running"
        job.started_at = datetime.now(timezone.utc)
        record = db.query(models.Record).filter(models.Record.id == job.db_record_id).first()
        if record:
            record.scvam_status = "processing"
        db.commit()

        from pathlib import Path

        from backend.services.scvam.inbox import resolve_staging_input

        staging_dir = scvam_paths.vault_root() / (job.staging_path or "")
        work_root = staging_dir / "work"

        try:
            record = db.query(models.Record).filter(models.Record.id == job.db_record_id).first()
            video_name = Path(record.file_name).name if record and record.file_name else None
            try:
                input_video = resolve_staging_input(staging_dir, video_name=video_name)
            except FileNotFoundError:
                record = db.query(models.Record).filter(models.Record.id == job.db_record_id).first()
                admin = db.query(models.Admin).filter(models.Admin.id == job.admin_id).first()
                if not record or not admin:
                    raise
                from backend.services.scvam.staging import ensure_staging_for_retry

                staging_dir, staging_rel = ensure_staging_for_retry(
                    record=record,
                    admin=admin,
                    job=job,
                )
                job.staging_path = staging_rel
                db.commit()
                video_name = Path(record.file_name).name if record.file_name else None
                input_video = resolve_staging_input(staging_dir, video_name=video_name)

            run_result = run_scvam_pipeline(input_video=input_video, work_root=work_root)
            parsed = parse_scvam_outputs(run_result.llm_summary_path, run_result.events_path)
            apply_scvam_results(
                db, job=job, run_result=run_result, parsed=parsed, source_video=input_video
            )
            # Keep manual drop folders (e.g. jobs/testing); only remove vault upload staging.
            if str(job.vault_record_id or "").startswith("rec_"):
                cleanup_staging(job.staging_path)
            else:
                print(f"[scvam_worker] kept manual staging folder {job.staging_path}")
            print(f"[scvam_worker] job {job.id} done (record {job.db_record_id})")
        except Exception as exc:
            db.rollback()
            db.refresh(job)
            err = str(exc)
            requeue = int(job.attempts) < int(job.max_attempts)
            # Windows STATUS_CONTROL_C_EXIT when uvicorn --reload kills the pipeline child.
            if "3221225786" in err or "C000013A" in err.upper():
                requeue = True
                job.attempts = max(0, int(job.attempts) - 1)
            mark_job_failed(db, job=job, error_message=err, requeue=requeue)
            print(f"[scvam_worker] job {job.id} failed (attempt {job.attempts}): {exc}")
        return True
    finally:
        db.close()


def _scan_inbox_once() -> None:
    from backend.db.session import SessionLocal
    from backend.services.scvam.inbox import scan_org_inbox

    db = SessionLocal()
    try:
        scan_org_inbox(db, org_id=1, admin_id=1)
    finally:
        db.close()


def _requeue_stale_running_jobs() -> None:
    from backend.db.session import SessionLocal
    from backend.services.scvam.persist import requeue_interrupted_jobs

    db = SessionLocal()
    try:
        n = requeue_interrupted_jobs(db)
        if n:
            print(f"[scvam_worker] requeued {n} interrupted job(s)")
    finally:
        db.close()


def run_scvam_worker_loop(
    *,
    poll_sec: int | None = None,
    stop_event: Event | None = None,
) -> None:
    """Poll for pending SCVAM jobs until stop_event is set (daemon thread from uvicorn)."""
    _bootstrap_path()
    from backend.core import config as app_config

    if not app_config.SCVAM_ENABLED:
        print("[scvam_worker] SCVAM_ENABLED is false; worker loop not started.")
        return

    poll = max(1, int(poll_sec or app_config.SCVAM_WORKER_POLL_SEC))
    print(
        f"[scvam_worker] started (poll={poll}s, package={app_config.SCVAM_PACKAGE_DIR}, "
        f"autostart={app_config.SCVAM_WORKER_AUTOSTART})"
    )
    _sweep_stale_staging(app_config.SCVAM_STAGING_TTL_HOURS)
    _requeue_stale_running_jobs()

    while True:
        if stop_event is not None and stop_event.is_set():
            print("[scvam_worker] stopped.")
            break

        try:
            _scan_inbox_once()
            worked = _process_one_job()
        except Exception as exc:
            print(f"[scvam_worker] loop error: {exc}")
            worked = False

        if worked:
            continue

        if stop_event is not None:
            if stop_event.wait(timeout=poll):
                break
        else:
            time.sleep(poll)

        _sweep_stale_staging(app_config.SCVAM_STAGING_TTL_HOURS)


def main() -> int:
    _bootstrap_path()
    from backend.core import config as app_config

    parser = argparse.ArgumentParser(description="Sphere Care SCVAM2.1 worker")
    parser.add_argument("--poll", type=int, default=app_config.SCVAM_WORKER_POLL_SEC, help="Poll interval seconds")
    parser.add_argument("--once", action="store_true", help="Process at most one job then exit")
    parser.add_argument(
        "--scan-inbox",
        action="store_true",
        help="Scan scvam_input for loose videos / job folders, enqueue, then exit",
    )
    args = parser.parse_args()

    if not app_config.SCVAM_ENABLED:
        print("SCVAM_ENABLED is false; exiting.")
        return 0

    if args.scan_inbox:
        _scan_inbox_once()
        print("[scvam_inbox] scan complete")
        if args.once:
            return 0

    if args.once:
        _scan_inbox_once()
        _process_one_job()
        return 0

    run_scvam_worker_loop(poll_sec=args.poll)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
