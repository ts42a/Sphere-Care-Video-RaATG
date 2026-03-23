from backend.models.booking import Booking


class BookingRepository:
    def __init__(self, db):
        self.db = db

    def create(self, booking: Booking):
        self.db.add(booking)
        self.db.commit()
        self.db.refresh(booking)
        return booking

    def get_all(self):
        return self.db.query(Booking).all()