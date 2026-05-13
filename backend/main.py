import time
from pathlib import Path
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from backend.api.routers import api_router
from backend.api.routers.call import router as calls_router, expire_timed_out_calls
from backend.api.routers.ws import router as ws_router  # ── NEW ──
from backend.db.base import Base
from backend.db.session import engine
from backend.db.runtime_migrations import run_runtime_migrations
from backend import models  # noqa: F401


import logging as _logging
_startup_logger = _logging.getLogger("sphere_care.startup")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Create all tables from ORM metadata (no-op if they already exist)
    Base.metadata.create_all(bind=engine)
    run_runtime_migrations(engine)

    # LiveKit startup check (Rollout Step 1)
    from backend.core.config import LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET
    if LIVEKIT_URL and LIVEKIT_API_KEY and LIVEKIT_API_SECRET:
        _startup_logger.info("[livekit] configured — url=%s key=%s...", LIVEKIT_URL, LIVEKIT_API_KEY[:8])
    else:
        _startup_logger.warning("[livekit] NOT configured — LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET missing; calls will work without media")

    # Seed test data when DB is fresh (no-op if data already exists)
    from backend.db.seed import seed_database
    seed_database()

    # Start message outbox processor (fan-out queue)
    import asyncio
    from backend.outbox.outbox_processor import run_outbox_processor
    outbox_task = asyncio.create_task(run_outbox_processor(interval=0.5))

    # Start call timeout worker (checks every 5s)
    async def _call_timeout_loop():
        while True:
            try:
                from backend.db.session import SessionLocal
                db = SessionLocal()
                try:
                    await expire_timed_out_calls(db)
                finally:
                    db.close()
            except Exception:
                pass
            await asyncio.sleep(5)
    call_timeout_task = asyncio.create_task(_call_timeout_loop())

    yield

    # Shutdown outbox processor
    outbox_task.cancel()
    call_timeout_task.cancel()
    try:
        await outbox_task
        await call_timeout_task
    except asyncio.CancelledError:
        pass


app = FastAPI(
    title="Sphere Care API",
    description="AI-Powered Aged Care Platform",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.middleware("http")
async def add_response_time_header(request: Request, call_next):
    start = time.perf_counter()
    response = await call_next(request)
    duration_ms = (time.perf_counter() - start) * 1000
    response.headers["X-Response-Time-Ms"] = f"{duration_ms:.1f}"
    return response

BASE_DIR = Path(__file__).resolve().parent.parent
FRONTEND_DIR = BASE_DIR / "frontend_staff" / "src"
PAGES_DIR = FRONTEND_DIR / "pages"
STYLE_DIR = FRONTEND_DIR / "style"
COMPONENTS_DIR = FRONTEND_DIR / "components"

if PAGES_DIR.exists():
    app.mount("/pages", StaticFiles(directory=PAGES_DIR), name="pages")

if STYLE_DIR.exists():
    app.mount("/style", StaticFiles(directory=STYLE_DIR), name="style")

if COMPONENTS_DIR.exists():
    app.mount("/components", StaticFiles(directory=COMPONENTS_DIR), name="components")

if FRONTEND_DIR.exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIR / "assets"), name="assets")
    app.mount("/public", StaticFiles(directory=FRONTEND_DIR), name="public")

@app.get("/", include_in_schema=False)
def serve_index():
    return FileResponse(FRONTEND_DIR / "index.html")

@app.get("/api", tags=["Health"])
def api_root():
    return {
        "message": "Sphere Care backend running",
        "docs": "/docs",
        "version": "1.0.0",
    }

@app.get("/health", tags=["Health"])
def health():
    return {"status": "ok"}

app.include_router(api_router, prefix="/api/v1")
app.include_router(calls_router, prefix="/api/v1")
app.include_router(ws_router)
