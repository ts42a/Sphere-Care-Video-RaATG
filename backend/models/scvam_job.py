from sqlalchemy import BigInteger, Column, DateTime, ForeignKey, Integer, String, Text, func

from backend.db.base import Base


class ScvamJob(Base):
    __tablename__ = "scvam_jobs"

    id = Column(BigInteger, primary_key=True, index=True)
    organization_id = Column(BigInteger, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    admin_id = Column(BigInteger, ForeignKey("admins.id", ondelete="CASCADE"), nullable=False, index=True)
    vault_record_id = Column(String(120), nullable=False, index=True)
    db_record_id = Column(BigInteger, ForeignKey("records.id", ondelete="CASCADE"), nullable=False, index=True)
    enc_relative_path = Column(String(512), nullable=False)
    segment_index = Column(Integer, nullable=False, default=1)
    status = Column(String(30), nullable=False, default="pending", index=True)
    staging_path = Column(String(512), nullable=True)
    work_path = Column(String(512), nullable=True)
    error_message = Column(Text, nullable=True)
    attempts = Column(Integer, nullable=False, default=0)
    max_attempts = Column(Integer, nullable=False, default=3)
    duration_sec = Column(Integer, nullable=True)
    camera_id = Column(String(120), nullable=True)
    resident_name = Column(String(255), nullable=True)
    room = Column(String(120), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    started_at = Column(DateTime(timezone=True), nullable=True)
    finished_at = Column(DateTime(timezone=True), nullable=True)
