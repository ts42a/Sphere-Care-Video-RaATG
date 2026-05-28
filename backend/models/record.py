from sqlalchemy import BigInteger, Boolean, Column, DateTime, ForeignKey, Integer, String, Text, func

from backend.db.base import Base


class Record(Base):
    __tablename__ = "records"

    id = Column(BigInteger, primary_key=True, index=True)
    admin_id = Column(BigInteger, nullable=False, index=True)
    resident_id = Column(BigInteger, ForeignKey("residents.id", ondelete="SET NULL"), nullable=True, index=True)
    resident_name = Column(String(255), nullable=True)
    category = Column(String(120), nullable=False)
    record_type = Column(String(50), nullable=False)
    file_url = Column(Text, nullable=False)
    file_name = Column(String(255), nullable=True)
    mime_type = Column(String(120), nullable=True)
    file_size = Column(BigInteger, nullable=True)
    thumbnail_url = Column(Text, nullable=True)
    duration = Column(Integer, nullable=True)  # seconds
    transcript_text = Column(Text, nullable=True)
    ai_summary = Column(Text, nullable=True)
    scvam_status = Column(String(30), nullable=False, default="none")
    scvam_output_path = Column(String(512), nullable=True)
    notes = Column(Text, nullable=True)
    recorded_at = Column(DateTime(timezone=True), nullable=True)
    created_by = Column(BigInteger, nullable=True)
    is_deleted = Column(Boolean, nullable=False, default=False)
    deleted_at = Column(DateTime(timezone=True), nullable=True)
    deleted_by = Column(BigInteger, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())
