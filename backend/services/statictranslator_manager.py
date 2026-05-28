from __future__ import annotations

import json
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Any


class StaticTranslatorManager:
    def __init__(self) -> None:
        self._proc: subprocess.Popen[str] | None = None
        self._reader_thread: threading.Thread | None = None
        self._lock = threading.Lock()
        self._cond = threading.Condition(self._lock)
        self._latest_event: dict[str, Any] = {"type": "idle"}
        self._event_seq = 0
        self._last_error: str | None = None

    def _script_path(self) -> Path:
        # backend/services -> backend -> project root
        root = Path(__file__).resolve().parents[2]
        return root / "ai" / "models" / "ASLLM" / "static" / "statictranslator.py"

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
                ev = json.loads(text)
                with self._lock:
                    self._latest_event = ev
                    self._event_seq += 1
                    if ev.get("type") == "error":
                        self._last_error = str(ev.get("detail") or "unknown error")
                    self._cond.notify_all()
            except Exception:
                with self._lock:
                    self._latest_event = {"type": "log", "message": text}
                    self._event_seq += 1
                    self._cond.notify_all()
        with self._lock:
            if self._proc and self._proc.poll() is not None:
                if self._latest_event.get("type") != "stopped":
                    self._latest_event = {"type": "stopped"}
                    self._event_seq += 1
            self._proc = None
            self._cond.notify_all()

    def start(self) -> dict[str, Any]:
        with self._lock:
            if self._proc is not None and self._proc.poll() is None:
                return {"started": False, "running": True, "reason": "already_running"}

            script = self._script_path()
            if not script.exists():
                self._last_error = f"Script not found: {script}"
                return {"started": False, "running": False, "reason": self._last_error}

            cmd = [self._python_bin(), "-u", str(script), "--threshold", "0.51"]
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
                self._event_seq += 1
                self._cond.notify_all()
                return {"started": False, "running": False, "reason": self._last_error}

            self._latest_event = {"type": "starting"}
            self._event_seq += 1
            self._last_error = None
            self._cond.notify_all()
            self._reader_thread = threading.Thread(target=self._reader, daemon=True, name="statictranslator-reader")
            self._reader_thread.start()
            time.sleep(0.15)
            if self._proc.poll() is not None:
                err = self._last_error or "Static translator exited immediately."
                self._proc = None
                self._latest_event = {"type": "error", "detail": err}
                self._event_seq += 1
                self._cond.notify_all()
                return {"started": False, "running": False, "reason": err}
            return {"started": True, "running": True}

    def stop(self) -> dict[str, Any]:
        with self._lock:
            if self._proc is None or self._proc.poll() is not None:
                self._proc = None
                self._latest_event = {"type": "idle"}
                self._event_seq += 1
                self._cond.notify_all()
                return {"stopped": False, "running": False, "reason": "not_running"}
            self._proc.terminate()
            self._latest_event = {"type": "stopping"}
            self._event_seq += 1
            self._cond.notify_all()
        return {"stopped": True, "running": True}

    def status(self) -> dict[str, Any]:
        with self._lock:
            running = self._proc is not None and self._proc.poll() is None
            return {
                "running": running,
                "latest_event": self._latest_event,
                "event_seq": self._event_seq,
                "last_error": self._last_error,
            }

    def wait_for_event(self, last_seq: int, timeout_s: float = 1.0) -> dict[str, Any]:
        with self._cond:
            self._cond.wait_for(lambda: self._event_seq != last_seq, timeout=timeout_s)
            running = self._proc is not None and self._proc.poll() is None
            return {
                "running": running,
                "latest_event": self._latest_event,
                "event_seq": self._event_seq,
                "last_error": self._last_error,
            }


statictranslator_manager = StaticTranslatorManager()
