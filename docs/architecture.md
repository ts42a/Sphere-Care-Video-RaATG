# Sphere Care — System Architecture (MVP)

## 1. Purpose
Sphere Care is a secure, role-based video platform for aged care that supports:
- Recording / live sessions
- Real-time transcription + searchable timeline
- AI flags (e.g., fall risk, agitation, medication refusal)
- Records library + summaries
- Staff/family communication
- Audit logs + retention controls

This architecture aligns with the project scope: recording/streaming, real-time transcription, MVP analytics, secure storage, dashboards, RBAC, and audit/retention. 

## 2. Users & Roles
Primary personas:
- Admin (Facility Manager)
- Nurse / Carer
- Clinician (Doctor)
- Family member
- Auditor

Access is enforced via RBAC:
- users, roles, user_roles
- (recommended) permissions, role_permissions
- (recommended) facility_user_roles for per-facility assignments

## 3. High-Level Components

### 3.1 Clients (Frontends)
Two frontends (same backend):
1) Staff Web App (Operations)
   - Dashboard, Recording Console, Records Library, Flags & Reviews, Residents, Staff & Roles, Admin Console
2) Family Portal / Client Flow
   - Booking, messages, approved clips/summaries, notifications

### 3.2 Backend (API)
**FastAPI** (recommended) with modules:
- Auth & RBAC
- Facility & Resident Management
- Task + Medication Scheduling
- Booking & Availability
- Calls + Transcription Gateway
- Records + Media Catalog
- Flags + Review Workflow
- Messaging + Notifications
- Reporting & Analytics
- Audit Logging

### 3.3 AI Services
Separate services (can be internal modules in MVP):
- ASR (Speech-to-Text) streaming + batch
- Summarization (record -> ai_summary)
- Safety detection (video -> flags)
All AI outputs must be traceable to record/session, model versioned, and reviewable.

### 3.4 Storage
- PostgreSQL: metadata, users, roles, residents, records, flags, messages, audit
- Object Storage (S3-compatible): media_assets (video/audio/images)
- (optional) Cache/Queue: Redis for websocket presence, Celery/RQ for background jobs

## 4. Data Model (Core Entities)
- Facility hierarchy: facilities -> units -> rooms
- Residents: residents + family_contacts + resident_assignments
- Tasks: task_templates + task_instances
- Medications: medications + medication_schedule + medication_administration
- Booking: appointment_types + clinicians + clinician_availability + bookings
- Calls & Transcript: call_sessions + call_participants + transcript_segments
- Records: records + media_assets + ai_summaries
- Safety: flags + flag_reviews
- Messaging: threads + thread_members + messages + message_reads
- Notifications: notifications
- Security: audit_events (immutable)

## 5. Key Workflows

### 5.1 Recording -> Transcript -> Record -> Summary
1) Staff starts recording or call session (call_sessions created)
2) Media streamed/recorded and stored in object storage (media_assets)
3) ASR produces transcript segments (transcript_segments)
4) A record is created/linked (records)
5) Summarizer writes ai_summaries (with model_version)
6) Staff can search and review timeline in Records Library

### 5.2 AI Flag -> Review -> Resolution
1) AI detector creates flags (category, severity, confidence, start/end)
2) Staff reviews in Flags & Reviews and creates flag_reviews (confirm/false_alarm/escalate/resolve)
3) Flag status updates: new -> in_review -> resolved/escalated
4) Notifications are sent to relevant staff

### 5.3 Medication Schedule -> Administration
1) Medication is defined (medications + medication_schedule)
2) Instances generated into medication_administration (scheduled_at)
3) Staff records given/missed (recorded_by/recorded_at)
4) Overdue/missed triggers notification + optional flag

### 5.4 Messaging
1) Thread created (direct/group/resident)
2) Members added (thread_members)
3) Messages inserted + message_reads updated
4) Notifications on unread messages

## 6. Security & Compliance

### 6.1 Authentication
- OAuth2 / JWT access tokens
- Refresh tokens (httpOnly cookies recommended)
- Optional: MFA for Admin roles

### 6.2 Authorization (RBAC)
- Enforce permissions at API layer:
  - Resident-level access via resident_assignments and facility scope
  - Family access via family_contacts access_level + consent rules

### 6.3 Audit Logging (Critical)
- Every sensitive action writes to audit_events:
  - view/download record
  - view resident profile
  - review/resolve flags
  - login/logout
  - permission/role changes
- Audit is immutable (append-only)

### 6.4 Data Protection
- TLS everywhere
- Encryption at rest for object storage + database (managed or app-level)
- Signed URLs for media access (time-limited)
- PII minimization in logs
- Retention policies:
  - media retention
  - transcript retention
  - audit retention_until per policy

## 7. Reliability & Scaling
- Stateless API -> scale horizontally
- Background jobs for:
  - transcription finalization
  - summarization
  - heavy CV detection
  - report exports
- WebSocket for live transcript + call status updates
- Rate limiting on auth + media endpoints

## 8. Observability
- Structured logs (correlation_id / request_id)
- Metrics: latency, error rates, job queue depth, transcription WER, flag verification accuracy
- Alerting: failed jobs, storage failures, abnormal error spikes

## 9. Environments & Deployment
- Dev: Docker Compose (API + DB + Redis)
- Staging: same as prod with test data
- Prod: containerized (Docker), CI/CD pipeline
- Secrets via environment variables / secret manager
- Database migrations via Alembic

## 10. MVP Scope Boundaries
In scope: recording/streaming, transcription, MVP flags, secure storage, dashboards, RBAC, audit, pilot.
Out of scope: full EMR integrations, advanced biometrics, broad enterprise rollout.
