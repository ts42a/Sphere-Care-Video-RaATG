from app.api.routers.health import router as health_router
from app.api.routers.residents import router as residents_router
from app.api.routers.bookings import router as bookings_router

all_routers = [
    health_router,
    residents_router,
    bookings_router,
]
from app.api.routers.health import router as health_router
from app.api.routers.auth import router as auth_router
from app.api.routers.residents import router as residents_router
from app.api.routers.bookings import router as bookings_router
from app.api.routers.staff import router as staff_router
from app.api.routers.alerts import router as alerts_router
from app.api.routers.dashboard import router as dashboard_router
from app.api.routers.analytics import router as analytics_router
from app.api.routers.notifications import router as notifications_router
from app.api.routers.messages import router as messages_router

all_routers = [
    health_router,
    auth_router,
    residents_router,
    bookings_router,
    staff_router,
    alerts_router,
    dashboard_router,
    analytics_router,
    notifications_router,
    messages_router,
]
