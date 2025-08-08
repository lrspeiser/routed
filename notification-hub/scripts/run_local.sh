#!/usr/bin/env bash
set -euo pipefail

# Root of project is this script's parent directory
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"

if ! command -v docker >/dev/null 2>&1; then
  echo "[RUN] Docker is required. Install Docker Desktop and retry." >&2
  exit 1
fi

# Work around missing credential helpers by using a local Docker config without credsStore
export DOCKER_CONFIG="${DOCKER_CONFIG:-$PROJECT_DIR/.docker-local}"
mkdir -p "$DOCKER_CONFIG"
if [[ ! -f "$DOCKER_CONFIG/config.json" ]]; then
  echo '{}' > "$DOCKER_CONFIG/config.json"
fi

# Bring up Postgres and Redis (no compose dependency)
if ! docker ps --format '{{.Names}}' | grep -q '^nh-postgres$'; then
  if docker ps -a --format '{{.Names}}' | grep -q '^nh-postgres$'; then
    echo "[RUN] Starting existing Postgres container nh-postgres…"
    docker start nh-postgres >/dev/null
  else
    echo "[RUN] Launching Postgres (container nh-postgres)…"
    docker run --name nh-postgres -e POSTGRES_PASSWORD=postgres -p 5432:5432 -d postgres:16 >/dev/null
  fi
fi

if ! docker ps --format '{{.Names}}' | grep -q '^nh-redis$'; then
  if docker ps -a --format '{{.Names}}' | grep -q '^nh-redis$'; then
    echo "[RUN] Starting existing Redis container nh-redis…"
    docker start nh-redis >/dev/null
  else
    echo "[RUN] Launching Redis (container nh-redis)…"
    docker run --name nh-redis -p 6379:6379 -d redis:7 redis-server --save '' --appendonly no >/dev/null
  fi
fi

# Wait for Postgres to be ready
echo "[RUN] Waiting for Postgres to accept connections…"
POSTGRES_CONT="nh-postgres"
for i in {1..30}; do
  if docker exec -i "$POSTGRES_CONT" pg_isready -U postgres >/dev/null 2>&1; then
    break
  fi
  sleep 1
  if [[ "$i" == 30 ]]; then
    echo "[RUN] Postgres did not become ready in time." >&2
    exit 1
  fi
done

# Create database if missing
if ! docker exec -i "$POSTGRES_CONT" psql -U postgres -tAc "SELECT 1 FROM pg_database WHERE datname='notification_hub'" | grep -q 1; then
  echo "[RUN] Creating database notification_hub…"
  docker exec -i "$POSTGRES_CONT" psql -U postgres -c "CREATE DATABASE notification_hub"
fi

# Apply schema by piping file into psql inside the container
echo "[RUN] Applying SQL schema…"
cat "$PROJECT_DIR/sql/schema.sql" | docker exec -i "$POSTGRES_CONT" psql -U postgres -d notification_hub -v ON_ERROR_STOP=1 >/dev/null

echo "[RUN] Installing Node dependencies…"
npm install

# Seed demo data
echo "[RUN] Seeding demo tenant/publisher/user/topic…"
NOTIFY_OUT=$(npm run -s seed || true)
echo "$NOTIFY_OUT"
TENANT_ID=$(echo "$NOTIFY_OUT" | awk -F"'" '/tenantId/ {print $2}' | tail -n1 || true)
USER_ID=$(echo "$NOTIFY_OUT" | awk -F"'" '/userId/ {print $2}' | tail -n1 || true)
API_KEY=$(echo "$NOTIFY_OUT" | awk -F"'" '/apiKey/ {print $2}' | tail -n1 || true)

if [[ -n "${TENANT_ID:-}" && -n "${USER_ID:-}" ]]; then
  echo "[RUN] Seeded tenantId=$TENANT_ID userId=$USER_ID apiKey=$API_KEY"
else
  echo "[RUN] Seed output parsed failed; check seed logs above."
fi

# Open the client
if command -v open >/dev/null 2>&1; then
  (sleep 1 && open "http://localhost:8080/") &
fi

echo "[RUN] Starting server (Ctrl+C to stop)…"
exec npm run dev
