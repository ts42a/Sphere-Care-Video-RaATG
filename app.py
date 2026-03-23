import threading
import time
import webbrowser

import uvicorn


def open_browser():
    """Open frontend after server starts."""
    time.sleep(1.5)
    webbrowser.open("http://localhost:8000/")


if __name__ == "__main__":
    print("\n" + "=" * 50)
    print("  Sphere Care — AI-Powered Aged Care Platform")
    print("=" * 50)
    print("  Frontend: http://localhost:8000/")
    print("  Docs:     http://localhost:8000/docs")
    print("  Press Ctrl+C to stop")
    print("=" * 50 + "\n")

    threading.Thread(target=open_browser, daemon=True).start()

    uvicorn.run(
        "backend.main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        reload_dirs=["backend", "frontend_staff"],
    )