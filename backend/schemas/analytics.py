from pydantic import BaseModel
from typing import List, Optional


class MonthlyActivityPoint(BaseModel):
    month: str
    count: int


class TaskTypeSlice(BaseModel):
    task_type: str
    count: int
    percentage: float


class DepartmentPerformance(BaseModel):
    department: str
    score: int


class AnalyticsReport(BaseModel):
    period: Optional[str] = None
    monthly_activity: List[MonthlyActivityPoint]
    task_distribution: List[TaskTypeSlice]
    department_performance: List[DepartmentPerformance]