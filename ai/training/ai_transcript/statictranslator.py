import argparse
import json
import os
import re
import sys
import time
from collections import Counter, deque
from pathlib import Path

import cv2
import joblib
import numpy as np

try:
    import mediapipe as mp
    from mediapipe.tasks import python as mp_tasks
    from mediapipe.tasks.python import vision
except ImportError:
    raise SystemExit("Run: py -m pip install mediapipe opencv-python numpy joblib")


ROOT = Path(__file__).resolve().parent
ARTIFACTS_DIR = ROOT / "artifacts" / "gesture"
MODEL_DIR = ROOT / "models"
MODEL_PATH = ARTIFACTS_DIR / "static_model.joblib"
LABELS_PATH = ARTIFACTS_DIR / "static_labels.json"
MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/hand_landmarker/"
    "hand_landmarker/float16/1/hand_landmarker.task"
)

DEFAULT_CONFIDENCE_THRESHOLD = 0.55
DEFAULT_HISTORY_SIZE = 8
DEFAULT_APPEND_COOLDOWN = 1.0
DEFAULT_STABLE_MIN_VOTES = 6
HAND_CONNECTIONS_FALLBACK = [
    (0, 1), (1, 2), (2, 3), (3, 4),
    (0, 5), (5, 6), (6, 7), (7, 8),
    (5, 9), (9, 10), (10, 11), (11, 12),
    (9, 13), (13, 14), (14, 15), (15, 16),
    (13, 17), (17, 18), (18, 19), (19, 20),
    (0, 17),
]


def _emit(payload: dict) -> None:
    print(json.dumps(payload), flush=True)


