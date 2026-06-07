from __future__ import annotations

from datetime import date, datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from backend import models, schemas
from backend.api.deps import get_db, get_current_auth_context
from backend.ws.ws_manager import ws_manager

router = APIRouter(prefix="/tasks", tags=["Care Tasks"])

ALLOWED_TASK_TYPES = {
    "activity",
    "medication",
    "exercise",
    "meal",
    "wellness_check",
    "mobility",
    "doctor_followup",
    "social",
    "hydration",
    "hygiene_support",
    "meal_support",
    "mobility_assist",
}
ALLOWED_PRIORITIES = {"low", "medium", "high", "urgent"}
ALLOWED_STATUSES = {"pending", "in_progress", "completed", "cancelled", "skipped"}


def _normalize_task_type(value: Optional[str]) -> str:
    raw = (value or "activity").strip().lower().replace(" ", "_").replace("-", "_")
    aliases = {
        "follow_up": "doctor_followup",
        "doctor": "doctor_followup",
        "walk": "exercise",
        "meal_prep": "meal",
    }
    normalized = aliases.get(raw, raw)
    return normalized if normalized in ALLOWED_TASK_TYPES else "activity"


def _normalize_priority(value: Optional[str]) -> str:
    raw = (value or "medium").strip().lower()
    return raw if raw in ALLOWED_PRIORITIES else "medium"


def _normalize_status(value: Optional[str]) -> str:
    raw = (value or "pending").strip().lower().replace(" ", "_").replace("-", "_")
    return raw if raw in ALLOWED_STATUSES else "pending"


def _serialize_task(task: models.CareTask, db: Session) -> schemas.CareTaskResponse:
    resident_name = None
    staff_name = None

    resident = db.query(models.Resident).filter(models.Resident.id == task.resident_id).first()
    if resident:
        resident_name = resident.full_name

    if task.assigned_staff_id:
        staff = db.query(models.Staff).filter(models.Staff.id == task.assigned_staff_id).first()
        if staff:
            staff_name = staff.full_name

    return schemas.CareTaskResponse(
        id=int(task.id),
        admin_id=int(task.admin_id),
        resident_id=int(task.resident_id),
        assigned_staff_id=int(task.assigned_staff_id) if task.assigned_staff_id else None,
        title=task.title,
        description=task.description,
        task_type=task.task_type,
        priority=task.priority,
        due_date=task.due_date,
        due_time=task.due_time,
        status=task.status,
        completed_at=task.completed_at,
        completed_by=task.completed_by,
        notes=task.notes,
        created_at=task.created_at,
        updated_at=task.updated_at,
        resident_name=resident_name,
        assigned_staff_name=staff_name,
    )


def _require_admin_scope(auth: dict) -> int:
    admin_id = auth.get("admin_id")
    if not admin_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Missing admin scope")
    return int(admin_id)


def _resolve_resident(db: Session, *, admin_id: int, resident_id: int) -> models.Resident:
    resident = db.query(models.Resident).filter(
        models.Resident.id == int(resident_id),
        models.Resident.admin_id == int(admin_id),
        models.Resident.is_deleted == False,
    ).first()
    if not resident:
        raise HTTPException(status_code=404, detail="Resident not found")
    return resident


async def _broadcast_task_event(event_type: str, task: models.CareTask, db: Session, resident: Optional[models.Resident] = None) -> None:
    resident = resident or db.query(models.Resident).filter(models.Resident.id == task.resident_id).first()
    payload = {
        "type": event_type,
        "task": _serialize_task(task, db).model_dump(mode="json"),
    }

    deliveries: dict[str, dict] = {f"admin:{int(task.admin_id)}": payload}
    if resident and resident.client_user_id:
        deliveries[f"user:{int(resident.client_user_id)}"] = payload
    if task.assigned_staff_id:
        staff = db.query(models.Staff).filter(models.Staff.id == task.assigned_staff_id).first()
        if staff and staff.user_id:
            deliveries[f"user:{int(staff.user_id)}"] = payload

    await ws_manager.broadcast_many(deliveries)


@router.get("/", response_model=list[schemas.CareTaskResponse])
def list_tasks(
    status_filter: Optional[str] = Query(default=None, alias="status"),
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    resident_id: Optional[int] = None,
    auth=Depends(get_current_auth_context),
    db: Session = Depends(get_db),
):
    admin_id = _require_admin_scope(auth)
    role = (auth.get("role") or "").lower()

    query = db.query(models.CareTask).filter(models.CareTask.admin_id == admin_id)

    if role == "client":
        token_resident_id = auth.get("resident_id")
        if not token_resident_id:
            raise HTTPException(status_code=403, detail="Missing resident context")
        query = query.filter(models.CareTask.resident_id == int(token_resident_id))
    elif resident_id is not None:
        _resolve_resident(db, admin_id=admin_id, resident_id=resident_id)
        query = query.filter(models.CareTask.resident_id == int(resident_id))

    if status_filter:
        query = query.filter(models.CareTask.status == _normalize_status(status_filter))
    if date_from:
        query = query.filter(models.CareTask.due_date >= date_from)
    if date_to:
        query = query.filter(models.CareTask.due_date <= date_to)

    rows = query.order_by(
        models.CareTask.due_date.asc().nullslast(),
        models.CareTask.due_time.asc().nullslast(),
        models.CareTask.created_at.desc(),
    ).all()
    return [_serialize_task(row, db) for row in rows]


