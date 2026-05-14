"""
backend/services/asr_service.py

Whisper speech-to-text service.
Lazy-loads model on first call. Runs inference in thread executor
so it never blocks the FastAPI event loop.

Add to requirements.txt:
    openai-whisper

Env var (optional):
    WHISPER_MODEL_SIZE=base   # tiny | base | small | medium | large
"""

from __future__ import annotations

import asyncio
import logging
import os
import tempfile
from typing import Optional

logger = logging.getLogger(__name__)

WHISPER_MODEL_SIZE = os.getenv("WHISPER_MODEL_SIZE", "base")
# Ensure ffmpeg is in PATH
_FFMPEG_PATH = r'C:\Users\25371\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-8.1.1-full_build\bin'
if _FFMPEG_PATH not in os.environ.get('PATH', ''):
    os.environ['PATH'] = _FFMPEG_PATH + os.pathsep + os.environ.get('PATH', '')


_model = None
_model_lock = asyncio.Lock()
_transcribe_lock = asyncio.Lock()


def _load_model_sync():
    global _model
    if _model is not None:
        return _model
    try:
        import whisper
        logger.info(f"[ASR] Loading Whisper model: {WHISPER_MODEL_SIZE}")
        _model = whisper.load_model(WHISPER_MODEL_SIZE)
        logger.info("[ASR] Whisper model ready")
        return _model
    except ImportError:
        raise RuntimeError("openai-whisper not installed. Run: pip install openai-whisper")


async def _get_model():
    global _model
    if _model is not None:
        return _model
    async with _model_lock:
        if _model is not None:
            return _model
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, _load_model_sync)
        return _model


def _transcribe_sync(
    model,
    audio_bytes: bytes,
    language: Optional[str],
    file_suffix: str,
) -> dict:
    """Write bytes to temp file and run Whisper (requires file path)."""
    with tempfile.NamedTemporaryFile(suffix=file_suffix, delete=False) as tmp:
        tmp.write(audio_bytes)
        tmp_path = tmp.name

    try:
        kwargs: dict = {
            "fp16": False,
            "task": "transcribe",
            "condition_on_previous_text": False,
            "verbose": False,
            "temperature": 0,
            "no_speech_threshold": 0.6,
            "logprob_threshold": -1.0,
        }
        if language:
            kwargs["language"] = language

        result = model.transcribe(tmp_path, **kwargs)
        return {
            "text": result.get("text", "").strip(),
            "language": result.get("language", "en"),
            "segments": [
                {"start": s["start"], "end": s["end"], "text": s["text"].strip()}
                for s in result.get("segments", [])
            ],
        }
    finally:
        try:
            os.unlink(tmp_path)
        except Exception:
            pass


async def transcribe(
    audio_bytes: bytes,
    language: Optional[str] = None,
    file_suffix: str = ".webm",
) -> dict:
    """
    Async transcription entry point.

    Returns:
        {
          "text": "full text",
          "language": "en",
          "segments": [{"start": 0.0, "end": 1.2, "text": "Hello"}]
        }
    """
    if not audio_bytes or len(audio_bytes) < 200:
        return {"text": "", "language": "en", "segments": []}

    model = await _get_model()
    loop = asyncio.get_event_loop()

    try:
        async with _transcribe_lock:
            return await loop.run_in_executor(
                None,
                _transcribe_sync,
                model,
                audio_bytes,
                language,
                file_suffix,
            )
    except Exception:
        logger.exception("[ASR] Transcription error")
        return {"text": "", "language": "en", "segments": []}


async def is_ready() -> bool:
    try:
        await _get_model()
        return _model is not None
    except Exception:
        return False
