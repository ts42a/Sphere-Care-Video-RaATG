from backend.repositories.camera_repository import CameraRepository
from backend.models.camera import Camera


class CameraService:
    def __init__(self, db):
        self.repo = CameraRepository(db)

    def get_all(self):
        return self.repo.get_all()

    def create(self, data):
        camera = Camera(**data.dict())
        return self.repo.create(camera)
