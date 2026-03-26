import atexit
import os
import shutil
import socket
import subprocess
import sys
import threading
import time
import webbrowser
from pathlib import Path
import uvicorn


BACKEND_HOST = "0.0.0.0"
BACKEND_PORT = 8000
FRONTEND_PORT = 3000
PROJECT_ROOT = Path(__file__).resolve().parent
FRONTEND_CLIENT_DIR = PROJECT_ROOT / "frontend_client"
BACKEND_ONLY_ENV = "SPHERE_CARE_RUN_BACKEND_ONLY"


def wait_for_port(host: str, port: int, timeout: float = 60.0) -> bool:
    deadline = time.time() + timeout

    while time.time() < deadline:
        try:
            with socket.create_connection((host, port), timeout=1):
                return True
        except OSError:
            time.sleep(0.5)

    return False


def open_browser_when_ready(url: str, port: int, delay: float = 0.0) -> None:
    if delay > 0:
        time.sleep(delay)

    if wait_for_port("127.0.0.1", port):
        webbrowser.open(url)


def terminate_process(process: subprocess.Popen | None) -> None:
    if process is None or process.poll() is not None:
        return

    process.terminate()

    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=5)


def find_npm_command() -> str:
    candidates = [
        shutil.which("npm.cmd"),
        shutil.which("npm"),
        str(Path("C:/Program Files/nodejs/npm.cmd")),
        str(Path.home() / "AppData/Local/Programs/nodejs/npm.cmd"),
    ]

    for candidate in candidates:
        if candidate and Path(candidate).exists():
            return candidate

    raise RuntimeError(
        "Node.js/npm was not found. Install Node.js and ensure npm is available in PATH, "
        "then run app.py again."
    )


def start_frontend_client() -> subprocess.Popen:
    npm_command = find_npm_command()
    node_bin_dir = str(Path(npm_command).resolve().parent)

    frontend_env = os.environ.copy()
    frontend_env["BROWSER"] = "none"
    frontend_env["PATH"] = node_bin_dir + os.pathsep + frontend_env.get("PATH", "")

    creationflags = subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0

    return subprocess.Popen(
        [npm_command, "run", "web", "--", "--port", str(FRONTEND_PORT)],
        cwd=FRONTEND_CLIENT_DIR,
        env=frontend_env,
        creationflags=creationflags,
    )


def start_backend_process() -> subprocess.Popen:
    backend_env = os.environ.copy()
    backend_env[BACKEND_ONLY_ENV] = "1"

    creationflags = subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0

    return subprocess.Popen(
        [sys.executable, str(PROJECT_ROOT / "app.py")],
        cwd=PROJECT_ROOT,
        env=backend_env,
        creationflags=creationflags,
    )


def run_backend_server() -> None:
    uvicorn.run(
        "backend.main:app",
        host=BACKEND_HOST,
        port=BACKEND_PORT,
        reload=True,
        reload_dirs=["backend", "frontend_client", "frontend_staff"],
    )


def run_launcher() -> None:
    if not FRONTEND_CLIENT_DIR.exists():
        raise FileNotFoundError(f"Frontend client folder not found: {FRONTEND_CLIENT_DIR}")

    frontend_url = f"http://localhost:{FRONTEND_PORT}"
    backend_url = f"http://localhost:{BACKEND_PORT}"

    print("\n" + "=" * 58)
    print("  Sphere Care — AI-Powered Aged Care Platform")
    print("=" * 58)
    print(f"  Staff App:        {backend_url}")
    print(f"  API Docs:         {backend_url}/docs")
    print(f"  Client App:       {frontend_url}")
    print("  Press Ctrl+C to stop both processes")
    print("=" * 58 + "\n")

    frontend_process = start_frontend_client()
    backend_process = start_backend_process()

    atexit.register(terminate_process, frontend_process)
    atexit.register(terminate_process, backend_process)

    threading.Thread(
        target=open_browser_when_ready,
        args=(frontend_url, FRONTEND_PORT, 1.0),
        daemon=True,
    ).start()

    try:
        backend_exit_code = backend_process.wait()
        if backend_exit_code not in (0, None):
            raise SystemExit(backend_exit_code)
    except KeyboardInterrupt:
        pass
    finally:
        terminate_process(frontend_process)
        terminate_process(backend_process)


if __name__ == "__main__":
    if os.environ.get(BACKEND_ONLY_ENV) == "1":
        run_backend_server()
    else:
        run_launcher()