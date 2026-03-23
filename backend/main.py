from pathlib import Path
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from backend.api.routers import api_router
from backend.db.base import Base
from backend.db.session import engine
from backend import models  # noqa: F401


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    yield


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