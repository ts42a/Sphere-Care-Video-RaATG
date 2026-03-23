from backend.repositories.user_repository import UserRepository
from backend.core.security import get_password_hash, verify_password, create_access_token
from backend.models.user import User


class AuthService:
    def __init__(self, db):
        self.repo = UserRepository(db)

    def register(self, data):
        hashed = get_password_hash(data.password)

        user = User(
            full_name=data.full_name,
            email=data.email,
            password_hash=hashed,
            role=data.role
        )

        return self.repo.create(user)

    def login(self, email: str, password: str):
        user = self.repo.get_by_email(email)

        if not user or not verify_password(password, user.password_hash):
            return None

        token = create_access_token({"sub": user.email})
        return token, user