class TextRefiner:
    """
    Refines raw character stream from static fingerspelling output into
    readable sentence text. Uses rule-based normalization and optional SRM.
    """

    _STREAM_LEXICON = {
        "hi",
        "hello",
        "hey",
        "how",
        "are",
        "r",
        "you",
        "your",
        "i",
        "im",
        "am",
        "fine",
        "ok",
        "okay",
        "yes",
        "no",
        "cant",
        "cannot",
        "can",
        "not",
        "talk",
        "class",
        "now",
        "later",
        "please",
        "pls",
        "call",
        "text",
        "msg",
        "message",
        "help",
        "water",
        "need",
        "me",
        "we",
        "they",
        "he",
        "she",
        "is",
        "was",
        "will",
        "come",
        "join",
        "outside",
        "home",
        "busy",
        "driving",
        "minute",
    }
    _REPLACE_MAP = {
        "u": "you",
        "ur": "your",
        "r": "are",
        "im": "i am",
        "cant": "cannot",
        "pls": "please",
        "msg": "message",
    }

    def __init__(self) -> None:
        self._project_root = Path(__file__).resolve().parents[2]
        self._srm_model = None
        self._srm_vocab = None
        self._srm_device = None
        self._srm_failed = False
        self._srm_ckpt_path = self._resolve_checkpoint_path()
        self._srm_vocab_path = self._resolve_vocab_path()

    def _resolve_checkpoint_path(self) -> Path:
        env = os.getenv("ASL_SRM_CHECKPOINT", "").strip()
        if env:
            return Path(env)
        return self._project_root / "ai" / "models" / "SRM" / "checkpoints" / "best.pt"

    def _resolve_vocab_path(self) -> Path:
        env = os.getenv("ASL_SRM_VOCAB", "").strip()
        if env:
            return Path(env)
        preferred = self._project_root / "ai" / "models" / "SRM" / "data" / "srm_hybrid_v2plus_vocab.json"
        if preferred.exists():
            return preferred
        return self._project_root / "ai" / "models" / "SRM" / "data" / "srm_final_v1_vocab.json"

    def _ensure_srm(self) -> bool:
        if self._srm_failed:
            return False
        if self._srm_model is not None:
            return True
        if not self._srm_ckpt_path.exists() or not self._srm_vocab_path.exists():
            self._srm_failed = True
            return False
        try:
            import torch

            srm_src = self._project_root / "ai" / "models" / "SRM" / "src"
            if str(srm_src) not in sys.path:
                sys.path.append(str(srm_src))
            from dataset import Vocab  # type: ignore
            from model import GRUSeq2Seq, Seq2SeqConfig  # type: ignore

            vocab = Vocab.from_json(self._srm_vocab_path)
            cfg = Seq2SeqConfig(
                vocab_size=len(vocab.itos),
                pad_idx=vocab.pad_idx,
                sos_idx=vocab.sos_idx,
                eos_idx=vocab.eos_idx,
                embed_dim=128,
                hidden_dim=256,
                num_layers=1,
                dropout=0.1,
            )
            device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
            model = GRUSeq2Seq(cfg).to(device)
            ckpt = torch.load(self._srm_ckpt_path, map_location=device)
            model.load_state_dict(ckpt["model_state_dict"])
            model.eval()

            self._srm_model = model
            self._srm_vocab = vocab
            self._srm_device = device
            return True
        except Exception:
            self._srm_failed = True
            return False

    @staticmethod
    def _collapse_repeats(text: str, max_repeat: int = 1) -> str:
        if not text:
            return text
        out = []
        prev = ""
        count = 0
        for ch in text:
            if ch == prev:
                count += 1
            else:
                prev = ch
                count = 1
            if count <= max_repeat:
                out.append(ch)
        return "".join(out)

    def _segment_compact_stream(self, compact: str) -> str:
        compact = compact.strip()
        if not compact:
            return ""
        n = len(compact)
        best: list[tuple[int, list[str]] | None] = [None] * (n + 1)
        best[0] = (0, [])
        max_len = max(len(w) for w in self._STREAM_LEXICON)
        for i in range(n):
            if best[i] is None:
                continue
            score, words = best[i]
            upper = min(n, i + max_len)
            for j in range(i + 1, upper + 1):
                part = compact[i:j]
                lex_token = part if part in self._STREAM_LEXICON else self._collapse_repeats(part, max_repeat=1)
                if lex_token not in self._STREAM_LEXICON:
                    continue
                cand_score = score + len(part) * 3 - 1
                cand_words = words + [lex_token]
                if best[j] is None or cand_score > best[j][0]:
                    best[j] = (cand_score, cand_words)
        if best[n] is not None and best[n][1]:
            return " ".join(best[n][1])
        return compact

    def _normalize_tokens(self, text: str) -> str:
        txt = re.sub(r"[^a-zA-Z0-9\s]", " ", text.lower())
        txt = re.sub(r"\s+", " ", txt).strip()
        if not txt:
            return ""
        has_space = " " in txt
        if has_space:
            raw_tokens = [self._collapse_repeats(tok, max_repeat=2) for tok in txt.split()]
        else:
            compact = self._collapse_repeats(txt, max_repeat=2)
            segmented = self._segment_compact_stream(compact)
            raw_tokens = segmented.split()

        normalized: list[str] = []
        for tok in raw_tokens:
            rep = self._REPLACE_MAP.get(tok, tok)
            normalized.extend(rep.split())
        return " ".join(normalized).strip()

    @staticmethod
    def _final_format(text: str) -> str:
        text = re.sub(r"\s+", " ", text).strip()
        if not text:
            return ""
        text = text[0].upper() + text[1:]
        if text[-1] not in ".?!":
            if text.lower().startswith(("hi ", "hello ", "hey ", "how ", "are ", "is ", "can ", "will ")):
                text += "?"
            else:
                text += "."
        text = re.sub(r"^(Hi|Hello|Hey)\s+(how\s+are\s+you\??)$", r"\1, \2", text, flags=re.IGNORECASE)
        return text

    def _run_srm(self, text: str) -> str:
        if not self._ensure_srm():
            return text
        try:
            import torch

            src_ids = self._srm_vocab.encode(text.strip().lower()) + [self._srm_vocab.eos_idx]
            src = torch.tensor([src_ids], dtype=torch.long, device=self._srm_device)
            pred_ids = self._srm_model.greedy_decode(src, max_len=30)[0].tolist()
            words = []
            for tok in pred_ids:
                if tok == self._srm_vocab.eos_idx:
                    break
                if tok in (self._srm_vocab.sos_idx, self._srm_vocab.pad_idx):
                    continue
                words.append(self._srm_vocab.itos[tok] if tok < len(self._srm_vocab.itos) else "<unk>")
            out = " ".join(words).strip()
            return out or text
        except Exception:
            return text

    def refine(self, raw_text: str) -> str:
        normalized = self._normalize_tokens(raw_text)
        if not normalized:
            return ""
        srm_out = self._run_srm(normalized)
        return self._final_format(srm_out)


