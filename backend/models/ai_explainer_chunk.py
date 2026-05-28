from sqlalchemy import BigInteger, Column, DateTime, Float, Integer, String, Text, func

from backend.db.base import Base


class AiExplainerChunk(Base):
    __tablename__ = "ai_explainer_chunks"

    id = Column(BigInteger, primary_key=True, index=True)
    admin_id = Column(BigInteger, nullable=False, index=True)
    camera_id = Column(String(120), nullable=False, index=True)
    chunk_id = Column(String(120), nullable=False, unique=True, index=True)
    zone = Column(String(80), nullable=False, default="unknown")
    start_ts = Column(Float, nullable=False, default=0.0)
    end_ts = Column(Float, nullable=False, default=0.0)
    headline = Column(String(255), nullable=False)
    summary = Column(Text, nullable=False)
    details_json = Column(Text, nullable=False, default="[]")
    severity = Column(String(30), nullable=False, default="routine")
    confidence = Column(Float, nullable=False, default=0.0)
    source_video = Column(String(255), nullable=True)
    run_id = Column(String(80), nullable=True, index=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), index=True)
