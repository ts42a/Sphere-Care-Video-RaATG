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


def _summary_mentions_fall(parsed: ScvamParsedResults, summary_text: str) -> bool:
    blob = " ".join(
        filter(
            None,
            [
                parsed.summary_heading,
                parsed.summary_text,
                summary_text,
                " ".join(str(x) for x in (parsed.llm_raw.get("llm_event_lines") or [])),
            ],
        )
    ).lower()
    return any(k in blob for k in ("fall", "fell", "on the ground", "lying on"))


def _extract_fall_timestamp_sec(parsed: ScvamParsedResults, summary_text: str) -> float:
    import re

    for blob in (parsed.summary_heading, parsed.summary_text, summary_text):
        if not blob:
            continue
        m = re.search(r"(?:around|at|~)\s*(\d+(?:\.\d+)?)\s*s", str(blob), re.I)
        if m:
            return float(m.group(1))
    for line in parsed.llm_raw.get("llm_event_lines") or []:
        if "fall" in str(line).lower():
            m = re.search(r"(\d+(?:\.\d+)?)\s*s", str(line))
            if m:
                return float(m.group(1))
    for ev in parsed.events:
        if "fall" in str(ev.get("event_type") or "").lower():
            return float(ev.get("start_ts_sec") or 0.0)
    return 0.0


def build_flag_candidates(parsed: ScvamParsedResults, *, summary_text: str) -> list[FlagCandidate]:
    out: list[FlagCandidate] = []
    has_fall_flag = False

    for ev in parsed.events:
        event_type = str(ev.get("event_type") or "unknown")
        severity_score = float(ev.get("severity") or 0.0)
        start_ts = float(ev.get("start_ts_sec") or 0.0)
        et_lower = event_type.lower()

        if et_lower in FALL_LIKE_TYPES or severity_score >= HIGH_SEVERITY_THRESHOLD:
            sev_label = "High" if et_lower in FALL_LIKE_TYPES or severity_score >= 1.0 else "Medium"
        else:
            continue

        if et_lower in FALL_LIKE_TYPES:
            has_fall_flag = True

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

    if _summary_mentions_fall(parsed, summary_text) and not has_fall_flag:
        ts = _extract_fall_timestamp_sec(parsed, summary_text)
        heading = (parsed.summary_heading or "Possible fall detected").strip()
        out.insert(
            0,
            FlagCandidate(
                event_type="Fall",
                description=f"SCVAM LLM: {heading} at {_sec_to_hhmmss(ts)}",
                severity="High",
                sev_desc=heading or summary_text[:500],
                transcript=summary_text,
                timestamp_sec=ts,
                ai_confidence=0.92,
            ),
        )

    return out


def _sec_to_hhmmss(sec: float) -> str:
    t = max(0, int(sec))
    hh, mm, ss = t // 3600, (t % 3600) // 60, t % 60
    return f"{hh:02d}:{mm:02d}:{ss:02d}"