@router.post("/", response_model=schemas.CareTaskResponse, status_code=201)
async def create_task(
    payload: schemas.CareTaskCreate,
    auth=Depends(get_current_auth_context),
    db: Session = Depends(get_db),
):
    role = (auth.get("role") or "").lower()
    if role not in {"admin", "staff", "doctor", "external_doctor"}:
        raise HTTPException(status_code=403, detail="Only staff or doctors can create care tasks")

    admin_id = _require_admin_scope(auth)
    resident = _resolve_resident(db, admin_id=admin_id, resident_id=payload.resident_id)

    task = models.CareTask(
        admin_id=admin_id,
        resident_id=resident.id,
        assigned_staff_id=payload.assigned_staff_id,
        title=payload.title.strip(),
        description=payload.description.strip() if payload.description else None,
        task_type=_normalize_task_type(payload.task_type),
        priority=_normalize_priority(payload.priority),
        due_date=payload.due_date,
        due_time=payload.due_time,
        status="pending",
    )
    db.add(task)
    db.commit()
    db.refresh(task)

    await _broadcast_task_event("task.created", task, db, resident)
    return _serialize_task(task, db)


@router.patch("/{task_id}", response_model=schemas.CareTaskResponse)
async def update_task(
    task_id: int,
    payload: schemas.CareTaskUpdate,
    auth=Depends(get_current_auth_context),
    db: Session = Depends(get_db),
):
    role = (auth.get("role") or "").lower()
    if role not in {"admin", "staff", "doctor", "external_doctor"}:
        raise HTTPException(status_code=403, detail="Only staff or doctors can update care tasks")

    admin_id = _require_admin_scope(auth)
    task = db.query(models.CareTask).filter(models.CareTask.id == task_id, models.CareTask.admin_id == admin_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    data = payload.model_dump(exclude_unset=True)
    if "title" in data and data["title"] is not None:
        task.title = data["title"].strip()
    if "description" in data:
        task.description = data["description"].strip() if data["description"] else None
    if "task_type" in data and data["task_type"] is not None:
        task.task_type = _normalize_task_type(data["task_type"])
    if "priority" in data and data["priority"] is not None:
        task.priority = _normalize_priority(data["priority"])
    if "due_date" in data:
        task.due_date = data["due_date"]
    if "due_time" in data:
        task.due_time = data["due_time"]
    if "assigned_staff_id" in data:
        task.assigned_staff_id = data["assigned_staff_id"]
    if "notes" in data:
        task.notes = data["notes"].strip() if data["notes"] else None
    if "status" in data and data["status"] is not None:
        task.status = _normalize_status(data["status"])
        if task.status == "completed" and not task.completed_at:
            task.completed_at = datetime.utcnow()
            task.completed_by = auth.get("user_id")
        elif task.status != "completed":
            task.completed_at = None
            task.completed_by = None

    db.commit()
    db.refresh(task)
    await _broadcast_task_event("task.updated", task, db)
    return _serialize_task(task, db)


@router.patch("/{task_id}/status", response_model=schemas.CareTaskResponse)
async def update_task_status(
    task_id: int,
    payload: schemas.CareTaskStatusUpdate,
    auth=Depends(get_current_auth_context),
    db: Session = Depends(get_db),
):
    admin_id = _require_admin_scope(auth)
    role = (auth.get("role") or "").lower()
    token_resident_id = auth.get("resident_id")

    query = db.query(models.CareTask).filter(models.CareTask.id == task_id, models.CareTask.admin_id == admin_id)
    if role == "client":
        if not token_resident_id:
            raise HTTPException(status_code=403, detail="Missing resident context")
        query = query.filter(models.CareTask.resident_id == int(token_resident_id))

    task = query.first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    task.status = _normalize_status(payload.status)
    if payload.notes is not None:
        task.notes = payload.notes.strip() or None
    if task.status == "completed":
        task.completed_at = datetime.utcnow()
        task.completed_by = auth.get("user_id")
    else:
        task.completed_at = None
        task.completed_by = None

    db.commit()
    db.refresh(task)
    await _broadcast_task_event("task.updated", task, db)
    return _serialize_task(task, db)


@router.delete("/{task_id}", status_code=204)
async def delete_task(
    task_id: int,
    auth=Depends(get_current_auth_context),
    db: Session = Depends(get_db),
):
    role = (auth.get("role") or "").lower()
    if role not in {"admin", "staff", "doctor", "external_doctor"}:
        raise HTTPException(status_code=403, detail="Only staff or doctors can delete care tasks")

    admin_id = _require_admin_scope(auth)
    task = db.query(models.CareTask).filter(models.CareTask.id == task_id, models.CareTask.admin_id == admin_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    payload = {"type": "task.deleted", "task_id": int(task.id), "resident_id": int(task.resident_id)}
    resident = db.query(models.Resident).filter(models.Resident.id == task.resident_id).first()
    deliveries = {f"admin:{admin_id}": payload}
    if resident and resident.client_user_id:
        deliveries[f"user:{int(resident.client_user_id)}"] = payload

    db.delete(task)
    db.commit()
    await ws_manager.broadcast_many(deliveries)
