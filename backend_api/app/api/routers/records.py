from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from sqlalchemy import func, or_
from typing import Optional

from app.api.deps import get_db
from app import models, schemas

router = APIRouter(prefix="/records", tags=["Records Library"])


#helpers

def _fmt_record(r: models.Record) -> schemas.RecordResponse:
    return schemas.RecordResponse(
        id=r.id,
        resident_name=r.resident_name,
        category=r.category,
        record_type=r.record_type,
        file_url=r.file_url,
        thumbnail_url=r.thumbnail_url,
        duration=r.duration,
        notes=r.notes,
        recorded_at=r.recorded_at,
        recorded_time=r.recorded_time,
        created_at=r.created_at.strftime("%Y-%m-%d %H:%M"),
    )


def _fmt_insight(i: models.AiInsight) -> schemas.AiInsightResponse:
    return schemas.AiInsightResponse(
        id=i.id,
        resident_name=i.resident_name,
        title=i.title,
        body=i.body,
        priority=i.priority,
        is_new=i.is_new,
        created_at=i.created_at.strftime("%Y-%m-%d %H:%M"),
    )


#Records

@router.get("/", response_model=list[schemas.RecordResponse])
def get_records(
    search: Optional[str] = Query(None, description="Search by resident name, category, or notes"),
    category: Optional[str] = Query(None, description="e.g. Medication Administration"),
    record_type: Optional[str] = Query(None, description="video | audio | document"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    """
    Records Library grid.
    - search     → searches resident_name, category, notes
    - category   → Category filter dropdown
    - record_type → Format filter dropdown (video | audio | document)
    """
    q = db.query(models.Record).order_by(models.Record.created_at.desc())

    if search:
        term = f"%{search}%"
        q = q.filter(
            or_(
                models.Record.resident_name.ilike(term),
                models.Record.category.ilike(term),
                models.Record.notes.ilike(term),
            )
        )
    if category:
        q = q.filter(models.Record.category == category)
    if record_type:
        q = q.filter(models.Record.record_type == record_type)

    return [_fmt_record(r) for r in q.offset(offset).limit(limit).all()]


@router.get("/categories", response_model=list[str])
def get_categories(db: Session = Depends(get_db)):
    """Return distinct categories for the Category dropdown filter."""
    rows = db.query(models.Record.category).distinct().all()
    return [r[0] for r in rows]


@router.post("/", response_model=schemas.RecordResponse, status_code=status.HTTP_201_CREATED)
def upload_record(record_in: schemas.RecordCreate, db: Session = Depends(get_db)):
    """Upload / create a new record (Upload record button)."""
    record = models.Record(**record_in.model_dump())
    db.add(record)
    db.commit()
    db.refresh(record)
    return _fmt_record(record)


@router.delete("/{record_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_record(record_id: int, db: Session = Depends(get_db)):
    """Delete a record by ID."""
    r = db.query(models.Record).filter(models.Record.id == record_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Record not found.")
    db.delete(r)
    db.commit()


#AI Insights

@router.get("/ai-insights", response_model=schemas.AiInsightSummary)
def get_ai_insights(
    priority: Optional[str] = Query(None, description="high | mid | low"),
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    """
    Right-panel AI Insight feed.
    Returns priority counts (1 HIGH / 12 MID / 4 LOW) + insight list.
    """
    base_q = db.query(models.AiInsight).order_by(models.AiInsight.created_at.desc())

    high = db.query(func.count(models.AiInsight.id)).filter(models.AiInsight.priority == "high").scalar()
    mid  = db.query(func.count(models.AiInsight.id)).filter(models.AiInsight.priority == "mid").scalar()
    low  = db.query(func.count(models.AiInsight.id)).filter(models.AiInsight.priority == "low").scalar()

    if priority:
        base_q = base_q.filter(models.AiInsight.priority == priority)

    insights = [_fmt_insight(i) for i in base_q.limit(limit).all()]

    return schemas.AiInsightSummary(high=high, mid=mid, low=low, insights=insights)


@router.post("/ai-insights", response_model=schemas.AiInsightResponse, status_code=status.HTTP_201_CREATED)
def create_ai_insight(insight_in: schemas.AiInsightCreate, db: Session = Depends(get_db)):
    """Create a new AI insight entry."""
    insight = models.AiInsight(**insight_in.model_dump())
    db.add(insight)
    db.commit()
    db.refresh(insight)
    return _fmt_insight(insight)


@router.patch("/ai-insights/{insight_id}/seen", response_model=schemas.AiInsightResponse)
def mark_insight_seen(insight_id: int, db: Session = Depends(get_db)):
    """Mark an AI insight as seen (clears the NEW badge)."""
    insight = db.query(models.AiInsight).filter(models.AiInsight.id == insight_id).first()
    if not insight:
        raise HTTPException(status_code=404, detail="AI Insight not found.")
    insight.is_new = "false"
    db.commit()
    db.refresh(insight)
    return _fmt_insight(insight)@router.get("/{record_id}", response_model=schemas.RecordResponse)
def get_record(record_id: int, db: Session = Depends(get_db)):
    """Get a single record by ID (View button)."""
    r = db.query(models.Record).filter(models.Record.id == record_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Record not found.")
    return _fmt_record(r)
