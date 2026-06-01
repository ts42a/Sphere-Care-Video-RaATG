from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

import httpx

from backend.core import config as app_config


@dataclass
class LLMNarrative:
    title: str
    body: str


_JSON_FENCE = re.compile(r"```(?:json)?\s*([\s\S]*?)\s*```", re.I)


def _parse_json_loose(text: str) -> Optional[Dict[str, Any]]:
    text = text.strip()
    m = _JSON_FENCE.search(text)
    if m:
        text = m.group(1).strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start = text.find("{")
        end = text.rfind("}")
        if start >= 0 and end > start:
            try:
                return json.loads(text[start : end + 1])
            except json.JSONDecodeError:
                return None
    return None


def _system_prompt() -> str:
    return (
        "You are a clinical operations assistant for aged care. "
        "Given ONLY structured JSON from a vision/rules pipeline, produce a short staff-facing summary. "
        "Do not invent facts not present in the input. "
        "Respond with a single JSON object: {\"title\": \"...\", \"body\": \"...\"} "
        "where body is 2-4 sentences."
    )


def generate_narrative(structured_event: Dict[str, Any]) -> Optional[LLMNarrative]:
    provider = app_config.AI_LLM_PROVIDER
    if provider in ("", "none", "off"):
        return None

    user_msg = json.dumps(structured_event, ensure_ascii=False)

    try:
        if provider == "ollama":
            return _ollama_chat(user_msg)
        if provider in ("openai", "openai_compatible"):
            return _openai_chat(user_msg)
    except (httpx.HTTPError, json.JSONDecodeError, KeyError, TypeError):
        return None
    return None


def _ollama_chat(user_msg: str) -> Optional[LLMNarrative]:
    url = f"{app_config.AI_OLLAMA_BASE_URL.rstrip('/')}/api/chat"
    payload = {
        "model": app_config.AI_OLLAMA_MODEL,
        "stream": False,
        "messages": [
            {"role": "system", "content": _system_prompt()},
            {"role": "user", "content": user_msg},
        ],
    }
    with httpx.Client(timeout=120.0) as client:
        r = client.post(url, json=payload)
        r.raise_for_status()
        data = r.json()
    text = (data.get("message") or {}).get("content") or ""
    parsed = _parse_json_loose(text)
    if not parsed:
        return LLMNarrative(title="AI summary", body=text[:2000] if text else "No response.")
    return LLMNarrative(title=str(parsed.get("title", "Insight")), body=str(parsed.get("body", "")))


def _openai_chat(user_msg: str) -> Optional[LLMNarrative]:
    if not app_config.AI_OPENAI_API_KEY:
        return None
    url = f"{app_config.AI_OPENAI_BASE_URL.rstrip('/')}/chat/completions"
    headers = {
        "Authorization": f"Bearer {app_config.AI_OPENAI_API_KEY}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": app_config.AI_OPENAI_MODEL,
        "messages": [
            {"role": "system", "content": _system_prompt()},
            {"role": "user", "content": user_msg},
        ],
        "temperature": 0.3,
    }
    with httpx.Client(timeout=120.0) as client:
        r = client.post(url, json=payload, headers=headers)
        r.raise_for_status()
        data = r.json()
    text = data["choices"][0]["message"]["content"]
    parsed = _parse_json_loose(text)
    if not parsed:
        return LLMNarrative(title="AI summary", body=text[:2000])
    return LLMNarrative(title=str(parsed.get("title", "Insight")), body=str(parsed.get("body", "")))


def fallback_narrative(hit_dict: Dict[str, Any]) -> LLMNarrative:
    et = hit_dict.get("event_type", "Event")
    return LLMNarrative(
        title=f"{et} — review",
        body=hit_dict.get("description") or "Automated vision event; staff review recommended.",
    )


def summarize_timeline_text(lines: List[str]) -> str:
    provider = app_config.AI_LLM_PROVIDER
    blob = "\n".join(lines)[:12000]
    if provider in ("", "none", "off"):
        return blob or "No activity lines."

    sys_msg = (
        "Summarize CCTV activity timelines for aged-care staff handover. "
        "3-6 short bullet points. No speculation beyond the text. "
        'JSON only: {"title": "...", "body": "..."} with body using newline-separated bullets.'
    )
    try:
        if provider == "ollama":
            url = f"{app_config.AI_OLLAMA_BASE_URL.rstrip('/')}/api/chat"
            payload = {
                "model": app_config.AI_OLLAMA_MODEL,
                "stream": False,
                "messages": [
                    {"role": "system", "content": sys_msg},
                    {"role": "user", "content": blob},
                ],
            }
            with httpx.Client(timeout=120.0) as client:
                r = client.post(url, json=payload)
                r.raise_for_status()
                text = (r.json().get("message") or {}).get("content") or ""
        elif provider in ("openai", "openai_compatible") and app_config.AI_OPENAI_API_KEY:
            url = f"{app_config.AI_OPENAI_BASE_URL.rstrip('/')}/chat/completions"
            headers = {
                "Authorization": f"Bearer {app_config.AI_OPENAI_API_KEY}",
                "Content-Type": "application/json",
            }
            payload = {
                "model": app_config.AI_OPENAI_MODEL,
                "messages": [
                    {"role": "system", "content": sys_msg},
                    {"role": "user", "content": blob},
                ],
                "temperature": 0.3,
            }
            with httpx.Client(timeout=120.0) as client:
                r = client.post(url, json=payload, headers=headers)
                r.raise_for_status()
                text = r.json()["choices"][0]["message"]["content"]
        else:
            return blob
        parsed = _parse_json_loose(text)
        if parsed and parsed.get("body"):
            return f"{parsed.get('title', 'Video summary')}\n\n{parsed['body']}"
        return text.strip() or blob
    except (httpx.HTTPError, KeyError, TypeError, json.JSONDecodeError):
        return blob


