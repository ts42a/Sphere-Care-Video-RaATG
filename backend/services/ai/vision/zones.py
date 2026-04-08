from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List

from backend.core import config as app_config

from backend.services.ai.vision.event_schema import BoundingBox, Detection


def _zones_file() -> Path:
    raw = (app_config.AI_ZONES_PATH or "").strip()
    if raw:
        return Path(raw)
    # backend/services/ai/vision/zones.py -> repo root is parents[4]
    root = Path(__file__).resolve().parents[4]
    return root / "ai" / "zones.json"


def load_zone_defs() -> Dict[str, Any]:
    path = _zones_file()
    if not path.is_file():
        return {"cameras": {}}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"cameras": {}}


def point_in_rect(nx: float, ny: float, rect: List[float]) -> bool:
    if len(rect) != 4:
        return False
    x, y, w, h = rect
    return x <= nx <= x + w and y <= ny <= y + h


def bbox_center(b: BoundingBox) -> tuple[float, float]:
    return b.x + b.w / 2, b.y + b.h / 2


def zones_for_bbox(camera_id: int, det: Detection, data: Dict[str, Any] | None = None) -> List[str]:
    data = data or load_zone_defs()
    key = str(camera_id)
    cam = (data.get("cameras") or {}).get(key) or {}
    zones = cam.get("zones") or {}
    cx, cy = bbox_center(det.bbox)
    hits: List[str] = []
    for name, rect in zones.items():
        if isinstance(rect, list) and point_in_rect(cx, cy, [float(v) for v in rect]):
            hits.append(str(name))
    return hits
