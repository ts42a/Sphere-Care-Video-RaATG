import os
from pathlib import Path
from dotenv import load_dotenv

# Always load backend/.env regardless of current working directory.
_BACKEND_ENV_PATH = Path(__file__).resolve().parents[1] / ".env"
load_dotenv(_BACKEND_ENV_PATH)

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://postgres:chingyu1015@localhost:5432/sphere_care",
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
AI_ZONES_PATH = os.getenv("AI_ZONES_PATH", "")
AI_PIPELINE_ENABLED = os.getenv("AI_PIPELINE_ENABLED", "true").lower() in {"1", "true", "yes", "on"}
AI_MAX_SAMPLE_FPS = float(os.getenv("AI_MAX_SAMPLE_FPS", "2.0"))
AI_MOTION_THRESHOLD = float(os.getenv("AI_MOTION_THRESHOLD", "0.12"))
AI_MIN_CONFIDENCE = float(os.getenv("AI_MIN_CONFIDENCE", "0.45"))
AI_YOLO_MODEL = os.getenv("AI_YOLO_MODEL", "ai/models/yolo/yolov8n.pt")
AI_ASL_MODEL          = os.getenv("AI_ASL_MODEL",          "ai/models/asl/asl_classifier.tflite")
AI_ASL_LABELS         = os.getenv("AI_ASL_LABELS",         "ai/models/asl/labels.txt")
AI_ASL_MIN_CONFIDENCE = float(os.getenv("AI_ASL_MIN_CONFIDENCE", "0.60"))

# SCVAM2.1 vault recording analysis
_REPO_ROOT = Path(__file__).resolve().parents[2]
SCVAM_ENABLED = os.getenv("SCVAM_ENABLED", "true").lower() in {"1", "true", "yes", "on"}
SCVAM_PACKAGE_DIR = Path(os.getenv("SCVAM_PACKAGE_DIR", str(_REPO_ROOT / "ai" / "training" / "SCVAM2.1")))
VAULT_STORAGE_ROOT = Path(os.getenv("VAULT_STORAGE_ROOT", "databases"))
SCVAM_STAGING_TTL_HOURS = int(os.getenv("SCVAM_STAGING_TTL_HOURS", "24"))
SCVAM_MIN_DURATION_SEC = int(os.getenv("SCVAM_MIN_DURATION_SEC", "1"))
SCVAM_MAX_ATTEMPTS = int(os.getenv("SCVAM_MAX_ATTEMPTS", "3"))
SCVAM_WORKER_POLL_SEC = int(os.getenv("SCVAM_WORKER_POLL_SEC", "5"))
SCVAM_WORKER_AUTOSTART = os.getenv("SCVAM_WORKER_AUTOSTART", "false").lower() in {
    "1",
    "true",
    "yes",
    "on",
}
