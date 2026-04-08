from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from typing import Callable, Dict, List, Sequence

from .types import TriagedEvent


@dataclass
class BranchDecision:
    alpha_count: int
    branch: str

    @classmethod
    def from_triaged(cls, triaged: Sequence[TriagedEvent]) -> "BranchDecision":
        alpha_count = sum(1 for e in triaged if e.level == "alpha")
        branch = "alpha_path" if alpha_count > 0 else "observation_path"
        return cls(alpha_count=alpha_count, branch=branch)


class SchemaValidation:
    @staticmethod
    def validate(payload: Dict[str, object], required_keys: Sequence[str]) -> bool:
        return all(k in payload for k in required_keys)

    @classmethod
    def validate_with_retry_fallback(
        cls,
        build_payload: Callable[[], Dict[str, object]],
        *,
        required_keys: Sequence[str],
        fallback_payload: Dict[str, object],
    ) -> Dict[str, object]:
        payload = build_payload()
        if cls.validate(payload, required_keys):
            payload["schema_ok"] = True
            payload["schema_source"] = "primary"
            return payload

        payload = build_payload()
        if cls.validate(payload, required_keys):
            payload["schema_ok"] = True
            payload["schema_source"] = "retry"
            return payload

        fallback = dict(fallback_payload)
        fallback["schema_ok"] = cls.validate(fallback, required_keys)
        fallback["schema_source"] = "fallback"
        return fallback


class GuardCheck:
    _blocked_terms = (
        "fight detected",
        "violence confirmed",
    )

    @classmethod
    def sanitize_text(cls, text: str) -> str:
        out = text
        for phrase in cls._blocked_terms:
            out = out.replace(phrase, "review recommended")
        return out


class SeverityGate:
    @staticmethod
    def severity_for(event: TriagedEvent) -> str:
        if event.confidence >= 0.85:
            return "High"
        if event.confidence >= 0.65:
            return "Medium"
        return "Low"

    @classmethod
    def route_for(cls, event: TriagedEvent) -> str:
        severity = cls.severity_for(event)
        if severity in {"High", "Critical"}:
            return "immediate_alert"
        return "review_queue"


class IncidentStateMachine:
    @staticmethod
    def sequence(reopened: bool) -> List[str]:
        if reopened:
            return ["reopened", "monitoring"]
        return ["open", "monitoring"]


class LLMIncidentNarrative:
    @staticmethod
    def generate(incidents: Sequence[Dict[str, object]]) -> str:
        if not incidents:
            return "No confirmed incident was found."
        parts = []
        for inc in incidents:
            parts.append(
                (
                    f"Possible {inc['event_type']} observed in {inc['zone']} "
                    f"from {inc['start_sec']:.1f}s to {inc['end_sec']:.1f}s "
                    f"(severity: {inc['severity']})."
                )
            )
        return " ".join(parts)


class LLMGeneralSummary:
    @staticmethod
    def generate(chunk_summaries: Sequence[Dict[str, object]]) -> str:
        general_summary = "No confirmed incident. "
        if chunk_summaries:
            general_summary += " ".join(str(c["summary"]) for c in chunk_summaries)
        else:
            general_summary += "No notable candidate activity in sampled frames."
        return general_summary


