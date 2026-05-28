from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


FALL_LIKE_TYPES = {
    "fall",
    "fall_like",
    "fall_suspected",
    "fall_likely",
}
HIGH_SEVERITY_THRESHOLD = 0.85


@dataclass
class ScvamParsedResults:
    summary_text: str
    summary_heading: str
    events: list[dict[str, Any]] = field(default_factory=list)
    llm_raw: dict[str, Any] = field(default_factory=dict)
    events_raw: dict[str, Any] = field(default_factory=dict)


@dataclass
class FlagCandidate:
    event_type: str
    description: str
    severity: str
    sev_desc: str
    transcript: str
    timestamp_sec: float
    ai_confidence: float


def parse_scvam_outputs(llm_summary_path: Path, events_path: Path) -> ScvamParsedResults:
    llm_raw = json.loads(llm_summary_path.read_text(encoding="utf-8"))
    events_raw = json.loads(events_path.read_text(encoding="utf-8"))
    summary_text = str(llm_raw.get("summary_text") or "").strip()
    summary_heading = str(llm_raw.get("summary_heading") or "").strip()
    events = list(events_raw.get("events") or [])
    if not summary_text and summary_heading:
        summary_text = summary_heading
    return ScvamParsedResults(
        summary_text=summary_text,
        summary_heading=summary_heading,
        events=events,
        llm_raw=llm_raw,
        events_raw=events_raw,
    )


def build_flag_candidates(parsed: ScvamParsedResults, *, summary_text: str) -> list[FlagCandidate]:
    out: list[FlagCandidate] = []
    for ev in parsed.events:
        event_type = str(ev.get("event_type") or "unknown")
        severity_score = float(ev.get("severity") or 0.0)
        start_ts = float(ev.get("start_ts_sec") or 0.0)
        et_lower = event_type.lower()

        if et_lower in FALL_LIKE_TYPES or severity_score >= HIGH_SEVERITY_THRESHOLD:
            sev_label = "High" if et_lower in FALL_LIKE_TYPES or severity_score >= 1.0 else "Medium"
        else:
            continue

        reasons = ev.get("reasons") or []
        reason_txt = "; ".join(str(r) for r in reasons[:3]) if reasons else ""
        desc = f"SCVAM detected {event_type.replace('_', ' ')} at {_sec_to_hhmmss(start_ts)}"
        if reason_txt:
            desc += f" — {reason_txt}"

        confidence = min(1.0, max(0.0, float(ev.get("max_event_prob") or severity_score / 1.5)))

        out.append(
            FlagCandidate(
                event_type=event_type.replace("_", " ").title(),
                description=desc,
                severity=sev_label,
                sev_desc=reason_txt or summary_text[:500],
                transcript=summary_text,
                timestamp_sec=start_ts,
                ai_confidence=confidence,
            )
        )
    return out


def _sec_to_hhmmss(sec: float) -> str:
    t = max(0, int(sec))
    hh, mm, ss = t // 3600, (t % 3600) // 60, t % 60
    return f"{hh:02d}:{mm:02d}:{ss:02d}"
