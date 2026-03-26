from sqlalchemy import BigInteger, Column, DateTime, String, Text, func

from backend.db.base import Base


class Attachment(Base):
    __tablename__ = "attachments"

    id = Column(BigInteger, primary_key=True, index=True)
    admin_id = Column(BigInteger, nullable=False, index=True)
    entity_type = Column(String(80), nullable=False, index=True)  # message, flag, record, booking, consent_document
    entity_id = Column(BigInteger, nullable=False, index=True)
    file_url = Column(Text, nullable=False)
    file_name = Column(String(255), nullable=True)
    mime_type = Column(String(120), nullable=True)
    file_size = Column(BigInteger, nullable=True)
    uploaded_by = Column(BigInteger, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
