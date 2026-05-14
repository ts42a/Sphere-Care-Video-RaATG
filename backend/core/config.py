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

# LiveKit
LIVEKIT_URL = os.getenv("LIVEKIT_URL", "")
LIVEKIT_API_KEY = os.getenv("LIVEKIT_API_KEY", "")
LIVEKIT_API_SECRET = os.getenv("LIVEKIT_API_SECRET", "")
LIVEKIT_TOKEN_TTL_MINUTES = int(os.getenv("LIVEKIT_TOKEN_TTL_MINUTES", "15"))

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

# AI pipeline flags (used by recorder and pipeline)
AI_PIPELINE_ENABLED = os.getenv("AI_PIPELINE_ENABLED", "true").lower() == "true"
AI_USE_LLM          = os.getenv("AI_USE_LLM", "true").lower() == "true"
AI_MAX_SAMPLE_FPS   = float(os.getenv("AI_MAX_SAMPLE_FPS", "2.0"))
AI_MOTION_THRESHOLD = float(os.getenv("AI_MOTION_THRESHOLD", "5.0"))
AI_MIN_CONFIDENCE   = float(os.getenv("AI_MIN_CONFIDENCE", "0.4"))
AI_YOLO_MODEL       = os.getenv("AI_YOLO_MODEL", "yolov8n.pt")
AI_ZONES_PATH       = os.getenv("AI_ZONES_PATH", "")
RTSP_MAX_FPS        = float(os.getenv("RTSP_MAX_FPS", "5.0"))
RTSP_FRAME_WIDTH    = int(os.getenv("RTSP_FRAME_WIDTH", "640"))

# Recorder — clip segmentation settings
RECORDING_CLIP_SECONDS = float(os.getenv("RECORDING_CLIP_SECONDS", "30"))
RECORDING_CLIP_FPS     = float(os.getenv("RECORDING_CLIP_FPS", "10"))
RECORDING_CLIP_WIDTH   = int(os.getenv("RECORDING_CLIP_WIDTH", "640"))
RECORDING_CLIP_HEIGHT  = int(os.getenv("RECORDING_CLIP_HEIGHT", "480"))

# Analysis queue — max pending clips before new submissions are rejected
ANALYSIS_QUEUE_MAX_SIZE = int(os.getenv("ANALYSIS_QUEUE_MAX_SIZE", "64"))
