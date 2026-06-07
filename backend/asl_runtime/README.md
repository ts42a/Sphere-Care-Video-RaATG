# ASL Runtime (`backend/asl_runtime`)

Headless and GUI runners for static and motion ASL, aligned with training scripts:

| Training | Runtime |
|----------|---------|
| `ai/training/ai_transcript/test.py` | `run_static.py` |
| `ai/training/ai_transcript/test_motion.py` | `run_motion.py` |

Training files under `ai/training/` are **not modified**; this package imports models and helpers read-only.

---

## Quick start

From the repo root:

```powershell
cd backend\asl_runtime
py run_static.py
```

Or from the repo root:

```powershell
.\.venv\Scripts\python.exe -m backend.asl_runtime.run_static
```

Motion (default **detect 960**, same as API subprocess):

```powershell
py run_motion.py
```

Full-frame MediaPipe like training: `py run_motion.py --detect-width 0`

`run_static.py` / `run_motion.py` auto-enable **GUI** (OpenCV window) when launched as a script from this folder.

---

## Default mode (no flags) — **fast**

```powershell
py run_static.py
```

This is the recommended daily default (same idea as the old `--fast` flag).

| Setting | Value |
|---------|--------|
| Camera | **1280×720** |
| MediaPipe detect width | **960px** (full-res display, smaller inference image) |
| Frame read | Direct read (no buffer flush) |
| Overlay hold | Off (snappier; skeleton may blink if detection drops briefly) |

Startup prints something like:

```text
Camera 1280x720, detect 960px (fast). Q/ESC quit.
```

**Why it feels fast:** fewer pixels per frame and a narrower MediaPipe input than HD modes, so inference and display keep up with the webcam.

---

## HD quality mode (sharper, slower)

```powershell
py run_static.py --quality
```

| Setting | Value |
|---------|--------|
| Camera | **1920×1080** (retries HD if the driver ignores a low resolution) |
| MediaPipe detect width | **1280px** |
| Overlay hold | 4 frames (smoother skeleton / target box) |

Startup prints:

```text
Camera 1920x1080, detect 1280px (quality). Q/ESC quit.
```

Use this when the default looks soft on your webcam but you can accept lower FPS.

---

## Max quality (slowest)

Full camera resolution for both display and MediaPipe:

```powershell
py run_static.py --quality --detect-width 0
```

`--detect-width 0` means use the full frame width for detection (no downscale).

You can also set resolution explicitly:

```powershell
py run_static.py --camera-width 1920 --camera-height 1080 --detect-width 0
```

---

## Optional: less camera flicker

Slightly slower; drops one stale buffered frame before each read:

```powershell
py run_static.py --frame-flush
```

Combine with `--quality` if needed:

```powershell
py run_static.py --quality --frame-flush
```

---

## Reference: modes compared

| Command | Camera | Detect width | Speed | Quality |
|---------|--------|--------------|-------|---------|
| `py run_static.py` | 1280×720 | 960 | Fast | Good on most cams |
| `py run_static.py --quality` | 1920×1080 | 1280 | Slower | Sharper |
| `py run_static.py --quality --detect-width 0` | 1920×1080 | Full | Slowest | Max |
| `py run_static.py --frame-flush` | (same as base) | (same) | Slightly slower | Less flicker |

> **Note:** Some webcams ignore `1280×720` and fall back to a poor ~640×480 mode. If the default looks bad but `--quality` looks good, use `--quality` for that machine.

---

## GUI layout

- **Video:** hand skeleton + static target box (no text on top of the video).
- **Bottom bar (white):**
  - **Left (~75%):** `Translation :` (sentence buffer), `Text :` (prediction chain, e.g. `aaiaddfjk`).
  - **Right (~25%):** `prediction key` — current sign and `%` on one line; key hints below.

### Keyboard (GUI)

| Key | Action |
|-----|--------|
| **Q** / **ESC** | Quit |
| **C** | Clear text buffer |
| **SPACE** | Append current stable prediction |

---

## Messages app (ASL Translation button)

Choosing **Static** or **Motion** starts `run_static.py` or `run_motion.py` in the background (same as `py run_*.py` from this folder). The **OpenCV window** is where you sign; **Close** in the web panel stops the process.

Headless JSON mode (optional, not used by Messages UI):

```powershell
python -m backend.asl_runtime.run_static --no-gui
```

---

## All useful flags (static)

```text
--camera-index 0
--camera-width 1280
--camera-height 720
--detect-width 960      # 1280 with --quality; 0 = full resolution
--quality               # 1920x1080 + detect 1280
--frame-flush           # reduce flicker, slightly slower
--threshold 0.54
--history-size 8
--append-cooldown 1.0
--stable-min-votes 6
--gui                   # OpenCV window (auto when using py run_static.py)
--no-gui                # JSON only (API)
--json                  # also print JSON while GUI is open
```

Motion runner supports the same camera flags plus `--quality`, `--frame-flush`, and motion-specific thresholds.

### Motion vs `test_motion.py` (`live_motion_test/runner.py`)

| Aspect | Training (`test_motion.py`) | Backend default (`py run_motion.py`) |
|--------|------------------------------|--------------------------------------|
| Webcam | `VideoCapture(0)`, driver native size | 1280×720 when using `open_webcam`; GUI uses `cap.read()` like training |
| MediaPipe input | **Full frame** (no downscale) | **Full frame** in GUI (same as training); `--detect-width 960` for faster |
| Confidence threshold | **0.60** (or `decoder_calibration.json`) | **0.60** (or calibration) |
| Motion loop | `live_motion_test/runner.py` | **Same** — GUI mode calls `test_motion.py` runner directly |
| Segmentation / predict | (above) | Identical when using `py run_motion.py` |
| Translation text | Raw word list only | **SRM phrase logic**: greeting (`hello`+`howareyou`+`i`/`fine`), `help`, `seeyoulater` — one sentence per phrase from the Text words (no extra “sorry” / “I am here”) |
| HUD | `draw_hud` on video | Bottom white bar (`gui.py`) |

Training parity for detection: `py run_motion.py --detect-width 0`.  
Training parity for threshold: `py run_motion.py --threshold 0.60`.

Test SRM streaming without the camera:

```powershell
cd ai\models\SRM
py test.py --stream
```

Enter motion words one at a time; **translation** updates when SRM returns a complete sentence (ends with `.` or `?`).

---

## Files

| File | Purpose |
|------|---------|
| `run_static.py` / `run_motion.py` | CLI entry (script-friendly path bootstrap) |
| `static_runner.py` / `motion_runner.py` | Main loops |
| `camera.py` | Webcam open/read, detect resize |
| `gui.py` | Bottom bar + keys |
| `landmarks.py` | Hand lines/points (dataset_builder parity) |
| `preview.py` | JPEG `preview_b64` for web UI |
| `config.py` | Artifact paths |
| `emit.py` | JSON stdout for subprocess |

---

## Troubleshooting

1. **`ModuleNotFoundError: No module named 'backend'`**  
   Run from repo root with `-m`, or use `py run_static.py` from `backend/asl_runtime` (path is added automatically).

2. **Default looks blurry or wrong; `--quality` looks good**  
   Your driver prefers 1920×1080. Use `py run_static.py --quality` as your normal command.

3. **Camera already in use**  
   Close other apps (browser tabs, Teams, etc.) using the webcam.

4. **Very slow**  
   Avoid `--detect-width 0` unless you need it; stay on default or `--quality` without `0`.
