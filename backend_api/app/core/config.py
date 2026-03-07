import os
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://postgres:123@localhost:5432/spherecare"
)

ALLOWED_ORIGINS = os.getenv(
    "ALLOWED_ORIGINS",
    "*"
)

SECRET_KEY = os.getenv("SECRET_KEY", "spherecare-secret-key")
JWT_ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "60"))


