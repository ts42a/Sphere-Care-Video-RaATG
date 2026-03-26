from sqlalchemy import BigInteger, Boolean, Column, DateTime, String, Text, func

from backend.db.base import Base


class Alert(Base):
    __tablename__ = "alerts"

    id = Column(BigInteger, primary_key=True, index=True)
    admin_id = Column(BigInteger, nullable=False, index=True)
    level = Column(String(30), nullable=False)
    title = Column(String(255), nullable=False)
    message = Column(Text, nullable=False)
    source = Column(String(50), nullable=False)
    related_entity_type = Column(String(80), nullable=True)
    related_entity_id = Column(BigInteger, nullable=True)
    is_read = Column(Boolean, nullable=False, default=False)
    read_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())
