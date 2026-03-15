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

# API routers
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

#Serve frontend
# Path from backend_api/ to the frontend folder
FRONTEND_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "frontend_staff", "src")
FRONTEND_DIR = os.path.abspath(FRONTEND_DIR)
print(f"Frontend dir: {FRONTEND_DIR}")
print(f"Exists: {os.path.exists(FRONTEND_DIR)}")

if os.path.exists(FRONTEND_DIR):
    # Serve static assets (CSS, JS, images)
    app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="static")
