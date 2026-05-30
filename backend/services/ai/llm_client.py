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


def _call_llm(sys_msg: str, user_msg: str) -> Optional[str]:
    """Low-level helper: send a single system+user turn, return raw text."""
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
            with httpx.Client(timeout=120.0) as client:
                r = client.post(url, json=payload, headers=headers)
                r.raise_for_status()
                return r.json()["choices"][0]["message"]["content"]
    except (httpx.HTTPError, KeyError, TypeError, json.JSONDecodeError):
        pass
    return None


def summarize_call_transcript(transcript: str, duration_seconds: int = 0) -> Optional[str]:
    """Generate a concise clinical summary from a call transcript."""
    if not transcript or not transcript.strip():
        return None
    sys_msg = (
        "You are a clinical documentation assistant for aged care. "
        "Summarise this staff-client call transcript in 3-5 sentences for the care record. "
        "Include: main topics discussed, any care concerns raised, follow-up actions mentioned. "
        "Plain prose, no bullet points. Do not invent facts."
    )
    dur = f" (duration: {duration_seconds // 60}m {duration_seconds % 60}s)" if duration_seconds else ""
    user_msg = f"Call transcript{dur}:\n\n{transcript[:10000]}"
    return _call_llm(sys_msg, user_msg)


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
