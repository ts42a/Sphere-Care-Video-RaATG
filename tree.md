sphere-care/
├─ README.md
├─ .gitignore
├─ .env.example
├─ docker-compose.yml
├─ Makefile
├─ .github/
│  └─ workflows/
│     ├─ ci.yml                 # lint/test/build
│     ├─ security.yml           # SAST + dependency scan
│     └─ deploy-dev.yml         # optional
│
├─ docs/
│  ├─ 00_overview.md
│  ├─ 01_requirements.md        # functional + non-functional
│  ├─ 02_user-stories.md        # epics/stories + acceptance criteria
│  ├─ 03_rtm.md                 # requirements traceability matrix (Req -> API -> Tests)
│  ├─ architecture.md
│  ├─ api-contract.md           # OpenAPI decisions + conventions
│  ├─ security/
│  │  ├─ threat-model.md
│  │  ├─ privacy-impact.md      # consent, minimization, retention, access logs
│  │  └─ rbac-matrix.md         # role->permissions table
│  ├─ database-erd.md
│  ├─ demo-script.md
│  └─ test-plan.md
│
├─ infra/
│  ├─ nginx/
│  │  ├─ nginx.conf
│  │  └─ sites-enabled/
│  │     └─ sphere-care.conf
│  ├─ certs/                    # dev certs
│  ├─ postgres/
│  │  └─ init.sql
│  ├─ redis/
│  ├─ minio/                    # S3-compatible object storage for video/audio
│  ├─ coturn/                   # TURN/STUN for WebRTC reliability
│  │  └─ turnserver.conf
│  ├─ observability/
│  │  ├─ prometheus.yml
│  │  └─ grafana/
│  └─ scripts/
│     ├─ backup_db.sh
│     ├─ restore_db.sh
│     ├─ seed_demo_data.sh
│     └─ rotate_retention.sh    # retention policy enforcement
│
├─ backend_api/                 # FastAPI “source of truth”
│  ├─ Dockerfile
│  ├─ pyproject.toml
│  ├─ alembic.ini
│  ├─ alembic/
│  │  ├─ versions/
│  │  └─ env.py
│  └─ app/
│     ├─ main.py
│     ├─ core/
│     │  ├─ config.py
│     │  ├─ security.py         # hashing/JWT, RBAC helpers, MFA-ready hooks
│     │  ├─ logging.py
│     │  ├─ rate_limit.py
│     │  └─ audit_context.py
│     ├─ db/
│     │  ├─ base.py
│     │  ├─ session.py
│     │  └─ migrations_helpers.py
│     ├─ models/
│     │  ├─ user.py             # users + roles
│     │  ├─ facility.py
│     │  ├─ resident.py         # residents + family links/consent
│     │  ├─ consent.py          # consent grants + scopes + expiry
│     │  ├─ task.py             # tasks + medication schedules
│     │  ├─ booking.py
│     │  ├─ call.py             # call sessions + participants
│     │  ├─ transcript.py       # segments + metadata (WER, speaker, timestamps)
│     │  ├─ record.py           # video/audio objects + signed URLs
│     │  ├─ flag.py             # AI flags + human review lifecycle
│     │  ├─ message.py
│     │  ├─ notification.py
│     │  ├─ retention.py        # per-facility policy settings
│     │  └─ audit.py
│     ├─ schemas/
│     │  ├─ auth.py
│     │  ├─ user.py
│     │  ├─ resident.py
│     │  ├─ consent.py
│     │  ├─ task.py
│     │  ├─ booking.py
│     │  ├─ call.py
│     │  ├─ transcript.py
│     │  ├─ record.py
│     │  ├─ flag.py
│     │  ├─ message.py
│     │  ├─ notification.py
│     │  ├─ retention.py
│     │  └─ audit.py
│     ├─ repositories/
│     │  ├─ ...
│     ├─ services/
│     │  ├─ auth_service.py
│     │  ├─ rbac_service.py
│     │  ├─ consent_service.py
│     │  ├─ call_service.py
│     │  ├─ transcript_service.py
│     │  ├─ record_service.py
│     │  ├─ flag_service.py
│     │  ├─ notification_service.py
│     │  ├─ retention_service.py
│     │  └─ analytics_service.py
│     ├─ api/
│     │  ├─ deps.py
│     │  ├─ routes/
│     │  │  ├─ auth.py
│     │  │  ├─ users.py
│     │  │  ├─ residents.py
│     │  │  ├─ consent.py
│     │  │  ├─ tasks.py
│     │  │  ├─ bookings.py
│     │  │  ├─ calls.py
│     │  │  ├─ transcripts.py
│     │  │  ├─ records.py
│     │  │  ├─ flags.py
│     │  │  ├─ messages.py
│     │  │  ├─ notifications.py
│     │  │  ├─ retention.py
│     │  │  └─ audit.py
│     │  └─ router.py
│     ├─ realtime/
│     │  ├─ ws_manager.py
│     │  ├─ ws_alerts.py         # push flags/notifications
│     │  └─ ws_transcript.py     # live transcript stream for calls
│     ├─ integrations/
│     │  ├─ storage_s3.py        # MinIO/S3 wrapper
│     │  ├─ webrtc_signaling.py  # signaling hooks (offers/answers/ICE)
│     │  ├─ email_sms.py
│     │  └─ calendar.py
│     └─ tests/
│        ├─ ...
│
├─ media_service/               # WebRTC + recording 
│  ├─ Dockerfile
│  ├─ pyproject.toml
│  └─ app/
│     ├─ server.py              # signaling endpoints + health
│     ├─ recorder.py            # save streams -> object storage
│     ├─ ice_config.py          # TURN/STUN config provider
│     ├─ events.py              # publish call start/stop events to Redis
│     └─ tests/
│        └─ test_signaling.py
│
├─ ai/                   # background pipeline (transcribe/summary/flags)
│  ├─ Dockerfile
│  ├─ pyproject.toml
│  ├─ training/
|  |  ├── ai_flags/
|  |  ├── ai_transcript/
|  |  ├── dataset/
|  |  │  ├── raw/
|  |  │  │  ├── motion/
|  |  │  │  └── static/
|  |  │  └── metadata.jsonl
|  |  ├── models/
|  |  ├── dataset_builder.py
|  |  ├── train.py
|  |  └── README.md
│  └─ app/
│     ├─ worker.py              # Celery/RQ entry
│     ├─ tasks/
│     │  ├─ extract_audio.py
│     │  ├─ transcribe.py
│     │  ├─ diarize.py          # optional speaker separation
│     │  ├─ summarize.py
│     │  └─ detect_flags.py     # rules/ML -> flags for review
│     ├─ models_runtime/
│     │  ├─ whisper_wrapper.py
│     │  ├─ summarizer_wrapper.py
│     │  └─ vision_detector.py
│     └─ utils/
│        ├─ timings.py
│        └─ validators.py
│
├─ frontend_staff/              # Web UI (Facility/Staff/Admin)
│  ├─ README.md
│  ├─ package.json
│  ├─ vite.config.js
│  └─ src/
│     ├─ app/                   # routes/layout
│     ├─ pages/                 # dashboard, residents, records, flags, staff, admin
│     ├─ components/            # tables, modals, navbar/sidebar
│     ├─ api/                   # api_client + typed calls
│     ├─ auth/                  # login/register + token handling
│     └─ styles/
│
├─ frontend_client/             # Mobile-style UI (Family/Caregiver)
│  ├─ README.md
│  ├─ package.json
│  └─ src/
│     ├─ pages/                 # home, daily tasks, booking flow, call, messages
│     ├─ components/            # bottom nav, cards, toasts
│     ├─ api/
│     │  ├─ api_client.js
│     │  └─ ws_client.js
│     └─ assets/
│
├─ shared/                      # single source of shared contracts
│  ├─ openapi/
│  │  └─ openapi.yaml
│  └─ types/
│     ├─ rbac_permissions.json
│     └─ event_payloads.json
│
└─ scripts/
   ├─ dev_up.sh
   ├─ dev_down.sh
   ├─ fmt_lint_test.sh
   └─ generate_openapi.sh