"""
cameras.py — Recording Console router

    GET  /cameras/                      List all cameras (Live View tab)
    GET  /cameras/stats                 Stat cards (total / online / alerts / events)
    GET  /cameras/{id}                  Single camera (fullscreen modal)
    POST /cameras/                      Add camera (Camera Settings)
    PATCH /cameras/{id}/status          Update status / alert level (AI pipeline)

    GET  /cameras/alerts/               AI Alerts tab
    POST /cameras/alerts/               Create alert (AI detection trigger)
    PATCH /cameras/alerts/{id}/resolve  Resolve alert (Resolve button)
"""
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import Optional
from datetime import datetime

from app.api.deps import get_db
from app import models, schemas

router = APIRouter(prefix="/cameras", tags=["Recording Console"])

# HELPERS
def _fmt_camera(c: models.Camera) -> schemas.CameraResponse:
    return schemas.CameraResponse(
        id=c.id,
        title=c.title,
        resident_name=c.resident_name,
        floor=c.floor,
        status=c.status,
        alert=c.alert,
        description=c.description,
        stream_url=c.stream_url,
        created_at=c.created_at.strftime("%Y-%m-%d %H:%M"),
    )


def _fmt_alert(a: models.CameraAlert) -> schemas.CameraAlertResponse:
    return schemas.CameraAlertResponse(
        id=a.id,
        camera_id=a.camera_id,
        camera_title=a.camera.title if a.camera else None,
        alert_type=a.alert_type,
        icon=a.icon,
        title=a.title,
        description=a.description,
        resolved=a.resolved,
        created_at=a.created_at.strftime("%Y-%m-%d %H:%M"),
    )

# CAMERAS
@router.get("/stats", response_model=schemas.CameraStats)
def get_camera_stats(db: Session = Depends(get_db)):
    """Stat cards: total / online / active alerts / events today."""
    total  = db.query(func.count(models.Camera.id)).scalar()
    online = db.query(func.count(models.Camera.id)).filter(
                 models.Camera.status == "live").scalar()
    alerts = db.query(func.count(models.CameraAlert.id)).filter(
                 models.CameraAlert.resolved == False).scalar()
    events = db.query(func.count(models.CameraAlert.id)).filter(
                 func.date(models.CameraAlert.created_at) == datetime.utcnow().date()
             ).scalar()
    return schemas.CameraStats(
        total_cameras=total,
        online=online,
        active_alerts=alerts,
        events_24h=events,
    )


@router.get("/", response_model=list[schemas.CameraResponse])
def get_cameras(
    floor:  Optional[str] = Query(None, description="e.g. Floor 1"),
    status: Optional[str] = Query(None, description="live | offline"),
    alert:  Optional[str] = Query(None, description="critical | fine | none"),
    db: Session = Depends(get_db),
):
    """Live View tab — returns all cameras with optional filters."""
    q = db.query(models.Camera).order_by(models.Camera.id)
    if floor:  q = q.filter(models.Camera.floor  == floor)
    if status: q = q.filter(models.Camera.status == status)
    if alert:  q = q.filter(models.Camera.alert  == alert)
    return [_fmt_camera(c) for c in q.all()]


@router.get("/{camera_id}", response_model=schemas.CameraResponse)
def get_camera(camera_id: int, db: Session = Depends(get_db)):
    c = db.query(models.Camera).filter(models.Camera.id == camera_id).first()
    if not c:
        raise HTTPException(status_code=404, detail="Camera not found.")
    return _fmt_camera(c)


@router.post("/", response_model=schemas.CameraResponse, status_code=status.HTTP_201_CREATED)
def add_camera(camera_in: schemas.CameraCreate, db: Session = Depends(get_db)):
    camera = models.Camera(**camera_in.model_dump())
    db.add(camera)
    db.commit()
    db.refresh(camera)
    return _fmt_camera(camera)


@router.patch("/{camera_id}/status", response_model=schemas.CameraResponse)
def update_camera_status(
    camera_id: int,
    payload: schemas.CameraStatusUpdate,
    db: Session = Depends(get_db),
):
    c = db.query(models.Camera).filter(models.Camera.id == camera_id).first()
    if not c:
        raise HTTPException(status_code=404, detail="Camera not found.")
    if payload.status      is not None: c.status      = payload.status
    if payload.alert       is not None: c.alert       = payload.alert
    if payload.description is not None: c.description = payload.description
    db.commit()
    db.refresh(c)
    return _fmt_camera(c)

# CAMERA ALERTS
@router.get("/alerts/", response_model=list[schemas.CameraAlertResponse])
def get_alerts(
    alert_type: Optional[str]  = Query(None, description="critical | warning | info"),
    camera_id:  Optional[int]  = Query(None),
    resolved:   Optional[bool] = Query(None),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
):
    q = db.query(models.CameraAlert).order_by(models.CameraAlert.created_at.desc())
    if alert_type is not None: q = q.filter(models.CameraAlert.alert_type == alert_type)
    if camera_id  is not None: q = q.filter(models.CameraAlert.camera_id  == camera_id)
    if resolved   is not None: q = q.filter(models.CameraAlert.resolved   == resolved)
    return [_fmt_alert(a) for a in q.limit(limit).all()]


@router.post("/alerts/", response_model=schemas.CameraAlertResponse, status_code=status.HTTP_201_CREATED)
def create_alert(alert_in: schemas.CameraAlertCreate, db: Session = Depends(get_db)):
    alert = models.CameraAlert(**alert_in.model_dump())
    db.add(alert)
    if alert_in.camera_id and alert_in.alert_type == "critical":
        cam = db.query(models.Camera).filter(models.Camera.id == alert_in.camera_id).first()
        if cam:
            cam.alert = "critical"
    db.commit()
    db.refresh(alert)
    return _fmt_alert(alert)


@router.patch("/alerts/{alert_id}/resolve", response_model=schemas.CameraAlertResponse)
def resolve_alert(alert_id: int, db: Session = Depends(get_db)):
    alert = db.query(models.CameraAlert).filter(models.CameraAlert.id == alert_id).first()
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found.")
    alert.resolved = True
    db.commit()
    # reset camera to 'fine' if no more unresolved critical alerts
    if alert.camera_id:
        still_critical = db.query(func.count(models.CameraAlert.id)).filter(
            models.CameraAlert.camera_id == alert.camera_id,
            models.CameraAlert.alert_type == "critical",
            models.CameraAlert.resolved == False,
        ).scalar()
        if still_critical == 0:
            cam = db.query(models.Camera).filter(models.Camera.id == alert.camera_id).first()
            if cam:
                cam.alert = "fine"
                db.commit()
    db.refresh(alert)
    return _fmt_alert(alert)
