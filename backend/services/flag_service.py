from backend.repositories.flag_repository import FlagRepository
from backend.models.flag import Flag


class FlagService:
    def __init__(self, db):
        self.repo = FlagRepository(db)

    def create_flag(self, data):
        flag = Flag(**data.dict())
        return self.repo.create(flag)

    def get_flags(self):
        return self.repo.get_all()

    def update_status(self, flag_id, status):
        return self.repo.update_status(flag_id, status)