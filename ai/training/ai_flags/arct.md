# Sphere Care Video Analysis Pipeline

This document describes the target architecture using one consistent structure for every layer: layer name, short description, input, and output. It reflects the current pipeline design, including YOLO for wide detection, MediaPipe Hands as the current specialist backend, and the split between incident and observation paths.

## Layer 0 — Product and Metrics

**Description:** Define success before modelling begins. This includes false-alert tolerance, recall goals, safe wording rules, and review expectations so the system is judged against operational outcomes instead of only model scores.

**Input:** Stakeholder goals, care workflow constraints, compliance needs.

**Output:** KPIs, severity policy, language policy, and evaluation targets.

## Layer 1 — Ingest

**Description:** Read a video file or stream and convert it into an ordered frame stream with timestamps and basic metadata. This layer may resize frames or cap sampling rate so downstream layers receive a stable and manageable source.

**Input:** Video source, camera metadata, optional source configuration.

**Output:** Raw frames with timestamps, source identifiers, and basic ingest metadata.

## Layer 2 — Data Quality Gate

**Description:** Evaluate frame quality and mark weak evidence such as darkness, blur, occlusion, or overall low visibility. These flags do not decide incidents by themselves, but they reduce trust in later decisions.

**Input:** Raw frames.

**Output:** Quality-aware frames with quality flags and quality scores.

## Layer 3 — Frame Selection (Dedupe / Striding / Burst)

**Description:** Reduce compute by skipping near-duplicate or static frames while still preserving useful sampling coverage. When scene change or motion spikes, this layer can temporarily switch to burst selection to avoid missing short events.

**Input:** Quality-aware frame stream.

**Output:** Selected frames or timestamps passed to heavier perception layers.

## Layer 4 — Perception (Spatial)

**Description:** Run a wide detector such as YOLO to identify people, objects, boxes, class scores, and zone hits. This layer produces spatial facts only and should not make final safety conclusions.

**Input:** Selected frames.

**Output:** Per-frame detections with labels, confidences, bounding boxes, and zone matches.

## Layer 5 — Perception (Specialist, Cascaded)

**Description:** Run a complementary specialist model on Layer 4 crops, especially person-centered crops. The current specialist path uses MediaPipe Hands to extract hand presence, hand landmarks, hand-object distance, and interaction-style cues, while still allowing fallback logic when needed.

**Input:** Crops derived from Layer 4 detections, plus optional short local context.

**Output:** Specialist evidence such as `hand_present`, `hand_conf`, `hand_object_distance`, `proximity_score`, `interaction_conf`, backend metadata, and action labels.

## Layer 6 — Frame Fact Assembly

**Description:** Merge wide-detector output, specialist output, motion cues, and quality state into one structured record for each processed time point. This layer creates the clean contract used by rules, audit logging, and later explanation.

**Input:** Layer 4 detections, Layer 5 specialist evidence, motion cues, quality flags.

**Output:** `FrameFact`-style structured records containing facts only.

## Layer 7 — Candidate Layer

**Description:** Convert frame facts into possible safety-relevant events such as possible fall, sharp object near a person, or unsafe zone pattern. This is the first place where raw facts become event hypotheses, but they are still not confirmed incidents.

**Input:** `FrameFact` stream, optional short history buffer.

**Output:** Candidate events with event type, timestamp, evidence, raw confidence, and zone.

## Layer 8 — Beta Creation

**Description:** Open Beta flags for suspicious candidates as low-commitment early warnings. Beta exists so the system can preserve possible risk without over-calling a final incident too early.

**Input:** Candidate events.

**Output:** Beta records with IDs, event type, timestamp, zone, confidence, and evidence trace.

## Layer 9 — Confidence Calibration

**Description:** Map raw scores into stable confidence bands or calibrated values. This helps thresholds behave more consistently across different cameras, clips, and model backends.

**Input:** Beta confidences, optional calibration policy or historical calibration data.

**Output:** Calibrated confidence values used by triage.

## Layer 10 — Risk Triage (Beta to Alpha)

**Description:** Promote Beta to Alpha only when the rule package passes, not just when a single score is high. Typical checks include repetition, duration, quality conditions, and agreement between wide detection and specialist evidence.

**Input:** Beta events plus short time-window history.

**Output:** Triaged events marked as Beta or Alpha, with adjusted evidence and triage reasons.

