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

