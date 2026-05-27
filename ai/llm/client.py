from __future__ import annotations

import base64
import os
from dataclasses import dataclass
from pathlib import Path
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


def try_chat_once(
    prompt: str,
    *,
    system_prompt: str = "",
    config: Optional[LLMConfig] = None,
) -> str:
    """
    Best-effort chat helper for pipelines that must not hard-fail on LLM outage.
    Returns empty string if provider call fails.
    """
    try:
        return chat_once(prompt, system_prompt=system_prompt, config=config)
    except Exception:
        return ""


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


def _mime_for_image(path: Path) -> str:
    suf = path.suffix.lower()
    if suf in (".jpg", ".jpeg"):
        return "image/jpeg"
    if suf == ".webp":
        return "image/webp"
    return "image/png"


def chat_once_with_images(
    prompt: str,
    image_paths: list[Path],
    *,
    system_prompt: str = "",
    config: Optional[LLMConfig] = None,
) -> str:
    """
    OpenAI-compatible chat with one text block plus optional images (base64 data URLs).
    Use a vision-capable model (e.g. gpt-4o-mini, gpt-4o). Other providers are not supported.
    """
    cfg = config or LLMConfig.from_env()
    provider = cfg.provider
    if provider not in ("openai", "openai_compatible"):
        raise RuntimeError(
            "chat_once_with_images requires AI_LLM_PROVIDER=openai or openai_compatible"
        )
    if not cfg.openai_api_key:
        raise RuntimeError("AI_OPENAI_API_KEY is empty.")

    parts: list[dict] = [{"type": "text", "text": prompt}]
    for p in image_paths:
        pp = Path(p)
        if not pp.is_file():
            continue
        raw = pp.read_bytes()
        b64 = base64.standard_b64encode(raw).decode("ascii")
        mime = _mime_for_image(pp)
        parts.append(
            {
                "type": "image_url",
                "image_url": {"url": f"data:{mime};base64,{b64}"},
            }
        )

    url = f"{cfg.openai_base_url.rstrip('/')}/chat/completions"
    headers = {
        "Authorization": f"Bearer {cfg.openai_api_key}",
        "Content-Type": "application/json",
    }
    messages = []
    if system_prompt.strip():
        messages.append({"role": "system", "content": system_prompt})
    messages.append({"role": "user", "content": parts})
    payload = {
        "model": cfg.openai_model,
        "messages": messages,
        "temperature": 0.3,
        "max_tokens": 1024,
    }

    with httpx.Client(timeout=cfg.timeout_seconds) as client:
        response = client.post(url, json=payload, headers=headers)
        response.raise_for_status()
        data = response.json()

    choices = data.get("choices") or []
    if not choices:
        return ""
    return str((choices[0].get("message") or {}).get("content") or "").strip()


def try_chat_with_images(
    prompt: str,
    image_paths: list[Path],
    *,
    system_prompt: str = "",
    config: Optional[LLMConfig] = None,
) -> str:
    """
    Vision-capable OpenAI call when provider is openai; otherwise text-only with paths appended.
    Never raises; returns empty string on failure.
    """
    cfg = config or LLMConfig.from_env()
    paths = [Path(p) for p in image_paths if Path(p).is_file()]
    try:
        if cfg.provider in ("openai", "openai_compatible") and paths:
            return chat_once_with_images(
                prompt,
                paths,
                system_prompt=system_prompt,
                config=cfg,
            )
    except Exception:
        pass
    extra = ""
    if paths:
        extra = (
            "\n\n[Image paths on disk — describe only from metrics above if you cannot see pixels]\n"
            + "\n".join(str(p.resolve()) for p in paths)
        )
    return try_chat_once(
        prompt + extra,
        system_prompt=system_prompt,
        config=cfg,
    )