## Layer 11 — Branch Decision

**Description:** Decide which downstream path should run based on whether any Alpha events exist. This keeps confirmed incident handling separate from non-incident monitoring summaries.

**Input:** Triaged events.

**Output:** Branch result such as `alpha_path` or `observation_path`, plus counts like `alpha_count`.

## Layer 12A — Incident Path (Alpha): Cooldown, Merge, Timeline

**Description:** Process confirmed Alpha events by applying cooldown, deduplication, optional reopen or escalation handling, and timeline building. The goal is to turn repeated detections into a coherent incident object instead of many duplicate alerts.

**Input:** Alpha triaged events.

**Output:** Incident timeline objects with IDs, time windows, severity, confidence, and zones.

## Layer 12A.5 — Incident Evidence Snapshot Pack (Planned)

**Description:** Capture a small evidence set around the incident anchor time, such as one frame before, one near the event, and one after. This evidence package is intended for human review and later LLM support, with a policy to keep only the best frame after resolution if retention rules allow it.

**Input:** Incident timeline objects, frame references, retention policy.

**Output:** Structured snapshot package with before/anchor/after frames, best-frame selection, and retention metadata.

## Layer 13A — Incident Summary Preparation

**Description:** Build a structured summary package for the LLM from incident facts without allowing free-form invention. This package should contain timing, severity, visibility, evidence references, and any approved supporting frames.

**Input:** Incident timeline, optional incident evidence snapshot pack.

**Output:** Structured incident summary package ready for LLM use.

## Layer 14A — LLM Incident Narrative

**Description:** Generate staff-facing wording from the structured incident summary package. The LLM should act as a narrator of already-validated facts, not as the detector or the decision-maker.

**Input:** Incident summary package.

**Output:** Draft title, summary, and body in a defined schema.

## Layer 15A — Schema Validation, Guard, and Severity Gate

**Description:** Validate the incident narrative structure, retry or fall back if needed, and guard against unsupported or unsafe wording. The same stage can route outputs by severity, such as immediate alert versus review queue.

**Input:** LLM incident output plus structured incident facts.

**Output:** Final incident report, alert routing decision, and validated incident payload.

## Layer 12B — Observation Path (No Alpha): Timeline and Chunks

**Description:** Build an observation timeline from Beta events and weak signals, then group them into chunk-level summaries over time windows. This path keeps useful monitoring value even when no confirmed incident exists.

**Input:** Triaged non-Alpha events, frame or fact summaries.

**Output:** Observation timeline plus chunk-level notes or chunk summaries.

## Layer 12B.5 — Observation Evidence Snapshot Pack (Planned)

**Description:** Capture a small evidence set for useful non-incident observations, typically one representative frame around the chunk plus optional before and after context. This layer is lighter than the incident evidence pack and is mainly for review, summarisation, or audit support.

**Input:** Observation timeline, chunk summaries, frame references.

**Output:** Observation snapshot package with representative frames and metadata.

## Layer 13B — LLM General Summary, Schema, and Guard

**Description:** Generate a neutral review summary from the observation path without escalating it into an incident. The summary should remain conservative, validated, and suitable for documentation or review.

**Input:** Observation structure, chunk summaries, optional observation snapshot package.

**Output:** General report with validated non-incident summary content.

## Layer 16 — Outputs and Audit

**Description:** Persist branch outputs, reports, timelines, decisions, alerts, model versions, configuration values, and approved evidence references. This layer creates the durable trace needed for review, debugging, compliance, and operational learning.

**Input:** Final incident or observation outputs.

**Output:** Stored reports, audit metadata, alert records, and versioned evidence references.

## Layer 17 — Continuous Improvement (Operational Loop)

**Description:** Feed reviewer actions, confirmed outcomes, and labelled clips back into the system improvement loop. This is where rules are retuned, thresholds are updated, models are retrained, and all changes are versioned and compared.

**Input:** Reviewer decisions, labels, stored audit data, curated clips.

**Output:** Updated models, updated configuration versions, and measured validation results.

---

## Main Flow

`Ingest -> Quality -> Select Frames -> Detect / Perceive -> Candidate -> Beta -> Triage to Alpha -> Branch -> Incident Path or Observation Path -> LLM Wording + Validation / Guard -> Outputs + Audit -> Feedback -> Improve`