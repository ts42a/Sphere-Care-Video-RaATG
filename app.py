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


def find_npm_command() -> str | None:
    """Returns npm path or None if not found (no longer raises)."""
    candidates = [
        shutil.which("npm.cmd"),
        shutil.which("npm"),
        str(Path("C:/Program Files/nodejs/npm.cmd")),
        str(Path.home() / "AppData/Local/Programs/nodejs/npm.cmd"),
    ]
    for candidate in candidates:
        if candidate and Path(candidate).exists():
            return candidate
    return None


def expo_is_available(npm_command: str) -> bool:
    """Check if expo is installed in the frontend_client node_modules."""
    expo_bin = FRONTEND_CLIENT_DIR / "node_modules" / ".bin" / "expo"
    expo_bin_cmd = FRONTEND_CLIENT_DIR / "node_modules" / ".bin" / "expo.cmd"
    return expo_bin.exists() or expo_bin_cmd.exists()


def start_frontend_client(npm_command: str) -> subprocess.Popen:
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
    backend_url  = f"http://localhost:{BACKEND_PORT}"
    frontend_url = f"http://localhost:{FRONTEND_PORT}"

    npm_command   = find_npm_command()
    run_frontend  = (
        npm_command is not None
        and FRONTEND_CLIENT_DIR.exists()
        and expo_is_available(npm_command)
    )

    print("\n" + "=" * 58)
    print("  Sphere Care — AI-Powered Aged Care Platform")
    print("=" * 58)
    print(f"  Staff App  :  {backend_url}")
    print(f"  API Docs   :  {backend_url}/docs")
    if run_frontend:
        print(f"  Client App :  {frontend_url}")
    else:
        print(f"  Client App :  ⚠  skipped (Expo not ready)")
        print(f"               Run 'npm install' inside frontend_client/")
        print(f"               then restart app.py to enable it.")
    print("  Press Ctrl+C to stop")
    print("=" * 58 + "\n")

    # Always start the backend
    backend_process = start_backend_process()
    atexit.register(terminate_process, backend_process)

    # Only start frontend if expo is available
    frontend_process = None
    if run_frontend:
        frontend_process = start_frontend_client(npm_command)
        atexit.register(terminate_process, frontend_process)
        threading.Thread(
            target=open_browser_when_ready,
            args=(frontend_url, FRONTEND_PORT, 1.0),
            daemon=True,
        ).start()

    # Always open the staff web app in browser
    threading.Thread(
        target=open_browser_when_ready,
        args=(backend_url, BACKEND_PORT, 2.0),
        daemon=True,
    ).start()

    try:
        backend_process.wait()
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