def _call_llm(sys_msg: str, user_msg: str, force_json: bool = False) -> Optional[str]:
    """Low-level helper: send a single system+user turn, return raw text.

    force_json is mainly for local Ollama models, which may otherwise wrap
    answers in markdown fences or add explanatory text.
    """
    provider = app_config.AI_LLM_PROVIDER
    if provider in ("", "none", "off"):
        return None
    try:
        if provider == "ollama":
            url = f"{app_config.AI_OLLAMA_BASE_URL.rstrip('/')}/api/chat"
            payload = {
                "model": app_config.AI_OLLAMA_MODEL,
                "stream": False,
                "messages": [
                    {"role": "system", "content": sys_msg},
                    {"role": "user", "content": user_msg},
                ],
            }
            if force_json:
                payload["format"] = "json"
            with httpx.Client(timeout=120.0) as client:
                r = client.post(url, json=payload)
                r.raise_for_status()
                return (r.json().get("message") or {}).get("content") or ""
        if provider in ("openai", "openai_compatible") and app_config.AI_OPENAI_API_KEY:
            url = f"{app_config.AI_OPENAI_BASE_URL.rstrip('/')}/chat/completions"
            headers = {
                "Authorization": f"Bearer {app_config.AI_OPENAI_API_KEY}",
                "Content-Type": "application/json",
            }
            payload = {
                "model": app_config.AI_OPENAI_MODEL,
                "messages": [
                    {"role": "system", "content": sys_msg},
                    {"role": "user", "content": user_msg},
                ],
                "temperature": 0.3,
            }
            if force_json:
                payload["response_format"] = {"type": "json_object"}
            with httpx.Client(timeout=120.0) as client:
                r = client.post(url, json=payload, headers=headers)
                r.raise_for_status()
                return r.json()["choices"][0]["message"]["content"]
    except (httpx.HTTPError, KeyError, TypeError, json.JSONDecodeError):
        pass
    return None



def _compact_transcript_lines(transcript: str, limit: int = 6) -> list[str]:
    """Return short, safe transcript excerpts for fallback summaries."""
    lines: list[str] = []
    for raw in (transcript or "").splitlines():
        line = " ".join(str(raw).strip().split())
        if not line:
            continue
        # Avoid dumping very long raw transcript lines into patient chat.
        if len(line) > 180:
            line = line[:177].rstrip() + "..."
        lines.append(line)
    return lines[:limit]


def _fallback_call_summary_versions(transcript: str, duration_seconds: int = 0) -> Dict[str, str]:
    """Deterministic fallback used when no LLM provider is configured or the LLM fails.

    This keeps the demo flow working and makes the limitation clear without
    pretending to have made clinical inferences.
    """
    dur = f" Duration: {duration_seconds // 60}m {duration_seconds % 60}s." if duration_seconds else ""
    excerpts = _compact_transcript_lines(transcript)
    if excerpts:
        excerpt_block = "\n".join(f"• {line}" for line in excerpts)
        staff = (
            "AI provider was not available, so a deterministic transcript summary was created for review."
            f"{dur} Key captured transcript lines:\n{excerpt_block}\n"
            "Please review the full transcript before using this as a clinical note."
        )
        patient = (
            "Your call summary is ready. The system captured these main points from the call transcript:\n"
            f"{excerpt_block}\n\n"
            "Please follow the care instructions given by your care team. If anything here looks incorrect, ask your care team to confirm it."
        )
    else:
        staff = (
            "The call ended, but no transcript was captured, so a detailed AI summary could not be generated. "
            "Please add manual follow-up notes if this call included important care information."
        )
        patient = (
            "Your video call has ended. A detailed AI summary could not be generated because no transcript was captured. "
            "Please contact your care team if you need any details from the call confirmed."
        )
    return {"staff_summary": staff, "patient_summary": patient}



