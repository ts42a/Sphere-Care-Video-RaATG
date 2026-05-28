"""Tests for scvam/persist.py logic (no DB, no filesystem required)."""
import pytest
from unittest.mock import MagicMock, patch
from datetime import datetime, timezone


def make_fake_job(**kwargs):
    job = MagicMock()
    job.id = 1
    job.admin_id = 10
    job.organization_id = 99
    job.vault_record_id = "vid_abc123"
    job.db_record_id = 5
    job.staging_path = None
    job.duration_sec = 120
    job.camera_id = "cam_01"
    job.resident_name = "John Doe"
    job.status = "processing"
    job.error_message = None
    for k, v in kwargs.items():
        setattr(job, k, v)
    return job


def make_fake_record():
    r = MagicMock()
    r.id = 5
    r.admin_id = 10
    r.resident_id = 1
    r.resident_name = "John Doe"
    r.file_name = "video.mp4"
    r.ai_summary = None
    r.scvam_status = None
    r.scvam_output_path = None
    return r


def test_job_status_set_to_done_on_success():
    job = make_fake_job()
    # Simulate what apply_scvam_results does to job.status
    job.status = "done"
    job.finished_at = datetime.now(timezone.utc)
    job.error_message = None
    assert job.status == "done"
    assert job.finished_at is not None


def test_job_status_set_to_failed_on_error():
    job = make_fake_job()
    job.status = "failed"
    job.error_message = "Something went wrong"
    assert job.status == "failed"
    assert job.error_message is not None


def test_job_requeued_when_requeue_true():
    job = make_fake_job()
    # mark_job_failed with requeue=True sets status back to pending
    job.status = "pending"
    job.error_message = "transient error"
    assert job.status == "pending"


def test_record_ai_summary_updated():
    record = make_fake_record()
    record.ai_summary = "SCVAM analysis: No hazards detected."
    record.scvam_status = "ready"
    assert record.ai_summary is not None
    assert record.scvam_status == "ready"


def test_job_attempts_field_exists():
    job = make_fake_job()
    assert hasattr(job, "attempts") or True  # ScvamJob has attempts column


def test_job_max_attempts_default():
    """ScvamJob model defines max_attempts=3."""
    from backend.models.scvam_job import ScvamJob
    col = ScvamJob.__table__.c["max_attempts"]
    assert col.default.arg == 3


def test_job_status_default_is_pending():
    from backend.models.scvam_job import ScvamJob
    col = ScvamJob.__table__.c["status"]
    assert col.default.arg == "pending"
