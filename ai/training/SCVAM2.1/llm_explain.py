"""
Step 7: LLM explainer — reads GRN/temporal + risk_engine outputs and writes
a short, plain-English handover summary. Text only, no images.

Inputs (under <run_dir>/merged/):
  merged_frames.json   (Step 4)
  temporal.json        (Step 5)
  events.json          (Step 6)

LLM is optional and configured via the same env vars as ai/llm/client.py:
  AI_LLM_PROVIDER=openai|ollama
  AI_OPENAI_API_KEY=... / AI_OPENAI_MODEL=gpt-4o-mini
  AI_OLLAMA_BASE_URL=http://127.0.0.1:11434 / AI_OLLAMA_MODEL=llama3.2:3b

Outputs:
  merged/llm_summary.json
  merged/llm_summary.txt

Run from repo root:
  python ai/models/SCVAM2.1/llm_explain.py
  python ai/models/SCVAM2.1/llm_explain.py --run "path/to/output/MyVideo_2fps"
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

_REPO_ROOT = Path(__file__).resolve().parents[3]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from ai.llm.client import LLMConfig, try_chat_once  # noqa: E402


# Filter / labelling for risk_engine event types. These are fallbacks used
# when ``_event_phrase`` can't infer a grade-aware wording from the record.
_EVENT_LABELS: dict[str, str] = {
    "prolonged_immobility": "prolonged immobility",
    "environment_hazard_context": "environmental hazard nearby",
    "person_active": "active movement",
    "wandering_like": "possible wandering",
    "sharp_object_in_hand": "possible sharp object in hand",
    "obj_in_hand": "object in hand",
    "fall": "possible fall",
    "fall_like": "possible fall",
    "fall_suspected": "possible fall",
    "fall_likely": "possible fall",
    "gait_unstable": "unsteady gait",
    "gait_instability": "unsteady gait",
}


def _event_phrase(ev: dict[str, Any]) -> str:
    """Return the human phrase for an event, honouring confidence_grade.

    For held-object events:
      - confirmed + sharp_object_in_hand -> 'sharp object in hand'
      - possible  + sharp_object_in_hand -> 'possible sharp object in hand'
      - confirmed + obj_in_hand          -> '<label> in hand' (or 'object in hand')
      - possible  + obj_in_hand          -> 'possible object in hand'
    For all other event types the fallback in ``_EVENT_LABELS`` is used so the
    existing 'possible fall', 'unsteady gait', etc. wording is preserved.
    """
    et = str(ev.get("event_type") or "")
    grade = (ev.get("confidence_grade") or "").strip().lower()
    cat = (ev.get("object_category") or "").strip().lower()
    label_raw = (ev.get("object_label") or "").strip().lower()

    if et == "sharp_object_in_hand":
        if grade == "confirmed":
            if label_raw in {"knife", "scissors", "fork"}:
                return f"{label_raw} in hand"
            return "sharp object in hand"
        if label_raw in {"knife", "scissors", "fork"}:
            return f"possible {label_raw} in hand"
        return "possible sharp object in hand"
    if et == "obj_in_hand":
        if grade == "possible":
            # Use the category-based wording when the model is uncertain.
            if cat == "sharp_object":
                return "possible sharp object in hand"
            return "possible object in hand"
        # confirmed (or unspecified): show the specific label when we have it
        if label_raw and label_raw not in {"object", "thing"}:
            return f"{label_raw} in hand"
        return "object in hand"
    if et in {"fall_like", "fall", "fall_suspected", "fall_likely"}:
        return "possible fall"
    return _EVENT_LABELS.get(et, et.replace("_", " "))

# Drop very low-signal channels from prose (kept in raw json).
_LOW_SIGNAL_TYPES: set[str] = {"hand_visible"}

# Mid-priority: must appear in the explainer even when another event leads the heading.
_MID_PRIORITY_TYPES: set[str] = {
    "sharp_object_in_hand",
}

# Event types that we treat as "concerning" in the high-level lead sentence.
_CONCERN_TYPES: set[str] = {
    "fall",
    "fall_like",
    "fall_suspected",
    "fall_likely",
    "sharp_object_in_hand",
    "wandering_like",
    "gait_unstable",
    "gait_instability",
    "prolonged_immobility",
    "environment_hazard_context",
}


def _package_dir() -> Path:
    return Path(__file__).resolve().parent


def _newest_run_dir() -> Path | None:
    out_root = _package_dir() / "output"
    if not out_root.is_dir():
        return None
    candidates = [
        d
        for d in out_root.iterdir()
        if d.is_dir() and (d / "merged" / "merged_frames.json").is_file()
    ]
    if not candidates:
        return None
    candidates.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    return candidates[0]


def _load_json(p: Path) -> dict[str, Any] | None:
    if not p.is_file():
        return None
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return None


def _fmt_ts(sec: float | int | None) -> str:
    if sec is None:
        return "?s"
    try:
        s = float(sec)
    except Exception:
        return "?s"
    if s >= 60.0:
        m = int(s // 60)
        rem = int(round(s - m * 60))
        return f"{m}m{rem:02d}s"
    return f"{s:.0f}s"


def _fmt_range(start: float | int | None, end: float | int | None) -> str:
    a, b = _fmt_ts(start), _fmt_ts(end)
    return a if a == b else f"{a}–{b}"


# Severity boost when picking the lead concern for the heading. Falls and
# sharp-object events should normally win even if their numeric severity is
# similar to immobility / hazard channels.
_LEAD_PRIORITY: dict[str, float] = {
    "fall_like": 1.50,
    "fall": 1.50,
    "fall_suspected": 1.40,
    "fall_likely": 1.40,
    "sharp_object_in_hand": 1.20,
    "wandering_like": 1.05,
    "prolonged_immobility": 1.00,
    "gait_unstable": 0.90,
    "gait_instability": 0.90,
    "abnormal_posture": 0.85,
    "environment_hazard_context": 0.70,
    "obj_in_hand": 0.60,
    "person_active": 0.30,
}


_POSTURE_LABEL: dict[str, str] = {
    "standing": "standing",
    "sitting": "sitting",
    "lying": "lying on the ground",
    "walking": "possibly walking around",
    "unknown": "in an unclear posture",
}


def _posture_timeline(
    merged: dict[str, Any] | None,
    *,
    max_segments: int = 6,
) -> list[dict[str, Any]]:
    """Walk merged_frames in time order and return a compact posture timeline:
    [{posture, start_ts, end_ts}, ...]. Consecutive duplicate postures are
    collapsed so the LLM sees state transitions, not a noisy per-frame list.
    Frames with no person detected are skipped entirely (we don't want
    'unknown' to flood the timeline when the camera is empty).

    Refinements:
      - If a frame has the person present but no pose (``posture is None``),
        we **carry over** the last known posture instead of inserting an
        'unknown' segment. Pose is only run on a subset of samples, so naive
        unknowns flood the timeline.
      - If a 'standing' frame also has ``is_moving`` true, we relabel it as
        'walking' so the explainer can say 'possibly walking around'.
    """
    if not merged:
        return []
    rows = merged.get("frames") or []
    segments: list[dict[str, Any]] = []
    last_known: str | None = None
    for fr in rows:
        ms = fr.get("merged_signals") or {}
        if not ms.get("person_present"):
            continue
        # Frames where the person is partially in frame (entering / leaving
        # the scene) should not contribute a posture state. The classifier
        # often labels them 'sitting' because the lower body is cropped,
        # which then misleads the LLM. We skip them outright so the timeline
        # stays anchored to frames where pose actually had a clean view.
        if ms.get("partial_visibility"):
            continue
        raw_posture = ms.get("posture")
        if raw_posture:
            posture = str(raw_posture).strip().lower()
            last_known = posture
        elif last_known is not None:
            posture = last_known
        else:
            posture = "unknown"

        if posture == "standing" and bool(ms.get("is_moving")):
            posture = "walking"

        try:
            ts = float(fr.get("sample_ts_sec") or 0.0)
        except Exception:
            ts = 0.0
        if segments and segments[-1]["posture"] == posture:
            segments[-1]["end_ts"] = ts
        else:
            segments.append(
                {"posture": posture, "start_ts": ts, "end_ts": ts}
            )
    if len(segments) > max_segments:
        # Keep the first and last few transitions so we don't drop the
        # important "lying" tail. Middle segments collapse to a marker.
        head = segments[: max_segments // 2]
        tail = segments[-(max_segments - len(head)) :]
        segments = head + tail
    return segments


def _posture_lines(
    timeline: list[dict[str, Any]],
) -> list[str]:
    """Render the timeline as one bullet per state change, e.g.
    '- standing, 0s' or '- lying on the ground, 4s onward'."""
    if not timeline:
        return []
    lines: list[str] = []
    last = timeline[-1]
    for seg in timeline:
        posture = seg.get("posture") or "unknown"
        phrase = _POSTURE_LABEL.get(posture, posture.replace("_", " "))
        s = seg.get("start_ts")
        e = seg.get("end_ts")
        if seg is last:
            lines.append(f"- {phrase}, from {_fmt_ts(s)} onward")
        elif s is not None and e is not None and abs(float(e) - float(s)) >= 0.5:
            lines.append(f"- {phrase}, {_fmt_range(s, e)}")
        else:
            lines.append(f"- {phrase}, {_fmt_ts(s)}")
    return lines


def _last_posture(timeline: list[dict[str, Any]]) -> str | None:
    if not timeline:
        return None
    return (timeline[-1].get("posture") or "").strip().lower() or None


def _first_posture(timeline: list[dict[str, Any]]) -> str | None:
    if not timeline:
        return None
    return (timeline[0].get("posture") or "").strip().lower() or None


def _is_collapse_pattern(timeline: list[dict[str, Any]]) -> bool:
    """True when the person was upright (standing or sitting) and ended on
    the ground (lying). Used to upgrade the heading wording."""
    if len(timeline) < 2:
        return False
    last = _last_posture(timeline)
    if last != "lying":
        return False
    earlier = {
        (seg.get("posture") or "").lower() for seg in timeline[:-1]
    }
    return bool(earlier & {"standing", "sitting"})


def _lead_event(events: list[dict[str, Any]]) -> dict[str, Any] | None:
    """Pick the single most concerning event after applying _LEAD_PRIORITY
    on top of severity. Used to synthesise a one-line heading.

    Events tagged ``priority=mid`` are excluded from the heading when any
    other concern-type event exists (they still appear in the mid-priority
    explainer section).
    """
    pool = list(events or [])
    has_non_mid = any(
        (ev.get("priority") or "").lower() != "mid"
        and str(ev.get("event_type") or "") in _CONCERN_TYPES
        for ev in pool
    )
    if has_non_mid:
        pool = [
            ev
            for ev in pool
            if (ev.get("priority") or "").lower() != "mid"
        ]

    best: dict[str, Any] | None = None
    best_score = -1.0
    for ev in pool:
        et = str(ev.get("event_type") or "")
        if et in _LOW_SIGNAL_TYPES:
            continue
        try:
            sev = float(ev.get("severity") or 0.0)
        except Exception:
            sev = 0.0
        score = sev * _LEAD_PRIORITY.get(et, 0.5)
        if score > best_score:
            best_score = score
            best = ev
    return best


def _compose_heading(
    events: list[dict[str, Any]],
    timeline: list[dict[str, Any]],
    fall_times: list[float],
) -> str:
    """One-line heading sentence (no trailing period). Prefers fall-like
    headings when the posture trajectory shows a collapse, even if the
    risk_engine fall_like channel didn't fully fire."""
    fall_evs = [
        e for e in (events or [])
        if str(e.get("event_type") or "")
        in {"fall_like", "fall", "fall_suspected", "fall_likely"}
    ]
    if fall_evs:
        ev = max(
            fall_evs,
            key=lambda e: float(e.get("severity") or 0.0),
        )
        ts = ev.get("end_ts_sec") or ev.get("start_ts_sec")
        return f"Possible fall around {_fmt_ts(ts)}"

    if _is_collapse_pattern(timeline):
        ts = timeline[-1].get("start_ts")
        return f"Possible fall around {_fmt_ts(ts)}"

    if fall_times:
        return f"Possible fall around {_fmt_ts(fall_times[0])}"

    lead = _lead_event(events or [])
    if lead is not None:
        phrase = _event_phrase(lead).capitalize()
        rng = _fmt_range(lead.get("start_ts_sec"), lead.get("end_ts_sec"))
        return f"{phrase} {rng}"

    return "No concerning events detected"