def _summary_value_to_text(value: Any) -> str:
    """Normalize LLM summary fields into plain text.

    Small local models sometimes return objects or arrays even when asked for
    string values. Patient chat must never receive raw JSON, so convert common
    shapes into readable prose.
    """
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, list):
        parts = [_summary_value_to_text(item) for item in value]
        return "\n".join(part for part in parts if part).strip()
    if isinstance(value, dict):
        for key in ("summary", "text", "body", "message", "content", "plain_text"):
            if key in value:
                nested = _summary_value_to_text(value.get(key))
                if nested:
                    return nested

        labelled: list[str] = []
        labels = {
            "main_topics": "Main topics",
            "care_concerns": "Care concerns",
            "follow_up_actions": "Follow-up actions",
            "follow-up actions": "Follow-up actions",
            "actions": "Follow-up actions",
        }
        for key, raw in value.items():
            text = _summary_value_to_text(raw)
            if not text:
                continue
            label = labels.get(str(key), str(key).replace("_", " ").title())
            if isinstance(raw, list):
                text = ", ".join(_summary_value_to_text(item) for item in raw if _summary_value_to_text(item))
            labelled.append(f"{label}: {text}.")
        return " ".join(labelled).strip()
    return str(value).strip()

def summarize_call_transcript_versions(transcript: str, duration_seconds: int = 0) -> Optional[Dict[str, str]]:
    """Generate staff-facing and patient-facing call summaries.

    The patient version is intentionally safer and less clinical because it is
    sent directly to the mobile client's chat after a demo call.
    """
    if not transcript or not transcript.strip():
        return _fallback_call_summary_versions(transcript, duration_seconds)

    sys_msg = (
        "You are a clinical documentation assistant for an aged-care telehealth app. "
        "Create two summaries from the transcript only. Do not invent facts. "
        "Return exactly ONE valid JSON object and nothing else. Do not use markdown code fences. "
        "The JSON schema must be {\"staff_summary\": \"string\", \"patient_summary\": \"string\"}. "
        "Both values must be plain strings, not arrays or objects. "
        "staff_summary: 3-5 sentences for staff handover, including main topics, care concerns, and follow-up actions if mentioned. "
        "patient_summary: plain language, safe for the patient to read, 60-130 words maximum. "
        "Use a neutral care summary tone. Do not start with greetings such as Hi there. "
        "Do not use first person language such as I or we. "
        "The patient summary must not include internal staff-only reasoning, unconfirmed diagnoses, risk labels, raw transcript dumps, or speaker IDs. "
        "Include a short reminder to confirm important details with the care team."
    )
    dur = f" (duration: {duration_seconds // 60}m {duration_seconds % 60}s)" if duration_seconds else ""
    user_msg = f"Call transcript{dur}:\n\n{transcript[:10000]}"
    text = _call_llm(sys_msg, user_msg, force_json=True)

    if not text:
        return _fallback_call_summary_versions(transcript, duration_seconds)

    parsed = _parse_json_loose(text)
    if not parsed:
        clean = text.strip()
        if not clean:
            return _fallback_call_summary_versions(transcript, duration_seconds)
        return {"staff_summary": clean[:3000], "patient_summary": clean[:1800]}

    staff = _summary_value_to_text(parsed.get("staff_summary") or parsed.get("staff"))
    patient = _summary_value_to_text(parsed.get("patient_summary") or parsed.get("patient"))
    if not staff and not patient:
        return _fallback_call_summary_versions(transcript, duration_seconds)
    if not staff:
        staff = patient
    if not patient:
        patient = staff
    return {"staff_summary": staff[:3000], "patient_summary": patient[:1800]}

def summarize_call_transcript(transcript: str, duration_seconds: int = 0) -> Optional[str]:
    """Generate the staff-facing call summary used by legacy callers."""
    versions = summarize_call_transcript_versions(transcript, duration_seconds)
    if not versions:
        return None
    return versions.get("staff_summary") or versions.get("patient_summary")


def summarize_resident_context(
    resident_name: str,
    profile: Dict[str, Any],
    records: List[Dict[str, Any]],
    alerts: List[Dict[str, Any]],
) -> Optional[str]:
    """Generate a holistic resident care summary for the last 72 h."""
    sys_msg = (
        "You are a clinical operations assistant for aged care. "
        "Write a concise resident status summary (4-6 sentences) based on the provided data. "
        "Cover: current care status, recent activity or concerns, alert history. "
        "Staff-facing, plain prose. Do not invent facts not present in the input."
    )
    import json as _json
    context = {
        "resident": resident_name,
        "profile": profile,
        "recent_records": records[:10],
        "recent_alerts": alerts[:10],
    }
    user_msg = _json.dumps(context, ensure_ascii=False, default=str)[:12000]
    return _call_llm(sys_msg, user_msg)


def summarize_recording_transcript(transcript: str, resident_name: str = "") -> Optional[str]:
    """Generate a clinical summary from a recording's ASR transcript."""
    if not transcript or not transcript.strip():
        return None
    sys_msg = (
        "You are a clinical documentation assistant for aged care. "
        "Summarise this recording transcript in 3-5 sentences. "
        "Note any care concerns, behavioural observations, or follow-up actions. "
        "Plain prose. Do not invent facts."
    )
    who = f" (resident: {resident_name})" if resident_name else ""
    user_msg = f"Recording transcript{who}:\n\n{transcript[:10000]}"
    return _call_llm(sys_msg, user_msg)
