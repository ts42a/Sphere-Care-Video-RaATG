"""
models/flag_review.py — Flag Review model

Each row = one staff review action on a flag.
A flag can have multiple reviews (e.g. confirm → escalate → resolve).

review_action values:
  confirm       — staff confirms the AI flag is genuine
  false_alarm   — staff marks as false positive, flag → resolved
  escalate      — staff escalates to senior/admin
  resolve       — staff marks as fully resolved
  reopen        — staff reopens a resolved flag
"""

from sqlalchemy import BigInteger, Column, DateTime, ForeignKey, Numeric, String, Text, func
from sqlalchemy.orm import relationship

from backend.db.base import Base


class FlagReview(Base):
    __tablename__ = "flag_reviews"

    id               = Column(BigInteger, primary_key=True, index=True)
    flag_id          = Column(BigInteger, ForeignKey("flags.id", ondelete="CASCADE"), nullable=False, index=True)
    admin_id         = Column(BigInteger, nullable=False, index=True)
    reviewer_user_id = Column(BigInteger, nullable=True, index=True)
    reviewer_name    = Column(String(255), nullable=False)
    reviewer_role    = Column(String(80),  nullable=True)
    review_action    = Column(String(30),  nullable=False)   # confirm | false_alarm | escalate | resolve | reopen
    previous_status  = Column(String(50),  nullable=True)    # status before this review
    new_status       = Column(String(50),  nullable=True)    # status after this review
    notes            = Column(Text,        nullable=True)     # optional reviewer notes
    ai_confidence    = Column(Numeric(5,2),nullable=True)    # snapshot of confidence at review time
    reviewed_at      = Column(DateTime(timezone=True), nullable=False, server_default=func.now())

    flag = relationship("Flag", back_populates="reviews")