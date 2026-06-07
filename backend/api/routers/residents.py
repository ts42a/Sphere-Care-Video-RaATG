from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from backend.api.deps import get_db
from backend.api.routers.auth import _get_current_user
from backend import models, schemas
from backend.utils.id_generator import generate_unique_id

router = APIRouter(tags=["Residents"])


def _organization_id_for_residents(db: Session, current_user) -> int:
    """Facility organization for listing residents (admins + approved staff)."""
    if isinstance(current_user, models.Admin):
        return int(current_user.organization_id)

    role = getattr(current_user, "global_role", None)
    if role == "staff":
        row = (
            db.query(models.Staff)
            .filter(
                models.Staff.user_id == current_user.id,
                models.Staff.is_deleted == False,  # noqa: E712
            )
            .first()
        )
        if not row:
            raise HTTPException(status_code=403, detail={"msg": "Staff profile not found"})
        if row.approval_status != "approved":
            raise HTTPException(
                status_code=403,
                detail={"msg": "Your account is pending admin approval"},
            )
        adm = db.query(models.Admin).filter(models.Admin.id == row.admin_id).first()
        if not adm:
            raise HTTPException(status_code=403, detail={"msg": "Staff is not linked to a facility"})
        return int(adm.organization_id)

    raise HTTPException(status_code=403, detail={"msg": "Unauthorized"})


def _resident_owner_admin_id(db: Session, current_user) -> int:
    """``admins.id`` to store on new ``Resident.admin_id``."""
    if isinstance(current_user, models.Admin):
        return int(current_user.id)

    role = getattr(current_user, "global_role", None)
    if role == "staff":
        row = (
            db.query(models.Staff)
            .filter(
                models.Staff.user_id == current_user.id,
                models.Staff.is_deleted == False,  # noqa: E712
            )
            .first()
        )
        if not row or row.approval_status != "approved":
            raise HTTPException(status_code=403, detail={"msg": "Unauthorized"})
        return int(row.admin_id)

    raise HTTPException(status_code=403, detail={"msg": "Unauthorized"})


def _residents_in_org_query(db: Session, current_user):
    org_id = _organization_id_for_residents(db, current_user)
    return (
        db.query(models.Resident)
        .join(models.Admin, models.Resident.admin_id == models.Admin.id)
        .filter(
            models.Admin.organization_id == org_id,
            models.Resident.is_deleted == False,  # noqa: E712
        )
    )


def _resident_response(resident: models.Resident) -> schemas.ResidentResponse:
    return schemas.ResidentResponse.model_validate(resident)


@router.get("/", response_model=list[schemas.ResidentResponse])
def get_residents(
    current_user=Depends(_get_current_user),
    db: Session = Depends(get_db),
):
    try:
        residents = _residents_in_org_query(db, current_user).all()
        return [_resident_response(r) for r in residents]
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail={"msg": "Failed to fetch residents", "error": str(exc)})


@router.get("/{resident_id}", response_model=schemas.ResidentResponse)
def get_resident(
    resident_id: int,
    current_user=Depends(_get_current_user),
    db: Session = Depends(get_db),
):
    try:
        resident = (
            _residents_in_org_query(db, current_user)
            .filter(models.Resident.id == resident_id)
            .first()
        )
        if not resident:
            raise HTTPException(status_code=404, detail="Resident not found")
        return _resident_response(resident)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail={"msg": "Failed to fetch resident", "error": str(exc)})


@router.post("/", response_model=schemas.ResidentResponse)
def create_resident(
    resident: schemas.ResidentCreate,
    current_user=Depends(_get_current_user),
    db: Session = Depends(get_db),
):
    admin_id = _resident_owner_admin_id(db, current_user)

    try:
        code = generate_unique_id(db, models.Resident, "unique_code")
        new_resident = models.Resident(
            unique_code=code,
            full_name=resident.full_name,
            age=resident.age,
            room=resident.room or "Unassigned",
            status=resident.status,
            ai_summary=resident.ai_summary,
            admin_id=admin_id,
            preferred_name=resident.preferred_name,
            date_of_birth=resident.date_of_birth,
            gender=resident.gender,
            bed_no=resident.bed_no,
            care_level=resident.care_level,
            primary_diagnosis=resident.primary_diagnosis,
            mobility_status=resident.mobility_status,
            consent_status=resident.consent_status,
            guardian_required=resident.guardian_required,
            notes=resident.notes,
            admission_date=resident.admission_date,
        )
        db.add(new_resident)
        db.commit()
        db.refresh(new_resident)
        return _resident_response(new_resident)
    except HTTPException:
        raise
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail={"msg": "Failed to create resident", "error": str(exc)})


