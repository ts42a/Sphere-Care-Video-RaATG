# Sphere Care

**AI-assisted care documentation, safety monitoring, ASL communication, and family engagement — built for Australian aged care.**

Sphere Care is a secure, role-based platform that helps care staff record interactions, generate searchable transcripts and summaries, translate ASL sign language in real time, review AI safety flags, communicate with families, and maintain audit-ready records — all from one web and mobile ecosystem. AI supports staff; every transcript, summary, and flag is reviewed by a person before action is taken.

**Watch the marketing video:** [Sphere Care — Product Overview](https://drive.google.com/file/d/1HpjeubGFwyd8zx1Gviv8f9mp_A-mW8tB/view?usp=sharing)

> CSIT321 Software Engineering Capstone · University of Wollongong · Academic Year 2025–2026

---

## The problem

Australian aged care providers face growing documentation burden, limited overnight safety visibility, fragmented family communication, accessibility barriers for residents who use sign-based communication, and rising compliance pressure. Sphere Care addresses these by combining documentation, communication, safety monitoring, accessibility, and governance in one platform.

## What Sphere Care does

| Capability | Description |
|------------|-------------|
| **AI-assisted recording** | Capture care sessions from CCTV or camera; auto-generate transcripts and summaries |
| **Live speech & ASL transcription** | Real-time speech-to-text and sign language recognition during calls and messages |
| **SCVAM 2.1 safety monitoring** | Video analysis flags potential events — falls, agitation, medication refusal — for staff review |
| **ASLLM + SRM** | Recognise ASL gestures (static + motion) and refine output into readable sentences |
| **Records library** | Searchable recordings, transcripts, AI summaries, and exportable reports |
| **Family communication** | Secure messaging, video/audio calls, bookings, and notifications |
| **Compliance & governance** | RBAC, consent/vault controls, immutable audit logs, per-facility data isolation |

## Key differentiators

| Area | Traditional systems | Sphere Care |
|------|---------------------|-------------|
| Documentation | Manual, inconsistent notes | AI transcription + summarisation |
| Safety | Staff observation only | SCVAM-assisted flagging with human review |
| Accessibility | Verbal/written only | ASLLM gesture recognition + SRM sentence refinement |
| Family comms | Phone calls, ad-hoc visits | Secure video calls and real-time messaging |
| Compliance | Scattered, hard to audit | Centralised audit logs, search, and export |
| Deployment | Complex IT rollout | Web-based — no install for staff or families |

## Platforms

| App | Users | Key areas |
|-----|-------|-----------|
| **Staff Web** | Admins, nurses, carers, doctors | Dashboard, Recording Console, Records, Flags, Residents, Bookings, Messages, Admin Console |
| **Family Mobile** | Residents and family contacts | Home, Call, Booking, Task, Messages |

## AI modules

| Module | Role |
|--------|------|
| **SCVAM 2.1** | Analyses recorded video; generates reviewable safety flags |
| **ASLLM** | Static and motion ASL/gesture recognition (MediaPipe, GRU) |
| **SRM** | Sentence Refinement Model — turns recognised signs into clear readable text |
| **Whisper ASR** | Live and post-session speech transcription |
| **LLM summaries** | Call, recording, and resident care summaries (Ollama / OpenAI) |

## Tech stack

| Layer | Technologies |
|-------|----------------|
| Backend | FastAPI, PostgreSQL, SQLAlchemy, WebSockets, Uvicorn |
| Staff web | HTML, CSS, JavaScript (`frontend_staff/`) |
| Family mobile | Expo, React Native, TypeScript (`frontend_client/`) |
| Calls | LiveKit WebRTC |
| AI / vision | SCVAM 2.1, ASLLM, SRM, OpenCV, MediaPipe, PyTorch, YOLOv8, Whisper |

## First run (recommended — native)

Best for the **full demo** (SCVAM, ASL, Whisper enabled by default). Needs PostgreSQL + Python 3.11 + ~5 GB for dependencies.

```powershell
# 1. Database (once)
psql -U postgres -c "CREATE DATABASE sphere_care;"

# 2. Backend env — app reads backend/.env only
Copy-Item backend\.env.example backend\.env
# Edit DATABASE_URL if your Postgres password is not "postgres"

# 3. Python (first install may take 15–30 min)
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python -m uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
```

Open **http://localhost:8000** → login `admin1@test.com` / `Pass1234`

| Works immediately | Needs extra config |
|-------------------|-------------------|
| Staff web, dashboard, residents, messages, bookings | Video/audio **calls** → LiveKit keys in `backend/.env` |
| Seeded test accounts | Live **transcripts** → LiveKit + Python 3.11 + ffmpeg |
| SCVAM worker (background) | **AI summaries** → Ollama or OpenAI in `backend/.env` |

Full guide: [docs/RUN.md](docs/RUN.md) · Mobile: [docs/mobile_run.md](docs/mobile_run.md)

**Staff login tip:** staff accounts need the **Center ID** printed in the backend terminal on first start.

## Docker (lighter default)

Good if you don't want to install PostgreSQL/Python locally. **SCVAM and AI are disabled by default** in `docker/.env` — enable them for the full pipeline.

```powershell
Copy-Item docker\.env.example docker\.env
docker compose -f docker/docker-compose.yml up --build
```

- **Staff web + API:** http://localhost:8000
- **API docs:** http://localhost:8000/docs

See [docker/README.md](docker/README.md) for dev mode and enabling SCVAM/AI.

## Mobile client (optional)

```powershell
cd frontend_client
Copy-Item .env.example .env
npm install
npx expo start --web --port 3000
```

Web preview works for UI; **calls require an Expo dev build + LiveKit** — see [docs/mobile_run.md](docs/mobile_run.md).

**Test accounts** (all passwords `Pass1234`): `admin1@test.com`, `staff1@test.com`, `client1@test.com`

## Project structure

```
├── backend/           # FastAPI API, services, SCVAM workers, ASL runtime
├── frontend_staff/    # Staff web application
├── frontend_client/   # Family mobile app (Expo)
├── ai/                # SCVAM 2.1, ASLLM, SRM models and training
├── docker/            # Docker Compose and container config
└── docs/              # Setup guides, architecture, project PDFs
```

## Documentation

### Setup & technical

- [Docs index](docs/README.md)
- [User guide](docs/user-guide.md) · [Architecture](docs/architecture.md)
- [Calls & ASR](docs/call.md) · [AI summaries](docs/ai_summary.md) · [Test AI modules](docs/ai-modules.md)

### Project documents (PDF)

- [User Manual](docs/SPHERECARE%20USER%20MANUAL%20(2).pdf) — staff web and mobile app guide
- [Project Marketing](docs/Project_Marketing%20(2).pdf) — market analysis, personas, product showcase
- [Technical Report](docs/G09_Technical_Report%20(3).pdf) — requirements, architecture, AI layer, testing
- [Meeting Agendas](docs/G09_Meeting_Agenda%20(1).pdf) — sprint meetings and minutes

## Team

| Name | Student ID |
|------|------------|
| Yu Han Yong | 8212041 |
| Tonmoy Sarker | 8239083 |
| Lite Ye | 8326009 |
| ChingYu Chen | 7910058 |
| ChenCheng Lu | 7316550 |
| Araf Akhter | 8320561 |

**Supervisor:** Aneta Guzowska — University of Wollongong

## Who it's for

| Role | Primary app |
|------|-------------|
| Facility administrator | Staff web — users, settings, analytics, audit logs |
| Nurse / carer | Staff web — recording, flags, residents, messages |
| Doctor / clinician | Staff web — records, transcripts, clinical notes, bookings |
| Resident / family | Mobile — updates, bookings, calls, messages |
| Compliance officer | Staff web (read-only) — records, audit logs, reports |

## License

Academic capstone project — University of Wollongong. Free for educational and research use; commercial use requires author permission. See [LICENSE](LICENSE).
