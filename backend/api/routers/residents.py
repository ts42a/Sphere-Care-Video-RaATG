
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from backend.api.deps import get_db
from backend import models, schemas

router = APIRouter(prefix="/residents", tags=["Residents"])


@router.get("/", response_model=list[schemas.ResidentResponse])
def get_residents(db: Session = Depends(get_db)):
    return db.query(models.Resident).all()


@router.get("/{resident_id}", response_model=schemas.ResidentResponse)
def get_resident(resident_id: int, db: Session = Depends(get_db)):
    resident = db.query(models.Resident).filter(models.Resident.id == resident_id).first()
    if not resident:
        raise HTTPException(status_code=404, detail="Resident not found")
    return resident


@router.post("/", response_model=schemas.ResidentResponse)
def create_resident(resident: schemas.ResidentCreate, db: Session = Depends(get_db)):
    new_resident = models.Resident(**resident.model_dump())
    db.add(new_resident)
    db.commit()
    db.refresh(new_resident)
    return new_resident


@router.post("/bulk/add", response_model=list[schemas.ResidentResponse])
def create_residents_bulk(residents: list[schemas.ResidentCreate], db: Session = Depends(get_db)):
    """Add multiple residents at once"""
    new_residents = []
    for resident_data in residents:
        new_resident = models.Resident(**resident_data.model_dump())
        db.add(new_resident)
        new_residents.append(new_resident)
    
    db.commit()
    for resident in new_residents:
        db.refresh(resident)
    
    return new_residents
