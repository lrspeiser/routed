# Notification Hub (V1)

Fastify + BullMQ + Postgres + Redis notification router with TTLs, web push and sockets.

## Deployed URL

- Hub (prod): `https://routed.onrender.com/`
- Playground (demo): `https://routed-gbiz.onrender.com/`

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

## Database maintenance

### Check sizes and recent counts

Run with your `DATABASE_URL`:

```bash
psql "$DATABASE_URL" -c "SELECT relname AS table, pg_size_pretty(pg_total_relation_size(relid)) AS size FROM pg_catalog.pg_statio_user_tables ORDER BY pg_total_relation_size(relid) DESC;"

psql "$DATABASE_URL" -c "SELECT 'messages' AS t, COUNT(*) FROM messages UNION ALL SELECT 'deliveries', COUNT(*) FROM deliveries UNION ALL SELECT 'subscriptions', COUNT(*) FROM subscriptions UNION ALL SELECT 'devices', COUNT(*) FROM devices;"
```

### Clear all data (dangerous)

This truncates all hub tables and resets identities. Do not run in production unless intended.

```bash
psql "$DATABASE_URL" -f notification-hub/sql/clear.sql
```
