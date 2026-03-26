"""
Generate unique 8-digit numeric IDs for all entity types.

Format examples:
  Admin  (center):  CTR-83749261
  Client (account): ACC-47291038
  Staff:            STF-19384756
  Resident:         RES-62940185

The numeric part is always an 8-digit random number (10000000–99999999).
"""

import random

from sqlalchemy.orm import Session


def generate_unique_id(db: Session, model, column: str, *, max_attempts: int = 50) -> str:
    """Return a unique 8-digit numeric string not already in *column* of *model*."""
    col = getattr(model, column)
    for _ in range(max_attempts):
        candidate = str(random.randint(10_000_000, 99_999_999))
        if db.query(model).filter(col == candidate).first() is None:
            return candidate
    raise RuntimeError(f"Could not generate a unique ID for {model.__tablename__}.{column}")
