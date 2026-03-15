"""
app.py — Sphere Care entry point

Run the server:
    python app.py

Then open in browser:
    http://localhost:8000
    http://localhost:8000/docs   (API documentation)
"""

import uvicorn
import webbrowser
import threading
import time

def open_browser():
    """Wait for server to start, then open browser automatically."""
    time.sleep(1.5)
    webbrowser.open("http://localhost:8000/docs")

if __name__ == "__main__":
    print("\n" + "="*50)
    print("  Sphere Care — AI-Powered Aged Care Platform")
    print("="*50)
    print("  Server starting at http://localhost:8000")
    print("  API docs at       http://localhost:8000/docs")
    print("  Press Ctrl+C to stop")
    print("="*50 + "\n")

    # Open browser automatically after server starts
    threading.Thread(target=open_browser, daemon=True).start()

    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        reload_dirs=["app"],
    )
