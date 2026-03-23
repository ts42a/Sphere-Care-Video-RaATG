from backend.models.camera import Camera


class CameraRepository:
    def __init__(self, db):
        self.db = db

    def get_all(self):
        return self.db.query(Camera).all()

    def create(self, camera: Camera):
        self.db.add(camera)
        self.db.commit()
        self.db.refresh(camera)
        return camera