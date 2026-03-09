from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

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
    cameras
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
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

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

@app.get("/health")
def health():
    return {"status": "ok", "service": "Sphere Care"}
