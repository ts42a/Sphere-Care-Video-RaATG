from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import os

from app.core.config import ALLOWED_ORIGINS
from app.db.base import Base
from app.db.session import engine
import app.models

from app.api.routers import (
    auth,
    residents,
    bookings,
    staff,
    alerts,
    dashboard,
    analytics,
    notifications,
    messages,
    records,
    cameras,
    Oauth,
    password_reset,
    flags,
    uploads,
    call
)

app = FastAPI(title="Sphere Care API")

Base.metadata.create_all(bind=engine)

origins = (
    [origin.strip() for origin in ALLOWED_ORIGINS.split(",")]
    if ALLOWED_ORIGINS != "*"
    else ["*"]
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── API routers ────────────────────────────────────────────
app.include_router(auth.router)
app.include_router(residents.router)
app.include_router(bookings.router)
app.include_router(staff.router)
app.include_router(alerts.router)
app.include_router(dashboard.router)
app.include_router(analytics.router)
app.include_router(notifications.router)
app.include_router(messages.router)
app.include_router(records.router)
app.include_router(cameras.router)
app.include_router(Oauth.router)
app.include_router(password_reset.router)
app.include_router(flags.router)
app.include_router(uploads.router)
app.include_router(call.router)

@app.get("/health")
def health():
    return {"status": "ok", "service": "Sphere Care"}

# ── Serve frontend ─────────────────────────────────────────
FRONTEND_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "frontend_staff", "src")
FRONTEND_DIR = os.path.abspath(FRONTEND_DIR)
print(f"Frontend dir: {FRONTEND_DIR}")
print(f"Exists: {os.path.exists(FRONTEND_DIR)}")

if os.path.exists(FRONTEND_DIR):
    pages_dir      = os.path.join(FRONTEND_DIR, "pages")
    style_dir      = os.path.join(FRONTEND_DIR, "style")
    assets_dir     = os.path.join(FRONTEND_DIR, "assets")
    components_dir = os.path.join(FRONTEND_DIR, "components")

    if os.path.exists(pages_dir):
        app.mount("/pages", StaticFiles(directory=pages_dir, html=True), name="pages")
    if os.path.exists(style_dir):
        app.mount("/style", StaticFiles(directory=style_dir), name="style")
    if os.path.exists(assets_dir):
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")
    if os.path.exists(components_dir):
        app.mount("/components", StaticFiles(directory=components_dir), name="components")

    # Root redirect → login page
    @app.get("/")
    def root():
        return FileResponse(os.path.join(pages_dir, "register-login.html"))
