#!/bin/sh
set -e

if [ -n "${DATABASE_URL}" ]; then
  echo "Waiting for PostgreSQL..."
  python - <<'PY'
import os
import sys
import time

url = os.environ.get("DATABASE_URL", "")
if not url:
    sys.exit(0)

try:
    import psycopg2
except ImportError:
    sys.exit(0)

for attempt in range(60):
    try:
        conn = psycopg2.connect(url)
        conn.close()
        print("PostgreSQL is ready.")
        break
    except Exception:
        time.sleep(2)
else:
    print("Timed out waiting for PostgreSQL.", file=sys.stderr)
    sys.exit(1)
PY
fi

exec "$@"
