from sqlalchemy import BigInteger, Boolean, Column, DateTime, ForeignKey, String, Text, func

from backend.db.base import Base


class AiInsight(Base):
    __tablename__ = "ai_insights"

    id = Column(BigInteger, primary_key=True, index=True)
    admin_id = Column(BigInteger, nullable=False, index=True)
    resident_id = Column(BigInteger, ForeignKey("residents.id", ondelete="SET NULL"), nullable=True, index=True)
    resident_name = Column(String(255), nullable=True)
    related_record_id = Column(BigInteger, ForeignKey("records.id", ondelete="SET NULL"), nullable=True)
    related_flag_id = Column(BigInteger, ForeignKey("flags.id", ondelete="SET NULL"), nullable=True)
    title = Column(String(255), nullable=False)
    body = Column(Text, nullable=False)
    category = Column(String(100), nullable=False)
    priority = Column(String(30), nullable=False, default="medium")
    is_new = Column(Boolean, nullable=False, default=True)
    generated_by_model = Column(String(120), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())