def get_hand_model_path() -> str:
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    path = MODEL_DIR / "hand_landmarker.task"
    if not path.exists():
        urllib = __import__("urllib.request", fromlist=["urlretrieve"])
        urllib.urlretrieve(MODEL_URL, str(path))
    return str(path)


def create_detector(num_hands: int = 1):
    model_path = get_hand_model_path()
    base_options = mp_tasks.BaseOptions(model_asset_path=model_path)
    options = vision.HandLandmarkerOptions(
        base_options=base_options,
        num_hands=num_hands,
        min_hand_detection_confidence=0.6,
        min_tracking_confidence=0.6,
    )
    return vision.HandLandmarker.create_from_options(options)


def extract_hand_features(hand_landmarks) -> np.ndarray:
    pts = np.array([[lm.x, lm.y, lm.z] for lm in hand_landmarks], dtype=np.float32)
    pts -= pts[0:1, :]
    d = np.linalg.norm(pts[:, :2], axis=1)
    s = float(np.max(d)) if np.max(d) > 1e-6 else 1.0
    pts /= s
    return pts.reshape(-1).astype(np.float32)


def majority_vote(items):
    if not items:
        return None
    return Counter(items).most_common(1)[0][0]


def draw_hand_landmarks(frame, hand_landmarks_list) -> None:
    if not hand_landmarks_list:
        return
    hand_connections = HAND_CONNECTIONS_FALLBACK
    try:
        if hasattr(mp, "solutions") and hasattr(mp.solutions, "hands"):
            hand_connections = list(mp.solutions.hands.HAND_CONNECTIONS)
    except Exception:
        hand_connections = HAND_CONNECTIONS_FALLBACK
    h, w = frame.shape[:2]
    color = (0, 220, 0)
    hand_landmarks = hand_landmarks_list[0]
    for a, b in hand_connections:
        ax = int(hand_landmarks[a].x * w)
        ay = int(hand_landmarks[a].y * h)
        bx = int(hand_landmarks[b].x * w)
        by = int(hand_landmarks[b].y * h)
        cv2.line(frame, (ax, ay), (bx, by), color, 2, cv2.LINE_AA)
    for lm in hand_landmarks:
        x = int(lm.x * w)
        y = int(lm.y * h)
        cv2.circle(frame, (x, y), 3, color, -1, cv2.LINE_AA)
    # Pointer style same as dataset_builder target marker.
    tip = hand_landmarks[8]
    px = int(tip.x * w)
    py = int(tip.y * h)
    cv2.circle(frame, (px, py), 5, (255, 255, 255), -1, cv2.LINE_AA)
    cv2.circle(frame, (px, py), 7, (20, 20, 20), 1, cv2.LINE_AA)


def draw_text(img, lines, x=10, y=30, gap=30):
    for i, line in enumerate(lines):
        cv2.putText(
            img,
            line,
            (x, y + i * gap),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.7,
            (255, 255, 255),
            2,
            cv2.LINE_AA,
        )


def draw_hud(frame, prediction: str, confidence: float, text_buffer: str, threshold: float) -> None:
    h, w = frame.shape[:2]
    box_h = 118
    overlay = frame.copy()
    cv2.rectangle(overlay, (10, h - box_h - 10), (w - 10, h - 10), (10, 20, 35), -1)
    cv2.addWeighted(overlay, 0.52, frame, 0.48, 0, frame)
    lines = [
        f"Prediction: {prediction}",
        f"Confidence: {confidence:.2f} (threshold {threshold:.2f})",
        f"Text: {text_buffer if text_buffer else '(empty)'}",
        "Close from web panel button",
    ]
    draw_text(frame, lines, x=22, y=h - box_h + 16, gap=25)


