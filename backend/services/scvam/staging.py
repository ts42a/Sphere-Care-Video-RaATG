from __future__ import annotations

import base64
import json
import shutil
from datetime import datetime
from pathlib import Path
from typing import Optional

from backend import models
from backend.services.scvam import paths as scvam_paths
from backend.services.scvam.inbox import resolve_staging_input

VIDEO_EXTS = {".mp4", ".webm", ".mov", ".avi", ".mkv", ".m4v", ".wmv"}


def _input_ext_for_mime(mime_type: str | None) -> tuple[str, str]:
    mime = (mime_type or "").lower()
    if "mp4" in mime:
        return ".mp4", "video/mp4"
    if "quicktime" in mime or "mov" in mime:
        return ".mov", "video/quicktime"
    return ".webm", mime_type or "video/webm"


def write_staging_input(
    *,
    org_id: int,
    vault_record_id: str,
    plain_bytes: bytes,
    record: models.Record,
    admin: models.Admin,
    enc_relative_path: str,
    iv_b64: str = "",
    mime_type: str | None = None,
    duration_sec: int | None = None,
    camera_id: str | None = None,
    resident_name: str | None = None,
    room: str | None = None,
    started_at: datetime | None = None,
    ended_at: datetime | None = None,
    source: str = "vault_upload",
) -> tuple[Path, str]:
    """Write plaintext input + manifest under scvam_input/jobs/{vault_record_id}/."""
    staging_dir = scvam_paths.staging_job_dir(org_id, vault_record_id)
    work_dir = staging_dir / "work"
    if work_dir.is_dir():
        shutil.rmtree(work_dir, ignore_errors=True)
    staging_dir.mkdir(parents=True, exist_ok=True)
    work_dir.mkdir(parents=True, exist_ok=True)

    ext, mime = _input_ext_for_mime(mime_type)
    input_name = f"input{ext}"
    (staging_dir / input_name).write_bytes(plain_bytes)

    staging_rel = scvam_paths.staging_job_dir_relative(org_id, vault_record_id)
    video_stem = scvam_paths._safe_folder_name(vault_record_id)
    duration = int(duration_sec or record.duration or 0) or None

    manifest = {
        "vault_record_id": vault_record_id,
        "organization_id": org_id,
        "admin_id": int(admin.id),
        "db_record_id": int(record.id),
        "iv_b64": iv_b64,
        "mime_type": mime,
        "duration_sec": duration,
        "camera_id": camera_id,
        "resident_name": resident_name or record.resident_name,
        "room": room,
        "started_at": started_at.isoformat() if started_at else None,
        "ended_at": ended_at.isoformat() if ended_at else None,
        "enc_relative_path": enc_relative_path,
        "staging_path": staging_rel,
        "input_file": input_name,
        "original_filename": input_name,
        "video_name": video_stem,
        "scvam_output_path": scvam_paths.scvam_output_dir_relative(org_id, video_stem),
        "source": source,
    }
    (staging_dir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=True, indent=2),
        encoding="utf-8",
    )
    return staging_dir, staging_rel


def _find_video_in_dir(directory: Path) -> Path | None:
    if not directory.is_dir():
        return None
    candidates: list[Path] = []
    for p in directory.rglob("*"):
        if p.is_file() and p.suffix.lower() in VIDEO_EXTS:
            if p.name.lower().startswith("input"):
                return p
            candidates.append(p)
    if not candidates:
        return None
    return max(candidates, key=lambda p: p.stat().st_mtime)


def find_retry_source_video(record: models.Record, job: models.ScvamJob | None) -> Path | None:
    """Locate a plaintext video to rebuild staging (output copy, partial work dir)."""
    root = scvam_paths.vault_root()

    out_rel = getattr(record, "scvam_output_path", None) or ""
    if out_rel:
        out_dir = root / out_rel
        for name in ("source.webm", "source.mp4", "source.mov", "source.mkv"):
            p = out_dir / name
            if p.is_file():
                return p
        found = _find_video_in_dir(out_dir)
        if found:
            return found

    if job and job.staging_path:
        staging_dir = root / job.staging_path
        try:
            return resolve_staging_input(staging_dir)
        except Exception:
            work = staging_dir / "work"
            found = _find_video_in_dir(work)
            if found:
                return found

    return None


def copy_video_to_staging(staging_dir: Path, source: Path, mime_type: str | None) -> None:
    ext, mime = _input_ext_for_mime(mime_type or "")
    if source.suffix.lower() in VIDEO_EXTS:
        ext = source.suffix.lower()
    input_name = f"input{ext}"
    dest = staging_dir / input_name
    shutil.copy2(source, dest)
    manifest_path = staging_dir / "manifest.json"
    manifest: dict = {}
    if manifest_path.is_file():
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except Exception:
            manifest = {}
    manifest["input_file"] = input_name
    manifest["mime_type"] = mime
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=True, indent=2), encoding="utf-8")


def vault_record_id_for_record(record: models.Record, job: models.ScvamJob | None) -> str:
    if job and job.vault_record_id:
        return str(job.vault_record_id)
    file_url = str(record.file_url or "")
    if file_url.startswith("localvault://"):
        return file_url[len("localvault://") :]
    enc = Path(record.file_name or "")
    stem = enc.stem
    if stem:
        return stem
    raise ValueError("Cannot determine vault record id for this recording.")


def ensure_staging_for_retry(
    *,
    record: models.Record,
    admin: models.Admin,
    job: models.ScvamJob | None,
    ai_plain_b64: str | None = None,
) -> tuple[Path, str]:
    """
    Ensure scvam_input staging contains an input video.
    Returns (staging_dir, staging_rel).
    """
    org_id = int(admin.organization_id)
    vault_record_id = vault_record_id_for_record(record, job)
    enc_relative_path = (job.enc_relative_path if job else None) or str(record.file_name or "")
    staging_dir = scvam_paths.staging_job_dir(org_id, vault_record_id)

    try:
        resolve_staging_input(staging_dir)
        staging_rel = staging_dir.relative_to(scvam_paths.vault_root()).as_posix()
        return staging_dir, staging_rel
    except Exception:
        pass

    if ai_plain_b64:
        try:
            plain_bytes = base64.b64decode(ai_plain_b64)
        except Exception as exc:
            raise ValueError("Invalid ai_plain_b64 payload.") from exc
        if not plain_bytes:
            raise ValueError("Empty video payload for SCVAM retry.")
        staging_dir, staging_rel = write_staging_input(
            org_id=org_id,
            vault_record_id=vault_record_id,
            plain_bytes=plain_bytes,
            record=record,
            admin=admin,
            enc_relative_path=enc_relative_path,
            mime_type=record.mime_type,
            duration_sec=record.duration,
            resident_name=record.resident_name,
            source="scvam_retry",
        )
        return staging_dir, staging_rel

    alt = find_retry_source_video(record, job)
    if alt and alt.is_file():
        work_dir = staging_dir / "work"
        if work_dir.is_dir():
            shutil.rmtree(work_dir, ignore_errors=True)
        staging_dir.mkdir(parents=True, exist_ok=True)
        (staging_dir / "work").mkdir(parents=True, exist_ok=True)
        copy_video_to_staging(staging_dir, alt, record.mime_type)
        staging_rel = staging_dir.relative_to(scvam_paths.vault_root()).as_posix()
        return staging_dir, staging_rel

    raise ValueError(
        "Staging folder missing. Unlock the vault on this device and click Retry SCVAM "
        "(re-sends the clip for analysis), or record again with AI on."
    )
