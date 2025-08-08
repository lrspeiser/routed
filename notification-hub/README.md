# Notification Hub (V1)

Fastify + BullMQ + Postgres + Redis notification router with TTLs, web push and sockets.

## Quickstart

1. Copy `.env.example` to `.env` and set `DATABASE_URL` and `REDIS_URL`.
2. Create schema:

```sh
psql "$DATABASE_URL" -f sql/schema.sql
```

3. Install and run:

```sh
npm install
npm run dev
```

4. Open client at `http://localhost:8080/`, enter the seeded `tenantId` and `userId`, click Start.

5. Publish from Python using `python/notifications.py` helper.

## Public Config

`GET /v1/config/public` returns `{ vapid_public }` consumed by the client.

## DLQ

- Failed delivery jobs after attempts land in `deliver-dlq`.
- Replay all: `POST /v1/admin/dlq/replay`.

## Docker

Local stack (Postgres, Redis, app):

```sh
docker compose up --build
```
