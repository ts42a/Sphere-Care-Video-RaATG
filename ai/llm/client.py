from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Optional

import httpx


@dataclass
class LLMConfig:
    provider: str = "ollama"
    ollama_base_url: str = "http://127.0.0.1:11434"
    ollama_model: str = "llama3.2:3b"
    openai_base_url: str = "https://api.openai.com/v1"
    openai_model: str = "gpt-4o-mini"
    openai_api_key: str = ""
    timeout_seconds: float = 120.0

    @classmethod
    def from_env(cls) -> "LLMConfig":
        return cls(
            provider=os.getenv("AI_LLM_PROVIDER", "ollama").strip().lower(),
            ollama_base_url=os.getenv("AI_OLLAMA_BASE_URL", "http://127.0.0.1:11434").strip(),
            ollama_model=os.getenv("AI_OLLAMA_MODEL", "llama3.2:3b").strip(),
            openai_base_url=os.getenv("AI_OPENAI_BASE_URL", "https://api.openai.com/v1").strip(),
            openai_model=os.getenv("AI_OPENAI_MODEL", "gpt-4o-mini").strip(),
            openai_api_key=os.getenv("AI_OPENAI_API_KEY", "").strip(),
            timeout_seconds=float(os.getenv("AI_LLM_TIMEOUT_SECONDS", "120")),
        )


def chat_once(
    prompt: str,
    *,
    system_prompt: str = "",
    config: Optional[LLMConfig] = None,
) -> str:
    cfg = config or LLMConfig.from_env()
    provider = cfg.provider
    if provider in ("", "none", "off", "disabled"):
        raise RuntimeError("AI_LLM_PROVIDER is disabled/off. Use 'ollama' or 'openai'.")

    if provider == "ollama":
        return _ollama_chat(prompt, system_prompt=system_prompt, config=cfg)
    if provider in ("openai", "openai_compatible"):
        return _openai_chat(prompt, system_prompt=system_prompt, config=cfg)

    raise RuntimeError(f"Unsupported AI_LLM_PROVIDER: {provider}")


def _ollama_chat(prompt: str, *, system_prompt: str, config: LLMConfig) -> str:
    url = f"{config.ollama_base_url.rstrip('/')}/api/chat"
    messages = []
    if system_prompt.strip():
        messages.append({"role": "system", "content": system_prompt})
    messages.append({"role": "user", "content": prompt})
    payload = {
        "model": config.ollama_model,
        "stream": False,
        "messages": messages,
    }

    with httpx.Client(timeout=config.timeout_seconds) as client:
        response = client.post(url, json=payload)
        response.raise_for_status()
        data = response.json()

    return str((data.get("message") or {}).get("content") or "").strip()


def _openai_chat(prompt: str, *, system_prompt: str, config: LLMConfig) -> str:
    if not config.openai_api_key:
        raise RuntimeError("AI_OPENAI_API_KEY is empty.")

    url = f"{config.openai_base_url.rstrip('/')}/chat/completions"
    headers = {
        "Authorization": f"Bearer {config.openai_api_key}",
        "Content-Type": "application/json",
    }
    messages = []
    if system_prompt.strip():
        messages.append({"role": "system", "content": system_prompt})
    messages.append({"role": "user", "content": prompt})
    payload = {
        "model": config.openai_model,
        "messages": messages,
        "temperature": 0.3,
    }

    with httpx.Client(timeout=config.timeout_seconds) as client:
        response = client.post(url, json=payload, headers=headers)
        response.raise_for_status()
        data = response.json()

    choices = data.get("choices") or []
    if not choices:
        return ""
    return str((choices[0].get("message") or {}).get("content") or "").strip()

