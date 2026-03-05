# AI Gesture Training Module

This module contains the **dataset creation and training pipeline** for the Sphere Care AI gesture recognition system.

It supports two gesture types:

* **Static ASL Alphabet (A–Z)**
* **Motion Gestures (words or dynamic signs such as J and Z)**

The system uses **MediaPipe Hand Landmarks** to convert hand poses into **63-feature vectors**, which are then used to train machine learning models.

The trained models are exported and later used by the **AI runtime worker** to detect gestures in real time.

---

# Project Structure

```
ai/
│
├── app/
│
├── model/
│
└── training/
    │
    ├── ai_flags/
    │
    └── ai_transcript/
        │
        ├── dataset/
        │   │
        │   ├── raw/
        │   │   ├── motion/
        │   │   └── static/
        │   │
        │   └── metadata.jsonl
        │
        ├── models/
        │
        ├── dataset_builder.py
        ├── train.py
        └── README.md
```

---

# Dataset Overview

The dataset is generated using **dataset_builder.py**, which captures hand gestures using a webcam and extracts **MediaPipe hand landmarks**.

Each detected hand produces:

```
21 landmarks × (x, y, z) = 63 features
```

These features are:

* wrist-centered
* scale-normalized

This improves model stability and generalization.

---

# Dataset Types

The system supports **two dataset types**.

## 1. Static Gestures

Used for **ASL alphabet letters A–Z**.

Example:

```
A
B
C
...
Z
```

Each sample is saved as:

```
(63,) vector
```

Stored as:

```
dataset/raw/static/<LETTER>/*.npy
```

Example:

```
dataset/raw/static/A/A_20260305_0001.npy
dataset/raw/static/B/B_20260305_0002.npy
```

---

## 2. Motion Gestures

Used for:

* dynamic letters (**J**, **Z**)
* gesture words (**HELP**, **WATER**, **MEDICINE**, etc.)

Each sample is a sequence:

```
(T, 63)
```

Example:

```
(10 frames × 63 features)
```

Stored as:

```
dataset/raw/motion/<LABEL>/*.npz
```

Example:

```
dataset/raw/motion/HELP/HELP_20260305_0001.npz
dataset/raw/motion/J/J_20260305_0002.npz
```

---

# Metadata File

Each capture session writes metadata to:

```
dataset/metadata.jsonl
```

Example entry:

```json
{
 "session_id": "20260305_231200",
 "type": "static",
 "label": "A",
 "saved_count": 5,
 "notes": "wrist+scale normalized (63D) from MediaPipe"
}
```

This metadata helps with:

* dataset auditing
* experiment tracking
* research reporting

---

# Dataset Builder

The dataset builder launches an interactive capture system.

Run:

```
python dataset_builder.py
```

Menu:

```
=== DATASET BUILDER (ASL) ===

1) Capture STATIC letter A–Z (save best 5)
2) Capture MOTION label (words / J / Z)
3) Exit
```

---

## Static Capture

Captures **stable hand poses** and saves the **best 5 samples**.

Process:

1. Webcam opens
2. Countdown begins
3. User holds gesture steady
4. Stability filter selects clean frames
5. Best 5 samples saved

Output:

```
dataset/raw/static/<LETTER>/*.npy
```

---

## Motion Capture

Captures gesture sequences for motion gestures.

Process:

1. Webcam opens
2. User performs motion gesture
3. Frames converted to landmark sequences
4. Sequences saved when buffer reaches target length

Output:

```
dataset/raw/motion/<LABEL>/*.npz
```

---

# Model Training

Training is performed using **train.py**.

The training pipeline loads the dataset and trains an **SVM classifier using scikit-learn**.

Two training modes are supported:

| Mode   | Description                |
| ------ | -------------------------- |
| static | Train ASL alphabet model   |
| motion | Train motion gesture model |
| both   | Train both models          |

---

## Train Static Model (A–Z)

```
python train.py --mode static
```

Input:

```
dataset/raw/static/
```

Output:

```
artifacts/gesture/static_model.joblib
artifacts/gesture/static_labels.json
```

---

## Train Motion Model

```
python train.py --mode motion
```

Input:

```
dataset/raw/motion/
```

Output:

```
artifacts/gesture/motion_model.joblib
artifacts/gesture/motion_labels.json
```

---

## Train Both

```
python train.py --mode both
```

---

# Model Architecture

The current implementation uses:

```
MediaPipe Hand Landmarks
        ↓
63-feature vector
        ↓
SVM Classifier (scikit-learn)
        ↓
Gesture Prediction
```

For motion gestures:

```
(T,63) sequence
        ↓
flatten
        ↓
SVM classifier
```

---

# Dependencies

Install required packages:

```
pip install mediapipe
pip install opencv-python
pip install numpy
pip install scikit-learn
pip install joblib
```

---

# Role in Sphere Care Platform

This module provides the **AI training pipeline** for the Sphere Care system.

The trained models are later used by the **AI inference service** to detect gestures from video streams and convert them into actionable events such as:

* emergency alerts
* communication assistance
* behavioral monitoring
