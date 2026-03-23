# Sphere Care — Quick Start

## Requirements

* Python 3.11+
* PostgreSQL (database: `spherecare`, password: `123`)

---

## First Time Setup

```bash
cd backend_api
python -m venv venv
```

### Activate virtual environment

**Windows:**

```bash
.\venv\Scripts\activate
```

**Mac / Linux:**

```bash
source venv/bin/activate
```

---

### Install dependencies

```bash
pip install -r requirements.txt
```

---

### Seed database

```bash
python seed.py
```

---

## Start Server

```bash
cd backend_api
```

**Windows:**

```bash
.\venv\Scripts\activate
```

**Mac / Linux:**

```bash
source venv/bin/activate
```

```bash
python app.py
```

---

## Open in Browser

http://localhost:8000

---

## Login

Register a new account or use seeded data.

To make an admin:

```sql
UPDATE users SET role = 'admin' WHERE email = 'your@email.com';
```

---

## API Docs

http://localhost:8000/docs

---

## Notes

* Always create a new `venv` on a new computer
* Do not copy `venv` from another machine
* Make sure PostgreSQL database `spherecare` exists
