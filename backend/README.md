# Sphere Care Backend - Quick Start

## Requirements

- Python 3.11+
- PostgreSQL 17+

## Setup (from repository root)

```bash
python -m venv .venv
```

### Activate virtual environment

**Windows**

```bash
.venv\Scripts\activate
```

**Mac / Linux**

```bash
source .venv/bin/activate
```

### Install dependencies

```bash
pip install -r requirements.txt
```

### Configure environment

Copy `backend/.env.example` to `backend/.env` and fill in real values for:

- `DATABASE_URL`
- `SECRET_KEY`
- OAuth credentials (if used)
- SMTP credentials (if used)
- LiveKit credentials (if used)

## Start API server

```bash
python -m uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
```

## URLs

- App entry: http://localhost:8000
- API docs: http://localhost:8000/docs
- Health check: http://localhost:8000/health