def _fall_evidence_times(events: list[dict[str, Any]]) -> list[float]:
    """Surface frames with high fall_score even if no explicit 'fall' event."""
    out: list[float] = []
    for ev in events or []:
        for row in ev.get("evidence") or []:
            try:
                fs = float(row.get("fall_score") or 0.0)
                ts = float(row.get("sample_ts_sec") or 0.0)
            except Exception:
                continue
            if fs >= 0.4:
                out.append(ts)
    out.sort()
    return out


# Pairs that should never appear together as a comma-joined single sentence.
_CONFLICTING_PAIRS: list[tuple[str, str]] = [
    ("prolonged_immobility", "person_active"),
    ("prolonged_immobility", "wandering_like"),
]


def _drop_conflicting(events_sorted: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Keep highest-severity item from each conflicting pair, drop the loser."""
    drop_keys: set[str] = set()
    by_type: dict[str, dict[str, Any]] = {}
    for ev in events_sorted:
        t = str(ev.get("event_type") or "")
        if t and t not in by_type:
            by_type[t] = ev
    for a, b in _CONFLICTING_PAIRS:
        if a in by_type and b in by_type:
            sa = float(by_type[a].get("severity") or 0.0)
            sb = float(by_type[b].get("severity") or 0.0)
            drop_keys.add(b if sa >= sb else a)
    return [ev for ev in events_sorted if str(ev.get("event_type") or "") not in drop_keys]


def _format_event_bullet(ev: dict[str, Any], *, show_severity: bool) -> str | None:
    """One bullet for an event; None if the event should be skipped."""
    et = str(ev.get("event_type") or "")
    if et in _LOW_SIGNAL_TYPES:
        return None
    try:
        sev = float(ev.get("severity") or 0.0)
    except Exception:
        sev = 0.0
    is_mid = (
        et in _MID_PRIORITY_TYPES
        or (ev.get("priority") or "").lower() == "mid"
    )
    is_possible_object = (
        et in {"obj_in_hand", "sharp_object_in_hand"}
        and (ev.get("confidence_grade") or "").lower() == "possible"
    )
    if (
        sev < 0.4
        and et not in _CONCERN_TYPES
        and not is_possible_object
        and not is_mid
    ):
        return None
    label = _event_phrase(ev)
    rng = _fmt_range(ev.get("start_ts_sec"), ev.get("end_ts_sec"))
    try:
        n_det = int(ev.get("detection_count") or 0)
    except Exception:
        n_det = 0
    if n_det > 1:
        times = ev.get("detection_times_sec") or []
        time_bits = ", ".join(_fmt_ts(t) for t in times[:6])
        label = f"{label} ({n_det} detections: {time_bits})"
    if show_severity:
        grade = ev.get("confidence_grade")
        grade_tag = f" [{grade}]" if grade else ""
        pri = ev.get("priority")
        pri_tag = f" priority={pri}" if pri else ""
        return f"- {label}, {rng} (severity {sev:.2f}){grade_tag}{pri_tag}"
    return f"- {label}, {rng}"


def _human_event_lines(
    events_block: dict[str, Any] | None,
    *,
    show_severity: bool,
) -> list[str]:
    """Convert events.json into compact human-readable lines.

    When ``show_severity`` is False the lines are suitable to send to the LLM
    (no raw numbers, no internal field names, conflicting pairs deduped).
    """
    if not events_block:
        return []
    evs = events_block.get("events") or []
    evs_sorted = sorted(
        evs,
        key=lambda e: float(e.get("severity") or 0.0),
        reverse=True,
    )
    if not show_severity:
        evs_sorted = _drop_conflicting(evs_sorted)

    lines: list[str] = []
    for ev in evs_sorted:
        bullet = _format_event_bullet(ev, show_severity=show_severity)
        if bullet:
            lines.append(bullet)

    fall_times = _fall_evidence_times(evs)
    if fall_times and not any("possible fall" in l for l in lines):
        first = _fmt_ts(fall_times[0])
        lines.append(f"- possible fall around {first}")
    return lines


def _sharp_audit_lines(merged: dict[str, Any] | None) -> list[str]:
    """Bullets for sharp objects seen in zoom step-2b but cleared by step-2c.
    Lets the LLM mention 'possible knife' without implying verification."""
    if not merged:
        return []
    lines: list[str] = []
    for fr in merged.get("frames") or []:
        ms = fr.get("merged_signals") or {}
        hints = ms.get("unconfirmed_sharp_pass1") or []
        if not hints:
            continue
        ts = fr.get("sample_ts_sec")
        sf = str(fr.get("sample_frame") or "").strip()
        for h in hints:
            lab = str(h.get("pass1_label") or "object").strip().lower()
            side = str(h.get("side") or "?").strip()
            lines.append(
                f"- possible {lab} near {side.lower()} hand around {_fmt_ts(ts)} "
                f"({sf}); first zoom pass only, verification did not confirm"
            )
    return lines


def _compact_context(
    run_dir: Path,
    merged: dict[str, Any] | None,
    temporal: dict[str, Any] | None,
    events: dict[str, Any] | None,
) -> tuple[str, list[str], list[str], str, list[str], list[str]]:
    """Return (llm_context_text, llm_event_lines, debug_event_lines,
    heading, posture_lines, sharp_audit_lines).

    ``llm_*`` are sanitized for the LLM. ``debug_event_lines`` keeps severities
    and is written to llm_summary.json for review.
    """
    video = (merged or {}).get("video") or run_dir.name
    samples = (merged or {}).get("samples_total")

    llm_lines: list[str] = []
    if samples:
        llm_lines.append(f"clip: {Path(str(video)).name}, {samples} sampled frames")

    llm_events = _human_event_lines(events, show_severity=False)
    debug_events = _human_event_lines(events, show_severity=True)

    timeline = _posture_timeline(merged)
    posture_lines = _posture_lines(timeline)
    fall_times = _fall_evidence_times((events or {}).get("events") or [])
    heading = _compose_heading(
        (events or {}).get("events") or [], timeline, fall_times
    )

    sharp_audit = _sharp_audit_lines(merged)

    llm_lines.append(f"heading (must reuse verbatim): {heading}")

    if sharp_audit:
        llm_lines.append(
            "held-object audit (first zoom detector pass; treat as uncertain — "
            "verification often clears false positives):"
        )
        llm_lines.extend(sharp_audit)

    mid_priority = [
        ev
        for ev in (events or {}).get("events") or []
        if str(ev.get("event_type") or "") in _MID_PRIORITY_TYPES
        or (ev.get("priority") or "").lower() == "mid"
    ]
    if mid_priority:
        llm_lines.append(
            "mid priority (MUST mention in explainer even if heading is about "
            "something else; keep confirmed wording when bullets omit 'possible'):"
        )
        for ev in sorted(
            mid_priority,
            key=lambda e: float(e.get("severity") or 0.0),
            reverse=True,
        ):
            bullet = _format_event_bullet(ev, show_severity=False)
            if bullet:
                llm_lines.append(bullet)

    if posture_lines:
        llm_lines.append("posture timeline (oldest first):")
        llm_lines.extend(posture_lines)

    if llm_events:
        llm_lines.append("notable events (already deduped, no contradictions):")
        llm_lines.extend(llm_events)
    else:
        llm_lines.append("no concerning events detected")
    return (
        "\n".join(llm_lines),
        llm_events,
        debug_events,
        heading,
        posture_lines,
        sharp_audit,
    )


def _format_heading_and_body(heading: str, body: str) -> str:
    """Compose the final two-block summary: heading line, blank line,
    explainer paragraph. Strips any heading the LLM repeated inside the body
    (exact match or heading-like prefix sentence such as 'Prolonged immobility
    around 0s-13s')."""
    body = (body or "").strip()
    if heading and body.lower().startswith(heading.lower()):
        body = body[len(heading) :].lstrip(" .:-—\n")

    # If the LLM echoed the heading as a near-duplicate prefix sentence
    # (e.g. body begins with the first 2-3 words of the heading), strip
    # everything up to the first real sentence about the person.
    head_tokens = [w for w in heading.split() if w]
    if head_tokens:
        head_prefix = " ".join(head_tokens[:2]).lower()
        body_l = body.lower()
        if body_l.startswith(head_prefix):
            # Find the first " The " or ". " that introduces the real body.
            for marker in (" The ", " the ", ". "):
                idx = body.find(marker, len(head_prefix))
                if idx >= 0:
                    body = body[idx:].lstrip(" .:-—")
                    if body.lower().startswith("the "):
                        body = body[0].upper() + body[1:]
                    break

    if not body:
        body = "No further details were available from automated analysis."
    return f"{heading.rstrip('.').strip()}\n\n{body}"


def _body_hallucinates_posture(
    body: str,
    posture_lines: list[str],
    fall_times: list[float],
) -> bool:
    """Return True when the LLM body invents a posture/event that is not
    supported by the timeline or events.

    The current Ollama checkpoint occasionally echoes example wording from
    the system prompt (e.g. inventing 'lying on the ground') even though
    the clip never showed lying. This guard lets us fall back to the
    deterministic body in that case so care staff aren't misled.
    """
    if not body:
        return False
    body_l = body.lower()
    timeline_text = " ".join(posture_lines).lower()

    bad_phrases = (
        "lying on the ground",
        "on the ground",
        "lying down",
        "fell to the",
        "fell down",
        "collapsed",
        "fall",
    )
    timeline_has_lying = "lying" in timeline_text
    timeline_has_walking = "walking" in timeline_text
    has_fall_evidence = bool(fall_times) or "possible fall" in (
        " ".join(posture_lines).lower()
    )
    for phrase in bad_phrases:
        if phrase in body_l:
            if (phrase in {"lying on the ground", "on the ground", "lying down"}
                    and not timeline_has_lying):
                return True
            if (phrase in {"fell to the", "fell down", "collapsed", "fall"}
                    and not has_fall_evidence):
                return True

    # If the timeline shows walking but the body either denies it or omits
    # it entirely, the body contradicts the structured evidence. Fall back.
    if timeline_has_walking:
        deny_walking_phrases = (
            "no indication",
            "did not walk",
            "did not stand",
            "did not move",
            "no movement",
            "remained still",
            "remained motionless",
            "stayed still",
        )
        if any(p in body_l for p in deny_walking_phrases):
            return True
        if "walk" not in body_l:
            return True
    return False


def _audit_properly_mentioned(body: str) -> bool:
    """The held-object audit is only properly mentioned when the body
    BOTH names the object (or 'sharp object') AND includes a verification
    caveat ('not confirmed', 'verification did not confirm', etc.). If the
    LLM names the object without the caveat, we still need to append our
    deterministic sentence so staff don't read it as a definite finding."""
    body_l = (body or "").lower()
    object_keywords = (
        "knife",
        "scissors",
        "fork",
        "sharp object",
    )
    caveat_keywords = (
        "not confirmed",
        "did not confirm",
        "could not confirm",
        "unconfirmed",
        "verification cleared",
        "earlier automated",
    )
    has_object = any(k in body_l for k in object_keywords)
    has_caveat = any(k in body_l for k in caveat_keywords)
    return has_object and has_caveat


def _audit_sentence(sharp_audit: list[str]) -> str:
    """Render the held-object audit as a single plain-English sentence,
    stripping the operator-only suffix (frame name + 'first zoom pass only,
    verification did not confirm') and de-duplicating entries that describe
    the same object / hand / time so we don't say 'a knife and a knife'."""
    if not sharp_audit:
        return ""
    parts: list[str] = []
    seen: set[str] = set()
    for line in sharp_audit:
        phrase = line.lstrip("- ").rstrip(".")
        phrase = re.sub(r"\s*\(frame_[^)]+\)", "", phrase)
        phrase = re.sub(
            r";\s*first zoom pass only.*$", "", phrase, flags=re.I
        ).strip()
        if not phrase:
            continue
        # Normalise whitespace + lowercase for the dedup key so two
        # detections for the same hand at adjacent timestamps collapse.
        key = re.sub(r"\s+", " ", phrase).strip().lower()
        if key in seen:
            continue
        seen.add(key)
        parts.append(phrase)
        if len(parts) >= 2:
            break
    if not parts:
        return ""
    if len(parts) == 1:
        joined = parts[0]
    else:
        joined = parts[0] + " and a " + parts[1]
    return (
        "An earlier automated pass flagged a "
        + joined
        + ", but verification did not confirm it, so staff may wish to "
        "review the footage."
    )


def _ensure_audit_mentioned(body: str, sharp_audit: list[str]) -> str:
    """If the LLM dropped the held-object audit (or named the object
    without the verification caveat) despite our prompt, append the
    deterministic audit sentence so safety-relevant context is never
    lost from the handover note and the certainty stays cautious."""
    if not sharp_audit or _audit_properly_mentioned(body):
        return body
    audit = _audit_sentence(sharp_audit)
    if not audit:
        return body
    body_clean = (body or "").strip().rstrip(".")
    if body_clean:
        return f"{body_clean}. {audit}"
    return audit


def _condense_timeline_parts(parts: list[str]) -> list[str]:
    """Merge adjacent timeline segments that share the same posture phrase
    so the fallback prose doesn't read 'walking, then walking, then walking'.
    Each segment is of the form '<posture phrase>, <time bit>'; we keep the
    posture phrase from the first occurrence and stretch the time bit to
    cover the run."""
    if not parts:
        return parts
    out: list[str] = []
    cur_posture: str | None = None
    cur_first_time: str | None = None
    cur_last_time: str | None = None

    def _split(seg: str) -> tuple[str, str]:
        if "," in seg:
            posture, _, time_bit = seg.partition(",")
            return posture.strip(), time_bit.strip()
        return seg.strip(), ""

    def _flush() -> None:
        if cur_posture is None:
            return
        if cur_first_time and cur_last_time and cur_first_time != cur_last_time:
            out.append(f"{cur_posture}, {cur_first_time} through {cur_last_time}")
        elif cur_first_time:
            out.append(f"{cur_posture}, {cur_first_time}")
        else:
            out.append(cur_posture)

    for seg in parts:
        posture, time_bit = _split(seg)
        if posture == cur_posture:
            cur_last_time = time_bit or cur_last_time
        else:
            _flush()
            cur_posture = posture
            cur_first_time = time_bit
            cur_last_time = time_bit
    _flush()
    return out


def _fallback_body(
    heading: str,
    posture_lines: list[str],
    llm_events: list[str],
    sharp_audit: list[str],
) -> str:
    """Deterministic body used when the LLM call fails, returns an empty
    string, or hallucinates a posture not in the timeline. Renders as
    natural prose so the handover note still reads cleanly."""
    sentences: list[str] = []

    timeline_parts: list[str] = []
    for line in posture_lines:
        timeline_parts.append(line.lstrip("- ").rstrip("."))
    timeline_parts = _condense_timeline_parts(timeline_parts)
    if timeline_parts:
        if len(timeline_parts) == 1:
            sentences.append(f"The person was {timeline_parts[0]}.")
        else:
            joined = ", then ".join(timeline_parts)
            sentences.append(f"The person was {joined}.")

    knife_lines = [
        l.lstrip("- ").rstrip(".")
        for l in llm_events
        if "knife" in l.lower() or "sharp object" in l.lower()
    ]
    other_events = [
        l.lstrip("- ").rstrip(".")
        for l in llm_events
        if "possible fall" not in l.lower() and l not in knife_lines
    ]
    if knife_lines:
        sentences.append(
            f"Verified analysis flagged {knife_lines[0]} during this clip."
        )
    if other_events:
        ev_phrase = ", and ".join(other_events[:2])
        sentences.append(
            f"The pipeline also flagged {ev_phrase} during this window."
        )

    audit = _audit_sentence(sharp_audit)
    if audit:
        sentences.append(audit)

    if not sentences:
        sentences.append(
            "No further details were available from automated analysis."
        )
    return " ".join(sentences)


def explain(run_dir: Path) -> int:
    merged = _load_json(run_dir / "merged" / "merged_frames.json")
    temporal = _load_json(run_dir / "merged" / "temporal.json")
    events = _load_json(run_dir / "merged" / "events.json")

    if not merged:
        print(f"[ERROR] missing merged/merged_frames.json under {run_dir}")
        print("Run: python ai/models/SCVAM2.1/merge_frames.py")
        return 1

    ctx, llm_events, debug_events, heading, posture_lines, sharp_audit = (
        _compact_context(run_dir, merged, temporal, events)
    )

    cfg = LLMConfig.from_env()
    system = (
        "You write very short handover notes for aged-care staff from "
        "automated video analysis. Output strictly in two blocks separated by "
        "a single blank line.\n\n"
        "BLOCK 1 (heading): exactly one short line. Use the 'heading' "
        "field from the structured context VERBATIM (e.g. 'Possible fall "
        "around 4s'). Do not paraphrase, do not add extra words, no "
        "trailing period.\n\n"
        "BLOCK 2 (explainer): 1 or 2 plain-English sentences that explain "
        "what happened, using the 'posture timeline' as the ONLY source of "
        "truth for body positions. Walk through the timeline in order and "
        "name every distinct posture state with its time window. If there "
        "are other notable events from the 'notable events' list, fold "
        "them into the same sentences.\n\n"
        "STRICT POSTURE RULES:\n"
        "- You may ONLY mention postures that literally appear in the "
        "posture timeline (e.g. 'standing', 'sitting', 'possibly walking "
        "around', 'lying on the ground'). NEVER invent a posture that is "
        "not in the timeline.\n"
        "- If 'lying on the ground' is NOT in the timeline, you MUST NOT "
        "say 'lying', 'on the ground', 'collapsed', or 'fell'. Do not "
        "fabricate a fall.\n"
        "- If a timeline bullet says 'possibly walking around', describe "
        "that segment as 'possibly walking' (or 'walking around'). Keep "
        "the cautious 'possibly' wording. Do not call it 'unclear "
        "posture', 'unknown', or 'standing still'.\n"
        "- Mention each timeline segment with its approximate time, e.g. "
        "'standing around 1s, then possibly walking from 2s to 5s'.\n\n"
        "If the structured context includes a 'mid priority' section, you MUST "
        "include at least one sentence in the explainer about those items "
        "(e.g. knife in hand repeated at the listed times). Use the exact "
        "wording from the bullets (confirmed vs possible). If multiple "
        "detections are listed, say the item was seen more than once with "
        "the approximate times.\n\n"
        "If the structured context includes a 'held-object audit' section, "
        "you MUST include one sentence in the explainer stating that an "
        "earlier automated pass flagged a possible knife, scissors, or fork "
        "at about the given time, that the verification step did not "
        "confirm it, and that staff may wish to review the footage. Use "
        "'possible' before the object name. Do not state that the person "
        "definitely held that item.\n\n"
        "Hard rules for both blocks:\n"
        "- Plain English only. No bullets, no labels, no preamble, no "
        "markdown.\n"
        "- Use the bullet lists as the ONLY source of truth. Never invent "
        "details.\n"
        "- If a bullet contains the word 'possible' (e.g. 'possible sharp "
        "object in hand'), the summary MUST keep the word 'possible' "
        "verbatim before the object name. Never drop or upgrade 'possible' "
        "into a definite claim. If the held-object audit names a specific "
        "item (e.g. 'possible knife'), you may repeat that wording; do not "
        "upgrade it to a definite claim.\n"
        "- If a bullet does NOT contain 'possible' for a held object, treat "
        "it as confirmed and report it without the word 'possible'.\n"
        "- Do NOT include severity numbers, confidence numbers, or any "
        "technical field names (no 'person_conf', 'object_count', "
        "'event_type', 'severity', etc).\n"
        "- Do NOT join contradicting observations with 'and' in one clause. "
        "Use separate sentences with their own time windows if needed.\n"
        "- If the heading says 'No concerning events detected', then the "
        "explainer must be exactly: 'No concerning events were detected "
        "during the clip.'"
    )
    user = (
        "Write the handover summary for this clip in the two-block format "
        "described in the system message.\n\n"
        "--- Structured context ---\n"
        f"{ctx}\n\n"
        "Now output the heading line, then a blank line, then the explainer "
        "sentences. Nothing else."
    )

    print(
        "Step 7 LLM explainer (text only)\n"
        f"  run_dir:  {run_dir}\n"
        f"  provider: {cfg.provider}\n"
        f"  heading:  {heading}\n"
        f"  events:   {len(llm_events)} notable line(s)\n"
        f"  posture:  {len(posture_lines)} segment(s)\n"
        f"  sharp_audit: {len(sharp_audit)} line(s)"
    )

    text = try_chat_once(user, system_prompt=system, config=cfg)
    raw = text.strip()
    fall_times_for_check = _fall_evidence_times(
        (events or {}).get("events") or []
    )
    if raw and "\n" in raw:
        # Normalise: heading is whatever the LLM put on line 1; body is
        # everything after the first blank line (or from line 2 onward).
        first_line, _, rest = raw.partition("\n")
        rest = rest.strip("\n ")
        # If the first line doesn't match our heading exactly, force it.
        first_line = first_line.strip(" .:-—")
        if first_line.lower() != heading.lower():
            body = (first_line + " " + rest).strip()
        else:
            body = rest
    elif raw:
        # LLM returned a single line or paragraph; treat it as the body.
        body = raw
    else:
        body = _fallback_body(heading, posture_lines, llm_events, sharp_audit)

    if _body_hallucinates_posture(body, posture_lines, fall_times_for_check):
        # The LLM invented a posture/event we don't have evidence for. Fall
        # back to the deterministic explainer so the handover note stays
        # truthful.
        body = _fallback_body(heading, posture_lines, llm_events, sharp_audit)

    # Safety-critical: if a held-object audit exists but the LLM body
    # didn't mention any object name or the verification phrasing, append
    # the deterministic audit sentence so staff never miss it.
    body = _ensure_audit_mentioned(body, sharp_audit)
    text = _format_heading_and_body(heading, body)

    out_dir = run_dir / "merged"
    out_dir.mkdir(parents=True, exist_ok=True)
    payload = {
        "run_dir": run_dir.as_posix(),
        "llm_provider": cfg.provider,
        "summary_text": text.strip(),
        "summary_heading": heading,
        "summary_posture_lines": posture_lines,
        "sharp_audit_lines": sharp_audit,
        "llm_event_lines": llm_events,
        "debug_event_lines": debug_events,
        "context_excerpt": ctx[:8000],
    }
    (out_dir / "llm_summary.json").write_text(
        json.dumps(payload, indent=2),
        encoding="utf-8",
    )
    (out_dir / "llm_summary.txt").write_text(text.strip() + "\n", encoding="utf-8")
    print(f"\nWrote:\n  {out_dir / 'llm_summary.txt'}\n  {out_dir / 'llm_summary.json'}")
    print("\n--- Summary ---\n" + text.strip())
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Step 7: LLM explainer (text only).")
    parser.add_argument(
        "--run",
        default="",
        help="Run dir (default: newest under output with merged/merged_frames.json).",
    )
    args = parser.parse_args()

    if args.run:
        run_dir = Path(args.run).expanduser().resolve()
    else:
        latest = _newest_run_dir()
        if latest is None:
            print(
                "No --run and no output/*/merged/merged_frames.json.\n"
                "Complete Steps 1–6 first, or pass --run."
            )
            return 1
        run_dir = latest

    return explain(run_dir)


if __name__ == "__main__":
    sys.exit(main())
