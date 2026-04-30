import os
from pathlib import Path
from dotenv import load_dotenv

# Always load backend/.env regardless of current working directory.
_BACKEND_ENV_PATH = Path(__file__).resolve().parents[1] / ".env"
load_dotenv(_BACKEND_ENV_PATH)

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://postgres:postgres@localhost:5432/sphere_care",
)
ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "*")
SECRET_KEY = os.getenv("SECRET_KEY", "change-this-secret-key")
JWT_ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "60"))

SMTP_SERVER = os.getenv("SMTP_SERVER", "smtp.gmail.com")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_EMAIL = os.getenv("SMTP_EMAIL", "")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")

# ASL Gesture Recognition
AI_MEDIAPIPE_HAND_MODEL = os.getenv(
    "AI_MEDIAPIPE_HAND_MODEL",
    "ai/models/mediapipe/hand_landmarker.task",
)
AI_MEDIAPIPE_HAND_MODEL_URL = os.getenv(
    "AI_MEDIAPIPE_HAND_MODEL_URL",
    "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
)
AI_ASL_MODEL          = os.getenv("AI_ASL_MODEL",          "ai/models/asl/asl_classifier.tflite")
AI_ASL_LABELS         = os.getenv("AI_ASL_LABELS",         "ai/models/asl/labels.txt")
AI_ASL_MIN_CONFIDENCE = float(os.getenv("AI_ASL_MIN_CONFIDENCE", "0.60"))
