from pydantic import BaseModel
from typing import List
from datetime import datetime

from backend.schemas.alert import AlertResponse


class DashboardStats(BaseModel):
    active_staff: int
    pending_tasks: int
    shifts_today: int
    recent_alerts: List[AlertResponse]