class AlphaPathProcessor:
    """
    Branch A: confirmed-incident path with basic cooldown, dedupe, timeline, summary,
    validation, guard checks, and severity routing.
    """

    def __init__(self, *, cooldown_seconds: float = 30.0) -> None:
        self.cooldown_seconds = cooldown_seconds

    def _cooldown_filter(self, events: Sequence[TriagedEvent]) -> List[TriagedEvent]:
        latest_by_key: Dict[str, float] = {}
        out: List[TriagedEvent] = []
        for e in sorted(events, key=lambda x: x.ts):
            key = f"{e.event_type}:{e.zone}"
            last_ts = latest_by_key.get(key)
            if last_ts is not None and (e.ts - last_ts) < self.cooldown_seconds:
                continue
            latest_by_key[key] = e.ts
            out.append(e)
        return out

    def _merge_dedupe(self, events: Sequence[TriagedEvent]) -> List[Dict[str, object]]:
        grouped: Dict[str, List[TriagedEvent]] = defaultdict(list)
        for e in events:
            grouped[f"{e.event_type}:{e.zone}"].append(e)

        incidents: List[Dict[str, object]] = []
        for key, group in grouped.items():
            group_sorted = sorted(group, key=lambda x: x.ts)
            windows: List[List[TriagedEvent]] = []
            for e in group_sorted:
                if not windows:
                    windows.append([e])
                    continue
                if (e.ts - windows[-1][-1].ts) <= self.cooldown_seconds:
                    windows[-1].append(e)
                else:
                    windows.append([e])

            previous_severity_rank = 0
            severity_rank = {"Low": 1, "Medium": 2, "High": 3, "Critical": 4}
            for idx, window in enumerate(windows):
                incident_id = f"inc_{key}_{int(window[0].ts)}"
                confidence_max = max(x.confidence for x in window)
                temp_event = window[-1]
                severity = SeverityGate.severity_for(temp_event)
                current_rank = severity_rank.get(severity, 1)
                reopened = idx > 0
                escalated = reopened and current_rank > previous_severity_rank
                previous_severity_rank = max(previous_severity_rank, current_rank)

                incidents.append(
                    {
                        "incident_id": incident_id,
                        "event_type": temp_event.event_type,
                        "zone": temp_event.zone,
                        "start_sec": window[0].ts,
                        "end_sec": window[-1].ts,
                        "confidence_max": confidence_max,
                        "severity": severity,
                        "reopened": reopened,
                        "escalated": escalated,
                        "state_path": IncidentStateMachine.sequence(reopened),
                        "state": IncidentStateMachine.sequence(reopened)[-1],
                    }
                )
        return incidents

    def process(self, triaged: Sequence[TriagedEvent]) -> Dict[str, object]:
        alpha_events = [e for e in triaged if e.level == "alpha"]
        cooled = self._cooldown_filter(alpha_events)
        incidents = self._merge_dedupe(cooled)
        incident_summary_prep = {
            "alpha_event_count": len(alpha_events),
            "incident_count": len(incidents),
            "incidents": incidents,
            "evidence_policy": "facts_only_no_freeform_invention",
        }

        narrative = LLMIncidentNarrative.generate(incidents)
        narrative = GuardCheck.sanitize_text(narrative)

        alerts: List[Dict[str, object]] = []
        for e in cooled:
            route = SeverityGate.route_for(e)
            if route == "immediate_alert":
                alerts.append(
                    {
                        "event_id": e.event_id,
                        "event_type": e.event_type,
                        "ts": e.ts,
                        "zone": e.zone,
                        "route": route,
                        "severity": SeverityGate.severity_for(e),
                    }
                )

        report_payload = SchemaValidation.validate_with_retry_fallback(
            lambda: {"summary": narrative, "alerts": alerts},
            required_keys=("summary", "alerts"),
            fallback_payload={
                "summary": "Possible safety-relevant activity observed. Review recommended.",
                "alerts": alerts,
            },
        )
        schema_ok = bool(report_payload.pop("schema_ok", False))
        schema_source = str(report_payload.pop("schema_source", "primary"))

        result = {
            "incident_timeline": incidents,
            "incident_summary_prep": incident_summary_prep,
            "incident_report": report_payload,
            "audit": {
                "alpha_events": len(alpha_events),
                "post_cooldown_events": len(cooled),
                "incident_count": len(incidents),
                "reopened_count": sum(1 for x in incidents if bool(x.get("reopened"))),
                "escalated_count": sum(1 for x in incidents if bool(x.get("escalated"))),
            },
            "schema_ok": schema_ok,
            "schema_source": schema_source,
        }
        return result


class ObservationPathProcessor:
    """
    Branch B: no-alpha path with observation timeline, chunk summaries,
    guarded summary, and schema validation.
    """

    @staticmethod
    def _bucket_index(ts: float, chunk_seconds: float) -> int:
        return int(max(ts, 0.0) // chunk_seconds)

    def process(self, triaged: Sequence[TriagedEvent], *, chunk_seconds: float = 300.0) -> Dict[str, object]:
        timeline = [
            {
                "event_id": e.event_id,
                "event_type": e.event_type,
                "level": e.level,
                "ts": e.ts,
                "zone": e.zone,
                "confidence": e.confidence,
            }
            for e in triaged
        ]

        chunks: Dict[int, List[TriagedEvent]] = defaultdict(list)
        for e in triaged:
            chunks[self._bucket_index(e.ts, chunk_seconds)].append(e)

        chunk_summaries: List[Dict[str, object]] = []
        for idx in sorted(chunks):
            events = chunks[idx]
            event_types = sorted({e.event_type for e in events})
            zones = sorted({e.zone for e in events})
            start_sec = min(e.ts for e in events)
            end_sec = max(e.ts for e in events)
            strongest = max(events, key=lambda e: e.confidence)
            text = (
                f"Chunk {idx} ({start_sec:.1f}s-{end_sec:.1f}s): observed {len(events)} non-confirmed events; "
                f"strongest={strongest.event_type} ({strongest.confidence:.2f}); "
                f"types={', '.join(event_types) if event_types else 'none'}; "
                f"zones={', '.join(zones) if zones else 'unknown'}."
            )
            chunk_summaries.append(
                {
                    "chunk_id": idx,
                    "start_sec": start_sec,
                    "end_sec": end_sec,
                    "event_count": len(events),
                    "max_confidence": strongest.confidence,
                    "strongest_event_type": strongest.event_type,
                    "event_types": event_types,
                    "zones": zones,
                    "summary": text,
                }
            )

        general_summary = LLMGeneralSummary.generate(chunk_summaries)
        general_summary = GuardCheck.sanitize_text(general_summary)

        report_payload = SchemaValidation.validate_with_retry_fallback(
            lambda: {"summary": general_summary, "chunk_summaries": chunk_summaries},
            required_keys=("summary", "chunk_summaries"),
            fallback_payload={
                "summary": "No confirmed incident in this segment. General review recommended.",
                "chunk_summaries": chunk_summaries,
            },
        )
        schema_ok = bool(report_payload.pop("schema_ok", False))
        schema_source = str(report_payload.pop("schema_source", "primary"))

        result = {
            "observation_timeline": timeline,
            "general_report": report_payload,
            "audit": {
                "triaged_events": len(triaged),
                "chunk_count": len(chunk_summaries),
            },
            "schema_ok": schema_ok,
            "schema_source": schema_source,
        }
        return result