@router.put("/{resident_id}", response_model=schemas.ResidentResponse)
def update_resident(
    resident_id: int,
    payload: schemas.ResidentUpdate,
    current_user=Depends(_get_current_user),
    db: Session = Depends(get_db),
):
    try:
        resident = (
            _residents_in_org_query(db, current_user)
            .filter(models.Resident.id == resident_id)
            .first()
        )
        if not resident:
            raise HTTPException(status_code=404, detail="Resident not found")

        for field, value in payload.model_dump(exclude_unset=True).items():
            setattr(resident, field, value)

        db.commit()
        db.refresh(resident)
        return _resident_response(resident)
    except HTTPException:
        raise
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail={"msg": "Failed to update resident", "error": str(exc)})


@router.delete("/{resident_id}")
def delete_resident(
    resident_id: int,
    current_user=Depends(_get_current_user),
    db: Session = Depends(get_db),
):
    try:
        resident = (
            _residents_in_org_query(db, current_user)
            .filter(models.Resident.id == resident_id)
            .first()
        )
        if not resident:
            raise HTTPException(status_code=404, detail="Resident not found")

        db.delete(resident)
        db.commit()
        return {"detail": "Resident deleted"}
    except HTTPException:
        raise
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail={"msg": "Failed to delete resident", "error": str(exc)})


@router.post("/bulk/add", response_model=list[schemas.ResidentResponse])
def create_residents_bulk(
    residents: list[schemas.ResidentCreate],
    current_user=Depends(_get_current_user),
    db: Session = Depends(get_db),
):
    admin_id = _resident_owner_admin_id(db, current_user)

    try:
        created_residents = []
        for resident in residents:
            code = generate_unique_id(db, models.Resident, "unique_code")
            new_resident = models.Resident(
                unique_code=code,
                full_name=resident.full_name,
                age=resident.age,
                room=resident.room or "Unassigned",
                status=resident.status,
                ai_summary=resident.ai_summary,
                admin_id=admin_id,
                preferred_name=resident.preferred_name,
                date_of_birth=resident.date_of_birth,
                gender=resident.gender,
                bed_no=resident.bed_no,
                care_level=resident.care_level,
                primary_diagnosis=resident.primary_diagnosis,
                mobility_status=resident.mobility_status,
                consent_status=resident.consent_status,
                guardian_required=resident.guardian_required,
                notes=resident.notes,
                admission_date=resident.admission_date,
            )
            db.add(new_resident)
            db.flush()
            created_residents.append(new_resident)

        db.commit()
        for resident in created_residents:
            db.refresh(resident)
        return [_resident_response(r) for r in created_residents]
    except HTTPException:
        raise
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail={"msg": "Failed to create residents", "error": str(exc)})


# ── AI Summary ────────────────────────────────────────────────────────────────

@router.post("/{resident_id}/ai-summary")
async def generate_resident_ai_summary(
    resident_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(_get_current_user),
):
    """Generate and persist an AI summary for a resident using their recent records and alerts."""
    import asyncio
    from backend.services.ai.llm_client import summarize_resident_context

    org_id = _organization_id_for_residents(db, current_user)
    resident = (
        db.query(models.Resident)
        .filter(
            models.Resident.id == resident_id,
            models.Resident.admin_id == org_id,
            models.Resident.is_deleted == False,  # noqa: E712
        )
        .first()
    )
    if not resident:
        raise HTTPException(status_code=404, detail={"msg": "Resident not found"})

    # Gather context
    recent_records = (
        db.query(models.Record)
        .filter(models.Record.resident_id == resident_id, models.Record.is_deleted == False)  # noqa: E712
        .order_by(models.Record.created_at.desc())
        .limit(10)
        .all()
    )
    recent_alerts = (
        db.query(models.Alert)
        .filter(models.Alert.resident_id == resident_id)
        .order_by(models.Alert.created_at.desc())
        .limit(10)
        .all()
    )

    profile = {
        "status": resident.status,
        "care_level": resident.care_level,
        "primary_diagnosis": resident.primary_diagnosis,
        "mobility_status": resident.mobility_status,
        "age": resident.age,
        "room": resident.room,
    }
    records_data = [
        {"category": r.category, "notes": r.notes, "date": str(r.created_at)[:10]}
        for r in recent_records
    ]
    alerts_data = [
        {"type": getattr(a, "alert_type", ""), "message": getattr(a, "message", ""), "date": str(a.created_at)[:10]}
        for a in recent_alerts
    ]

    summary = await asyncio.get_event_loop().run_in_executor(
        None,
        summarize_resident_context,
        resident.full_name,
        profile,
        records_data,
        alerts_data,
    )

    if not summary:
        raise HTTPException(status_code=503, detail={"msg": "AI provider not configured or unavailable"})

    resident.ai_summary = summary
    db.commit()

    return {"resident_id": resident_id, "ai_summary": summary}
