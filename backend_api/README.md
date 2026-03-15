# Sphere Care — Quick Start

## Requirements
- Python 3.11+
- PostgreSQL (database: `spherecare`, password: `123`)

## First Time Setup

```bash
cd backend_api
.\venv\Scripts\activate
pip install -r requirements.txt
python seed.py
```

## Start Server

```bash
cd backend_api
.\venv\Scripts\activate
python app.py
```

Open browser: **http://localhost:8000**

## Login
Register a new account or use seeded data.
To make an admin account, register then run in PostgreSQL:
```sql
UPDATE users SET role = 'admin' WHERE email = 'your@email.com';
```

## API Docs
**http://localhost:8000/docs**
