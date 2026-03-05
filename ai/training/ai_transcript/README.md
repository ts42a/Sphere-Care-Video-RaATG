# ASL Gesture Training Pipeline

This module contains the **training pipeline for the Sphere Care Gesture AI system**.

The goal of this module is to train machine learning models capable of recognizing **American Sign Language (ASL) gestures** using hand landmark data extracted from video frames.

The system supports two recognition modes:

1. **ASL Alphabet Recognition (A–Z)**
2. **Word-Level Gesture Recognition**

The trained models are exported to the **AI worker service**, where they are used for **real-time gesture inference**.

This allows the Sphere Care platform to detect **non-verbal communication signals** from residents and convert them into structured events for monitoring and reporting.

---

# Folder Structure

```
training/ai_transcript/
├─ datasets/
│  ├─ motion/
│  └─ static/
│
├─ train.py
├─ dataset_builder.py
├─ evaluate.py
├─ export.py
└─ README.md
```

---

# System Overview

The training pipeline follows the workflow below:

```
Data Capture
      ↓
Dataset Preparation
      ↓
Model Training
      ↓
Model Evaluation
      ↓
Model Export
      ↓
Runtime Inference
```

This modular design ensures:

* reproducible training
* clean deployment
* easy dataset expansion

---

# ASL Alphabet Dataset (A–Z)

The system supports recognition of **26 ASL alphabet gestures**.

Each gesture represents a **static hand pose**.

```
A B C D E F G H I J
K L M N O P Q R S T
U V W X Y Z
```

These letters can be used to **spell words dynamically**.

Example:

```
H → E → L → P
```

Result:

```
HELP
```

---

# Feature Representation

Hand landmarks are extracted using **MediaPipe Hands**.

Each frame produces **21 hand landmarks**.

Each landmark contains:

```
(x, y, z)
```

Total features per frame:

```
21 landmarks × 3 coordinates = 63 features
```

Example feature vector:

```
[x1,y1,z1,
 x2,y2,z2,
 ...
 x21,y21,z21]
```

---

# Static vs Motion Gestures

Some ASL gestures are **static**, while others involve **motion**.

Static letters:

```
A B C D E F G H I K L M N O P Q R S T U V W X Y
```

Motion letters:

```
J
Z
```

The dataset supports both formats.

Static gestures:

```
(63,)
```

Motion gestures:

```
(T,63)
```

Example motion sequence:

```
(10,63)
```

---

# Word-Level Gesture Dataset

In addition to letters, the system supports **word-level gestures**.

These gestures represent **complete signs corresponding to common words or commands**.

Example gesture words:

```
HELP
WATER
PAIN
MEDICINE
CALL
STOP
YES
NO
TOILET
THANK YOU
```

For the initial prototype, the dataset may contain approximately:

```
200 gesture words
```

Recommended samples per word:

```
20–50 samples
```

Example dataset size:

| Words | Samples per Word | Total Samples |
| ----- | ---------------- | ------------- |
| 200   | 30               | ~6000         |

---

# Dataset Structure

The dataset is organized by **gesture label**.

```
datasets/

static/
   A/
      sample1.npy
      sample2.npy

   B/
      sample1.npy

   C/
      sample1.npy

   ...

   Z/
      sample1.npy

motion/
   HELP/
      sample1.npz
      sample2.npz

   WATER/
      sample1.npz

   PAIN/
      sample1.npz
```

Static samples store **single frames**.

Motion samples store **frame sequences**.

---

# Data Capture

## Static Gesture Capture

```
data_capture/capture_static.py
```

Captures a single hand pose and saves it as `.npy`.

Example output:

```
A/sample1.npy
```

Feature shape:

```
(63,)
```

---

## Motion Gesture Capture

```
data_capture/capture_seq.py
```

Captures gesture motion sequences.

Frames are stored as:

```
(T,63)
```

Example:

```
HELP/sample1.npz
```

---

# Model Training

Training is performed using:

```
train.py
```

The training script performs:

1. dataset loading
2. feature normalization
3. sequence padding
4. classifier training
5. model export

Run training:

```
python train.py
```

Output artifacts:

```
gesture_model.joblib
labels.json
```

Example label file:

```
{
 "labels": [
  "A","B","C","D","E","F","G","H","I","J",
  "K","L","M","N","O","P","Q","R","S","T",
  "U","V","W","X","Y","Z"
 ]
}
```

---

# Model Evaluation

Evaluation is performed using:

```
evaluate.py
```

Metrics include:

* Accuracy
* Precision
* Recall
* Confusion Matrix

Run evaluation:

```
python evaluate.py
```


# Model Export

After training, the model is exported to the runtime worker.

```
export.py
```

Destination:

```
worker_ai/app/artifacts/gesture/
```

Output structure:

```
gesture_model.joblib
labels.json
```

These files are loaded by:

```
app/runtime/gesture/model_loader.py
```

---

# Runtime Inference Flow

During runtime, the system processes frames from a camera.

```
Camera Frame
      ↓
Hand Landmark Extraction
      ↓
63 Feature Vector
      ↓
Gesture Model
      ↓
Prediction
      ↓
Event Emission
```

Example prediction:

```
{
 "gesture": "HELP",
 "confidence": 0.96
}
```

---

# Hybrid Recognition System

The system combines **letter recognition** and **word recognition**.

| Mode    | Purpose                     |
| ------- | --------------------------- |
| Letters | flexible spelling           |
| Words   | fast command detection      |
| Hybrid  | best real-world performance |

---

# Requirements

Install required Python packages:

```
pip install numpy
pip install opencv-python
pip install mediapipe
pip install scikit-learn
pip install matplotlib
pip install joblib
```

---

# Training Workflow

Typical workflow:

```
1 Capture gesture samples
2 Build dataset
3 Train model
4 Evaluate model
5 Export model
6 Deploy to AI worker
```

Commands:

```
python data_capture/capture_static.py
python train.py
python evaluate.py
python export.py
```

---

# Best Practices

To improve model performance:

* capture gestures from multiple people
* vary lighting conditions
* include different hand sizes
* balance dataset samples
* record gestures from different camera angles