def main():
    parser = argparse.ArgumentParser(description="Static translator (Python camera).")
    parser.add_argument("--camera-index", type=int, default=0)
    parser.add_argument("--threshold", type=float, default=DEFAULT_CONFIDENCE_THRESHOLD)
    parser.add_argument("--history-size", type=int, default=DEFAULT_HISTORY_SIZE)
    parser.add_argument("--append-cooldown", type=float, default=DEFAULT_APPEND_COOLDOWN)
    parser.add_argument("--stable-min-votes", type=int, default=DEFAULT_STABLE_MIN_VOTES)
    parser.add_argument("--no-gui", action="store_true")
    parser.add_argument("--enable-refine", action="store_true")
    args = parser.parse_args()

    if args.stable_min_votes > args.history_size:
        args.stable_min_votes = args.history_size

    if not MODEL_PATH.exists():
        raise FileNotFoundError(f"Model not found: {MODEL_PATH}")
    if not LABELS_PATH.exists():
        raise FileNotFoundError(f"Labels file not found: {LABELS_PATH}")

    model = joblib.load(MODEL_PATH)
    with open(LABELS_PATH, "r", encoding="utf-8") as f:
        labels = json.load(f).get("labels", [])

    detector = create_detector(num_hands=1)
    cap = cv2.VideoCapture(args.camera_index)
    if not cap.isOpened():
        raise RuntimeError("Could not open webcam.")
    failed_reads = 0

    pred_history = deque(maxlen=args.history_size)
    text_buffer = ""
    refined_text = ""
    last_refined_raw = ""
    last_append_time = 0.0
    text_refiner = TextRefiner() if args.enable_refine else None
    win = "ASLLM Static Translator"
    if not args.no_gui:
        cv2.namedWindow(win, cv2.WINDOW_NORMAL)

    _emit({"type": "started", "labels": labels})

    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                failed_reads += 1
                # Camera backends can briefly fail reads; don't exit immediately.
                if failed_reads <= 20:
                    time.sleep(0.05)
                    continue
                # Try one reopen before giving up.
                cap.release()
                time.sleep(0.2)
                cap = cv2.VideoCapture(args.camera_index)
                if cap.isOpened():
                    failed_reads = 0
                    continue
                raise RuntimeError("Webcam stream lost.")
            failed_reads = 0
            frame = cv2.flip(frame, 1)
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            rgb = np.ascontiguousarray(rgb)
            mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
            res = detector.detect(mp_image)
            current_pred = "NO_HAND"
            current_conf = 0.0
            landmarks = []

            if res.hand_landmarks:
                hand = res.hand_landmarks[0]
                landmarks = [[lm.x, lm.y, lm.z] for lm in hand]
                vec = extract_hand_features(hand).reshape(1, -1)
                pred = model.predict(vec)[0]
                if hasattr(model, "predict_proba"):
                    probs = model.predict_proba(vec)[0]
                    best_idx = int(np.argmax(probs))
                    current_conf = float(probs[best_idx])
                    current_pred = str(pred) if current_conf >= args.threshold else "UNKNOWN"
                else:
                    current_pred = str(pred)
                    current_conf = 1.0

            pred_history.append(current_pred)
            smoothed_pred = majority_vote(list(pred_history)) or "NO_HAND"
            now = time.time()
            if (
                smoothed_pred not in ("NO_HAND", "UNKNOWN")
                and (now - last_append_time) > args.append_cooldown
                and len(pred_history) == args.history_size
                and list(pred_history).count(smoothed_pred) >= args.stable_min_votes
            ):
                text_buffer += smoothed_pred
                last_append_time = now
            if text_refiner is not None and text_buffer != last_refined_raw:
                refined_text = text_refiner.refine(text_buffer)
                last_refined_raw = text_buffer

            _emit({
                "type": "frame",
                "prediction": smoothed_pred,
                "confidence": round(float(current_conf), 3),
                "text": refined_text or text_buffer,
                "raw_text": text_buffer,
                "refined_text": refined_text,
                "landmarks": landmarks,
            })

            if not args.no_gui:
                draw_hand_landmarks(frame, res.hand_landmarks if res.hand_landmarks else None)
                draw_hud(
                    frame=frame,
                    prediction=smoothed_pred,
                    confidence=current_conf,
                    text_buffer=text_buffer,
                    threshold=args.threshold,
                )
                cv2.imshow(win, frame)
                key = cv2.waitKey(1) & 0xFF
                if key == 27:
                    break
    finally:
        cap.release()
        if not args.no_gui:
            cv2.destroyAllWindows()
        if hasattr(detector, "close"):
            detector.close()
        _emit({"type": "stopped"})


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        _emit({"type": "error", "detail": str(exc)})
        raise
