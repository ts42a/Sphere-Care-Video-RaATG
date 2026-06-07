from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from backend import models
from backend.services.scvam.paths import vault_root


def _parse_ts_to_sec(text: str) -> float | None:
    """Extract first timestamp in seconds from strings like '0s–4s' or 'from 6s onward'."""
    m = re.search(r"(\d+(?:\.\d+)?)\s*s", text)
    if m:
        return float(m.group(1))
    return None


def _coerce_duration_sec(value: Any) -> int | None:
    if value is None:
        return None
    try:
        return int(round(float(value)))
    except (TypeError, ValueError):
        return None


def _lines_to_minute_blocks(lines: list[str]) -> list[dict[str, Any]]:
    buckets: dict[int, list[str]] = {}
    for raw in lines:
        line = str(raw).strip().lstrip("- ").strip()
        if not line:
            continue
        sec = _parse_ts_to_sec(line)
        minute = int(sec // 60) if sec is not None else 0
        buckets.setdefault(minute, []).append(line)

    blocks = []
    for minute in sorted(buckets.keys()):
        label = f"{minute:02d}:00–{minute + 1:02d}:00"
        blocks.append(
            {
                "minute": minute,
                "label": label,
                "lines": buckets[minute],
            }
        )
    return blocks


def read_scvam_script_for_record(record: models.Record) -> dict[str, Any]:
    status = getattr(record, "scvam_status", None) or "none"
    duration = _coerce_duration_sec(record.duration)
    title = record.category or "Recording"

    base = {
        "record_id": int(record.id) if getattr(record, "id", None) is not None else None,
        "scvam_status": status,
        "duration_sec": duration,
        "title": title,
        "heading": None,
        "summary_text": record.ai_summary or "",
        "timeline": [],
        "source": "record",
    }

    if status in {"none", "skipped"}:
        base["message"] = (
            record.ai_summary
            or "No SCVAM analysis yet. Turn AI on before recording and upload to the server."
        )
        return base

    out_rel = getattr(record, "scvam_output_path", None) or ""
    out_dir = vault_root() / out_rel if out_rel else None

    if out_dir and out_dir.is_dir():
        summary_txt = out_dir / "summary.txt"
        meta_path = out_dir / "metadata.json"
        llm_path = out_dir / "llm_summary.json"

        if summary_txt.is_file():
            base["summary_text"] = summary_txt.read_text(encoding="utf-8").strip()
            base["source"] = "summary.txt"

        if meta_path.is_file():
            try:
                meta = json.loads(meta_path.read_text(encoding="utf-8"))
                base["heading"] = meta.get("summary_heading")
                base["duration_sec"] = _coerce_duration_sec(meta.get("duration_sec")) or duration
                base["video_name"] = meta.get("video_name") or meta.get("original_filename")
            except Exception:
                pass

        lines: list[str] = []
        if llm_path.is_file():
            try:
                llm = json.loads(llm_path.read_text(encoding="utf-8"))
                base["heading"] = base["heading"] or llm.get("summary_heading")
                if not base["summary_text"]:
                    base["summary_text"] = llm.get("summary_text") or ""
                for key in ("summary_posture_lines", "llm_event_lines"):
                    for item in llm.get(key) or []:
                        lines.append(str(item))
            except Exception:
                pass

        if lines:
            base["timeline"] = _lines_to_minute_blocks(lines)
        elif base["summary_text"]:
            base["timeline"] = [{"minute": 0, "label": "00:00–01:00", "lines": [base["summary_text"]]}]

    if status in {"pending", "processing", "running"} and not base["timeline"]:
        base["message"] = (
            "SCVAM is processing this recording (usually 1–3 minutes for short clips). "
            "Keep the SCVAM worker running — status updates automatically."
        )

    if status == "failed" and not base.get("message"):
        base["message"] = (
            "SCVAM analysis failed for this clip. "
            "Unlock the vault and click Retry SCVAM to re-run analysis."
        )

    return base
