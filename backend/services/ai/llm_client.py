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
