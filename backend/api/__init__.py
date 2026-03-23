from .routers import auth
from .routers import residents
from .routers import bookings
from .routers import staff
from .routers import alerts
from .routers import dashboard
from .routers import analytics
from .routers import notifications
from .routers import messages
from .routers import records
from .routers import cameras
from .routers import flags
from .routers import uploads
from .routers import call
from .routers import health
from .routers import account

all_routers = [
    health.router,
    auth.router,
    residents.router,
    bookings.router,
    staff.router,
    dashboard.router,
    notifications.router,
    messages.router,
    records.router,
    cameras.router,
    flags.router,
    uploads.router,
    call.router,
    account.router,
]

try:
    all_routers.append(alerts.router)
except Exception:
    pass

try:
    all_routers.append(analytics.router)
except Exception:
    pass