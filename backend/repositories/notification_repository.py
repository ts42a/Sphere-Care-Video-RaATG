from backend.models.notification import Notification


class NotificationRepository:
    def __init__(self, db):
        self.db = db

    def create(self, notif: Notification):
        self.db.add(notif)
        self.db.commit()
        self.db.refresh(notif)
        return notif

    def get_all(self):
        return self.db.query(Notification).all()