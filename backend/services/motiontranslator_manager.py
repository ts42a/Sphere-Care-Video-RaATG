from __future__ import annotations

import json
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Any


class MotionTranslatorManager:
    def __init__(self) -> None:
        self._proc: subprocess.Popen[str] | None = None
        self._reader_thread: threading.Thread | None = None
        self._lock = threading.Lock()
        self._latest_event: dict[str, Any] = {"type": "idle"}
        self._last_error: str | None = None

    def _script_path(self) -> Path:
        root = Path(__file__).resolve().parents[2]
        return root / "ai" / "models" / "ASLLM" / "motion" / "motiontranslator.py"

    def _python_bin(self) -> str:
        root = Path(__file__).resolve().parents[2]
        py = root / ".venv" / "Scripts" / "python.exe"
        if py.exists():
            return str(py)
        if sys.executable:
            return sys.executable
        return "python"

    def _reader(self) -> None:
        assert self._proc is not None and self._proc.stdout is not None
        for line in self._proc.stdout:
            text = line.strip()
            if not text:
                continue
            try:
                self._latest_event = json.loads(text)
            except Exception:
                self._latest_event = {"type": "log", "message": text}
        if self._proc and self._proc.poll() is not None and self._latest_event.get("type") != "stopped":
            self._latest_event = {"type": "stopped"}
        self._proc = None

    def start(self) -> dict[str, Any]:
        with self._lock:
            if self._proc is not None and self._proc.poll() is None:
                return {"started": False, "running": True, "reason": "already_running"}

            script = self._script_path()
            if not script.exists():
                self._last_error = f"Script not found: {script}"
                return {"started": False, "running": False, "reason": self._last_error}

            cmd = [self._python_bin(), "-u", str(script)]
            try:
                self._proc = subprocess.Popen(
                    cmd,
                    cwd=str(script.parent),
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    text=True,
                    bufsize=1,
                )
            except Exception as exc:
                self._proc = None
                self._last_error = f"Failed to launch Python process: {exc}"
                self._latest_event = {"type": "error", "detail": self._last_error}
                return {"started": False, "running": False, "reason": self._last_error}

            self._latest_event = {"type": "starting"}
            self._last_error = None
            self._reader_thread = threading.Thread(target=self._reader, daemon=True, name="motiontranslator-reader")
            self._reader_thread.start()
            time.sleep(0.15)
            if self._proc.poll() is not None:
                err = self._last_error or "Motion translator exited immediately."
                self._proc = None
                self._latest_event = {"type": "error", "detail": err}
                return {"started": False, "running": False, "reason": err}
            return {"started": True, "running": True}

    def stop(self) -> dict[str, Any]:
        with self._lock:
            if self._proc is None or self._proc.poll() is not None:
                self._proc = None
                self._latest_event = {"type": "idle"}
                return {"stopped": False, "running": False, "reason": "not_running"}
            self._proc.terminate()
            self._latest_event = {"type": "stopping"}
        return {"stopped": True, "running": True}

    def status(self) -> dict[str, Any]:
        with self._lock:
            running = self._proc is not None and self._proc.poll() is None
            return {
                "running": running,
                "latest_event": self._latest_event,
                "last_error": self._last_error,
            }


motiontranslator_manager = MotionTranslatorManager()
