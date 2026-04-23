markdown
# SR – Sentence Refiner Conversation Dataset Guide

## Overview

This project focuses on building a Sentence Refiner (SR) model that converts noisy, incomplete, or ASL-style conversation text into clear, grammatically correct English.

It is designed for:

- Gesture-to-text systems  
- Noisy conversation correction  
- Transcript refinement for communication systems (e.g., Sphere Care)

---

## Dataset Format

Each sample is an input-output pair:

```json
{
  "input": "hello hello. you okay. yes okay. busy today. finish task. not yet finish tonight. need help tell me. maybe later thanks. meet tomorrow afternoon. yes good. i send time",
  "output": "Hello. Hello. Are you okay? Yes, I am okay. I am busy today. Did you finish the task? Not yet, I will finish it tonight. Let me know if you need help. Maybe later, thanks. Should we meet tomorrow afternoon? Yes, that sounds good. I will send the time."
}
````

---

## Communication Categories

The dataset is divided into six real-world communication categories:

1. Staff ↔ Resident
2. Staff ↔ Doctor
3. Staff ↔ Family
4. Resident ↔ Family
5. Staff ↔ Staff
6. General Daily Communication

Each team member contributes to all categories to ensure balanced coverage.

---

## Dataset Creation Plan

### Per Member

Each team member will create:

* 6 categories
* 10 conversations per category
* 10–15 sentences per conversation
* 4 noisy variations per conversation

### Calculation Per Member


6 categories × 10 conversations = 60 conversations  
60 × 4 variations = 240 pairs per member

### Team Total: 6 members × 240 pairs = 1440 pairs total

---

## Noise Variations

Each clean conversation must be duplicated 4 times, with different noise applied to the input.

Required noise types:

* Missing words
* Broken grammar
* No punctuation
* Mixed or incorrect word order (including repeated words)

The output must always remain clean and grammatically correct.

---

## Dataset Workflow

### Step 1: Create Clean Conversation

* Write a natural conversation (10–15 sentences)
* Ensure clarity and correctness
* Save it in the **output** field

### Step 2: Duplicate

* Copy the same conversation 4 times

### Step 3: Apply Noise

For each copy:
* Modify only the **input** field
* Apply one noise type per copy
* Keep the **output** unchanged

Ensure all variations are realistic and consistent.

---

## Use Case in System
The model refines noisy conversation input into clear and readable communication.

---

## Final Notes

This dataset is **domain-specific**, not general NLP.

The goal is not to build a large language model, but to develop a **focused, high-accuracy correction system** that performs reliably on noisy, real-world conversational input.


