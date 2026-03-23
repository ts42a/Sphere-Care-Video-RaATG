from backend.models.resident import Resident


class ResidentRepository:
    def __init__(self, db):
        self.db = db

    def get_all(self):
        return self.db.query(Resident).all()

    def create(self, resident: Resident):
        self.db.add(resident)
        self.db.commit()
        self.db.refresh(resident)
        return resident