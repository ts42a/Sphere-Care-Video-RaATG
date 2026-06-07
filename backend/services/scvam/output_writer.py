from __future__ import annotations

import json
import shutil
from datetime import datetime, timezone
from pathlib import Path

from backend.services.scvam.paths import scvam_output_dir
from backend.services.scvam.results import ScvamParsedResults
from backend.services.scvam.runner import ScvamRunResult
from backend.services.scvam.video_meta import probe_video_duration_sec


def write_scvam_output_folder(
    *,
    org_id: int,
    video_name: str,
    source_video: Path | None,
    run_result: ScvamRunResult,
    parsed: ScvamParsedResults,
    job_meta: dict,
) -> Path:
    """
    Write human-readable SCVAM deliverables under scvam_output/{video_name}/:
      - metadata.json
      - summary.txt
      - llm_summary.json
      - events.json
      - source video copy (when available)
    """
    out_dir = scvam_output_dir(org_id, video_name)
    out_dir.mkdir(parents=True, exist_ok=True)

    duration_sec = probe_video_duration_sec(source_video) if source_video and source_video.is_file() else None
    if duration_sec is None and job_meta.get("duration_sec"):
        duration_sec = float(job_meta["duration_sec"])

    summary_text = parsed.summary_text or parsed.summary_heading or ""

    metadata = {
        "video_name": video_name,
        "original_filename": job_meta.get("original_filename") or video_name,
        "vault_record_id": job_meta.get("vault_record_id"),
        "staging_folder": job_meta.get("staging_folder"),
        "staging_path": job_meta.get("staging_path"),
        "db_record_id": job_meta.get("db_record_id"),
        "duration_sec": round(duration_sec, 2) if duration_sec is not None else None,
        "duration_hhmmss": _fmt_duration(duration_sec),
        "model": "scvam2.1",
        "processed_at": datetime.now(timezone.utc).isoformat(),
        "summary_heading": parsed.summary_heading,
        "events_count": len(parsed.events),
        "output_dir": str(out_dir),
        "run_dir": str(run_result.run_dir),
    }
    (out_dir / "metadata.json").write_text(
        json.dumps(metadata, ensure_ascii=True, indent=2),
        encoding="utf-8",
    )

    summary_lines = [
        f"Video: {metadata['original_filename']}",
        f"Duration: {metadata['duration_hhmmss']} ({metadata['duration_sec']} sec)"
        if metadata["duration_sec"] is not None
        else "Duration: unknown",
        f"Processed: {metadata['processed_at']}",
        "",
        summary_text or "(no summary generated)",
    ]
    if parsed.llm_raw.get("llm_event_lines"):
        summary_lines.extend(["", "Notable events:"])
        for line in parsed.llm_raw.get("llm_event_lines") or []:
            summary_lines.append(str(line))
    (out_dir / "summary.txt").write_text("\n".join(summary_lines).strip() + "\n", encoding="utf-8")

    if run_result.llm_summary_path.is_file():
        shutil.copy2(run_result.llm_summary_path, out_dir / "llm_summary.json")
    if run_result.events_path.is_file():
        shutil.copy2(run_result.events_path, out_dir / "events.json")

    if source_video and source_video.is_file():
        dest_vid = out_dir / f"source{source_video.suffix.lower()}"
        if not dest_vid.exists():
            shutil.copy2(source_video, dest_vid)

    return out_dir


def _fmt_duration(sec: float | None) -> str:
    if sec is None:
        return "—"
    t = max(0, int(round(sec)))
    hh, mm, ss = t // 3600, (t % 3600) // 60, t % 60
    if hh:
        return f"{hh:02d}:{mm:02d}:{ss:02d}"
    return f"{mm:02d}:{ss:02d}"
