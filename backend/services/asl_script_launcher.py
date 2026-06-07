"""Launch run_static.py / run_motion.py from backend/asl_runtime (same as `py run_*.py`)."""
from __future__ import annotations

import subprocess
import sys
import time
from pathlib import Path
from typing import Any


class AslScriptLauncher:
    def __init__(self, script_name: str) -> None:
        self._script_name = script_name
        self._proc: subprocess.Popen[Any] | None = None
        self._last_error: str | None = None

    def _project_root(self) -> Path:
        return Path(__file__).resolve().parents[2]

    def _runtime_dir(self) -> Path:
        return self._project_root() / "backend" / "asl_runtime"

    def _python_bin(self) -> str:
        root = self._project_root()
        py = root / ".venv" / "Scripts" / "python.exe"
        if py.exists():
            return str(py)
        if sys.executable:
            return sys.executable
        return "python"

    def _script_cmd(self) -> list[str]:
        return [self._python_bin(), self._script_name]

    def _read_stderr_tail(self) -> str:
        if self._proc is None or self._proc.stderr is None:
            return ""
        try:
            raw = self._proc.stderr.read()
            if raw:
                return raw.decode("utf-8", errors="replace").strip()[-600:]
        except Exception:
            pass
        return ""

    def start(self) -> dict[str, Any]:
        if self._proc is not None and self._proc.poll() is None:
            return {"started": False, "running": True, "reason": "already_running"}

        runtime = self._runtime_dir()
        script = runtime / self._script_name
        if not script.exists():
            self._last_error = f"Script not found: {script}"
            return {"started": False, "running": False, "reason": self._last_error}

        try:
            self._proc = subprocess.Popen(
                self._script_cmd(),
                cwd=str(runtime),
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
            )
        except Exception as exc:
            self._proc = None
            self._last_error = f"Failed to launch: {exc}"
            return {"started": False, "running": False, "reason": self._last_error}

        self._last_error = None
        time.sleep(0.5)
        if self._proc.poll() is not None:
            err_tail = self._read_stderr_tail()
            msg = f"{self._script_name} exited immediately (code {self._proc.returncode})."
            if err_tail:
                msg = f"{msg} {err_tail}"
            self._last_error = msg
            self._proc = None
            return {"started": False, "running": False, "reason": self._last_error}
        return {"started": True, "running": True}

    def stop(self) -> dict[str, Any]:
        if self._proc is None or self._proc.poll() is not None:
            self._proc = None
            return {"stopped": False, "running": False, "reason": "not_running"}
        self._proc.terminate()
        try:
            self._proc.wait(timeout=3)
        except subprocess.TimeoutExpired:
            self._proc.kill()
        self._proc = None
        return {"stopped": True, "running": False}

    def status(self) -> dict[str, Any]:
        running = self._proc is not None and self._proc.poll() is None
        if self._proc is not None and self._proc.poll() is not None:
            code = self._proc.returncode
            err_tail = self._read_stderr_tail()
            if code not in (0, None) and err_tail:
                self._last_error = f"{self._script_name} exited (code {code}). {err_tail}"
            elif code not in (0, None):
                self._last_error = f"{self._script_name} exited (code {code})."
            self._proc = None
            running = False
        return {
            "running": running,
            "latest_event": {"type": "running" if running else "idle", "script": self._script_name},
            "event_seq": 0,
            "last_error": self._last_error,
        }

    def wait_for_event(self, last_seq: int, timeout_s: float = 1.0) -> dict[str, Any]:
        del last_seq, timeout_s
        return self.status()
