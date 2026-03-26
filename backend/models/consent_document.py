from sqlalchemy import BigInteger, Column, Date, DateTime, ForeignKey, String, Text, func

from backend.db.base import Base


class ConsentDocument(Base):
    __tablename__ = "consent_documents"

    id = Column(BigInteger, primary_key=True, index=True)
    admin_id = Column(BigInteger, nullable=False, index=True)
    resident_id = Column(BigInteger, ForeignKey("residents.id", ondelete="CASCADE"), nullable=False, index=True)
    guardian_id = Column(BigInteger, ForeignKey("resident_guardians.id", ondelete="SET NULL"), nullable=True, index=True)
    document_type = Column(String(100), nullable=False)  # medical_consent, camera_consent, data_sharing_consent, treatment_approval, guardian_authority
    file_url = Column(Text, nullable=False)
    signed_at = Column(DateTime(timezone=True), nullable=True)
    expiry_date = Column(Date, nullable=True)
    status = Column(String(50), nullable=False, default="pending")
    uploaded_by = Column(BigInteger, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())
