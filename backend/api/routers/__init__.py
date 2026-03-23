from fastapi import APIRouter

from . import health
from . import auth
from . import oauth
from . import password_reset
from . import residents
from . import bookings
from . import staff
from . import alerts
from . import dashboard
from . import analytics
from . import notifications
from . import messages
from . import records
from . import cameras
from . import flags
from . import uploads
from . import call
from . import account
from . import admin_console

api_router = APIRouter()

api_router.include_router(health.router)
api_router.include_router(auth.router)
api_router.include_router(oauth.router, prefix="/oauth", tags=["OAuth"])
api_router.include_router(password_reset.router, prefix="/password", tags=["Password Reset"])
api_router.include_router(residents.router, prefix="/residents", tags=["Residents"])
api_router.include_router(bookings.router, prefix="/bookings", tags=["Bookings"])
api_router.include_router(staff.router, prefix="/staff", tags=["Staff"])
api_router.include_router(alerts.router, prefix="/alerts", tags=["Alerts"])
api_router.include_router(dashboard.router, prefix="/dashboard", tags=["Dashboard"])
api_router.include_router(analytics.router, prefix="/analytics", tags=["Analytics"])
api_router.include_router(notifications.router, prefix="/notifications", tags=["Notifications"])
api_router.include_router(messages.router, prefix="/messages", tags=["Messages"])
api_router.include_router(records.router, prefix="/records", tags=["Records"])
api_router.include_router(cameras.router, prefix="/cameras", tags=["Cameras"])
api_router.include_router(flags.router, prefix="/flags", tags=["Flags"])
api_router.include_router(uploads.router, prefix="/uploads", tags=["Uploads"])
api_router.include_router(call.router, prefix="/call", tags=["Call"])
api_router.include_router(account.router, prefix="/account", tags=["Account"])
api_router.include_router(admin_console.router, prefix="/api/v1/admin", tags=["Admin Console"])