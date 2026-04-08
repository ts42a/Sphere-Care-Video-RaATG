import os
from dotenv import load_dotenv

load_dotenv()


def _get_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://postgres:postgres@localhost:5432/spherecare",
)
ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "*")
SECRET_KEY = os.getenv("SECRET_KEY", "change-this-secret-key")
JWT_ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "60"))

SMTP_SERVER = os.getenv("SMTP_SERVER", "smtp.gmail.com")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_EMAIL = os.getenv("SMTP_EMAIL", "")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")

AI_PIPELINE_ENABLED = _get_bool("AI_PIPELINE_ENABLED", True)
AI_MAX_SAMPLE_FPS = float(os.getenv("AI_MAX_SAMPLE_FPS", "2.0"))
AI_MOTION_THRESHOLD = float(os.getenv("AI_MOTION_THRESHOLD", "12.0"))
AI_MIN_CONFIDENCE = float(os.getenv("AI_MIN_CONFIDENCE", "0.35"))
AI_YOLO_MODEL = os.getenv("AI_YOLO_MODEL", "yolov8n.pt")
AI_ZONES_PATH = os.getenv("AI_ZONES_PATH", "")
AI_MEDIAPIPE_HAND_MODEL = os.getenv(
    "AI_MEDIAPIPE_HAND_MODEL",
    "ai/models/mediapipe/hand_landmarker.task",
)
AI_MEDIAPIPE_HAND_MODEL_URL = os.getenv(
    "AI_MEDIAPIPE_HAND_MODEL_URL",
    "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
)

AI_LLM_PROVIDER = os.getenv("AI_LLM_PROVIDER", "disabled")
AI_OLLAMA_BASE_URL = os.getenv("AI_OLLAMA_BASE_URL", "http://localhost:11434")
AI_OLLAMA_MODEL = os.getenv("AI_OLLAMA_MODEL", "llama3.1")
AI_OPENAI_API_KEY = os.getenv("AI_OPENAI_API_KEY", "")
AI_OPENAI_BASE_URL = os.getenv("AI_OPENAI_BASE_URL", "https://api.openai.com/v1")
AI_OPENAI_MODEL = os.getenv("AI_OPENAI_MODEL", "gpt-4o-mini")
