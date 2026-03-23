from backend.models.flag import Flag


class FlagRepository:
    def __init__(self, db):
        self.db = db

    def create(self, flag: Flag):
        self.db.add(flag)
        self.db.commit()
        self.db.refresh(flag)
        return flag

    def get_all(self):
        return self.db.query(Flag).order_by(Flag.created_at.desc()).all()

    def update_status(self, flag_id: int, status: str):
        flag = self.db.query(Flag).filter(Flag.id == flag_id).first()
        if flag:
            flag.status = status
            self.db.commit()
        return flag