# backend/repositories/notification_repository.py
# Modified — calls notification_service after Alert / AiInsight is created

from backend.models.notification import Notification
from backend.models.alert import Alert
from backend.models.ai_insight import AiInsight
from backend.services import notification_service


class NotificationRepository:
    def __init__(self, db):
        self.db = db

    async def create(self, notif: Notification):
        self.db.add(notif)
        self.db.commit()
        self.db.refresh(notif)
        return notif

    def get_all(self):
        return self.db.query(Notification).all()


class AlertRepository:
    def __init__(self, db):
        self.db = db

    async def create(self, alert: Alert):
        self.db.add(alert)
        self.db.commit()
        self.db.refresh(alert)
        # ── NEW: push real-time Priority Alert to frontend ──
        await notification_service.notify_alert(alert)
        return alert

    def get_all(self):
        return self.db.query(Alert).all()

    def get_unread(self, admin_id: int):
        return self.db.query(Alert).filter(
            Alert.admin_id == admin_id,
            Alert.is_read == False
        ).all()


class AiInsightRepository:
    def __init__(self, db):
        self.db = db

    async def create(self, insight: AiInsight):
        self.db.add(insight)
        self.db.commit()
        self.db.refresh(insight)
        # ── NEW: push real-time AI alert to frontend ──
        await notification_service.notify_ai_insight(insight)
        return insight

    def get_all(self, admin_id: int):
        return self.db.query(AiInsight).filter(
            AiInsight.admin_id == admin_id
        ).order_by(AiInsight.created_at.desc()).all()