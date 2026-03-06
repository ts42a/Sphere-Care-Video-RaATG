from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import ALLOWED_ORIGINS
from app.api.routers import all_routers
from app.db.session import engine
from app.db.base import Base
import app.models

app = FastAPI(title="Sphere Care API")

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

Base.metadata.create_all(bind=engine)

for router in all_routers:
    app.include_router(router, prefix="/api")
