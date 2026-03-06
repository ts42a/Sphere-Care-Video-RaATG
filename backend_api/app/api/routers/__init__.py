from app.api.routers.health import router as health_router
from app.api.routers.residents import router as residents_router
from app.api.routers.bookings import router as bookings_router

all_routers = [
    health_router,
    residents_router,
    bookings_router,
]
