from sqlalchemy import BigInteger, Column, Date, DateTime, ForeignKey, String, Text, Time, func

from backend.db.base import Base


class CareTask(Base):
    __tablename__ = "care_tasks"

    id = Column(BigInteger, primary_key=True, index=True)
    admin_id = Column(BigInteger, nullable=False, index=True)
    resident_id = Column(BigInteger, ForeignKey("residents.id", ondelete="CASCADE"), nullable=False, index=True)
    assigned_staff_id = Column(BigInteger, ForeignKey("staff.id", ondelete="SET NULL"), nullable=True, index=True)
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    task_type = Column(String(100), nullable=False)  # medication, meal_support, hygiene_support, wellness_check, mobility_assist, doctor_followup
    priority = Column(String(30), nullable=False, default="medium")
    due_date = Column(Date, nullable=True, index=True)
    due_time = Column(Time, nullable=True)
    status = Column(String(50), nullable=False, default="pending")
    completed_at = Column(DateTime(timezone=True), nullable=True)
    completed_by = Column(BigInteger, nullable=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())
