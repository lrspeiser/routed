# Routed

A small monorepo for real-time notifications. It includes:
- notification-hub: Fastify + BullMQ service backed by Postgres + Redis
- playground: Next.js demo to exercise the hub and run self-tests
- receiver-app: Electron desktop app that receives notifications and runs user scripts
- ws-probe: Minimal HTTP + WebSocket probe for diagnostics

Deployed surfaces
- Hub (prod): https://routed.onrender.com
  - Health: GET /healthz and GET /healthz-deep
- Playground: https://routed-gbiz.onrender.com
  - Self-test: /api/self-test and /api/self-test/stream

Contents
- Quick start (local stack)
- Role guides: User, Developer, Script Maker
- Components overview
- Environment variables
- Commands & workflows
- Testing & CI parity
- Troubleshooting

Quick start (local stack via Docker)
- Requirements: Docker Desktop
- Start everything (Postgres + Redis + Hub):
  docker compose -f notification-hub/docker-compose.yml up --build
- Hub will listen on http://localhost:8080
- Health checks:
  curl -s http://localhost:8080/healthz
  curl -s http://localhost:8080/healthz-deep

Role guides

1) User (trying the system quickly)
- Use the hosted demo playground:
  - https://routed-gbiz.onrender.com
  - Click Run Self-Test to verify connectivity and message delivery.
- Or run playground locally:
  cd playground
  npm ci
  export HUB_URL=https://routed.onrender.com
  export HUB_ADMIN_TOKEN={{HUB_ADMIN_TOKEN}}
  npm run dev
  - Open http://localhost:3000 and use Self-Test, Create Channel, and Send Message flows.

2) Developer (working on services/apps)
- notification-hub
  cd notification-hub
  npm ci
  # Database
  export DATABASE_URL=postgres://user:pass@host:5432/notification_hub
  psql "$DATABASE_URL" -f sql/schema.sql
  # Dev server
  npm run dev
  # Build & run
  npm run build && npm start
  # Typecheck
  npm run typecheck
  # Seed demo data
  npm run seed
  # Integration test against a running hub (deployed or local)
  export HUB_URL=https://routed.onrender.com
  export HUB_ADMIN_TOKEN={{HUB_ADMIN_TOKEN}}
  npm run test:integration
  # Redis sanity
  export REDIS_URL=redis://127.0.0.1:6379
  npm run test:redis

- playground
  cd playground && npm ci
  export HUB_URL=https://routed.onrender.com
  export HUB_ADMIN_TOKEN={{HUB_ADMIN_TOKEN}}
  npm run dev

- receiver-app (Electron)
  cd receiver-app && npm ci
  npm run dev
  # Build DMG (unsigned)
  npm run dist
  # Signed/notarized build (macOS): expects APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID in env
  npx dotenv -e .env -- npm run dist:sign
  # Tests (Vitest)
  TEST_MODE=1 npm run test
  TEST_MODE=1 npx vitest           # watch
  TEST_MODE=1 npx vitest run -t "test name"   # single test
  # E2E (Playwright)
  npx playwright test -c tests/e2e/playwright.electron.config.ts

3) Script Maker (Electron scripts orchestrator)
- Purpose: author small pollers/webhooks that can notify you via the hub.
- Prereq: receiver-app installed or running from source.
- Deno runtime: place the appropriate deno binary under receiver-app/resources/bin
  - macOS arm64: deno-darwin-arm64
  - macOS x64:   deno-darwin-x64
  - Windows:     deno.exe (notarization not required for dev)
  - Linux:       deno-linux
- In the app (dev flow via IPC commands in main.js):
  - Create a new script (poller default) → generates scripts/<id>/script.ts and manifest.json
  - Enable the script → poller runs on interval, webhook runs a local HTTP server
  - Use ctx.notify({ title, body, payload?, topic? }) from your script to send notifications
- Runtime config for scripts is written to scripts/<id>/.runner/config.json, which includes hub base URL and developer apiKey if available.
- On macOS, app logs are at ~/Library/Logs/routed.log.

Components overview (big picture)
- notification-hub (Node 20, Fastify v4)
  - Entry: notification-hub/src/index.ts
    - Registers routes: messages (publish API), webpush, websocket (/v1/socket), admin*, dev*, auth/verify*, health, static assets.
    - setupWs shares the HTTP server for WebSocket connections.
    - Background cron: TTL sweeper to expire messages.
    - Optional registry heartbeat if REGISTRY_URL/HOST_ID/REGISTRY_HOST_TOKEN are set.
  - Data model (notification-hub/sql/schema.sql): tenants, publishers, topics, users, subscriptions, channels, devices, messages, deliveries (+ indexes).
  - Delivery flow: publisher → POST /v1/messages → enqueued → fanout worker resolves audience → deliver worker sends via WebPush/WebSocket → failures to DLQ with replay.

- playground (Next.js)
  - app/page.tsx drives sandbox provisioning, channel creation, quick sends, and presence; server-side /api/* proxy to hub.
  - Requires HUB_URL and HUB_ADMIN_TOKEN.

- receiver-app (Electron)
  - main.js implements the desktop receiver and a small “Scripts Orchestrator”.
  - Uses hub endpoints for health, verification, channels, debug; maintains a local dev store and writes logs.
  - Bundles extraResources via electron-builder (assets and optional AI config files).
  - Notification click opens deep links if payload.url is present.

- ws-probe
  - Minimal Express + ws server for platform diagnostics sharing one HTTP server.

Environment variables
- notification-hub (required)
  - DATABASE_URL, REDIS_URL, VAPID_PUBLIC, VAPID_PRIVATE, VAPID_SUBJECT, DEFAULT_TTL_SEC
  - Optional: HOST_ID, REGISTRY_HOST_TOKEN, REGISTRY_URL, BASE_URL, LATEST_DMG_URL
- playground
  - HUB_URL, HUB_ADMIN_TOKEN
- receiver-app
  - Runtime hub base URL via UI or receiver-app/.server.local.json
  - Build-time notarization (macOS): APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID

Commands & workflows (cheatsheet)
- Local full stack via Docker:
  docker compose -f notification-hub/docker-compose.yml up --build
- Hub dev:
  (in notification-hub) npm run dev
- Hub integration test (against deployed hub):
  export HUB_URL=https://routed.onrender.com
  export HUB_ADMIN_TOKEN={{HUB_ADMIN_TOKEN}}
  (in notification-hub) npm run test:integration
- Playground dev:
  (in playground) npm run dev
- Receiver dev / tests:
  (in receiver-app) npm run dev
  TEST_MODE=1 npm run test

Testing & CI parity
- CI workflow: .github/workflows/hub-integration.yml
  - Runs notification-hub/scripts/integration.ts against HUB_URL using HUB_ADMIN_TOKEN
- Reproduce locally:
  cd notification-hub && npm ci
  export HUB_URL=https://routed.onrender.com
  export HUB_ADMIN_TOKEN={{HUB_ADMIN_TOKEN}}
  npm run test:integration

Troubleshooting
- Shell pitfalls (common copy/paste issues)
  - Unmatched quotes; ensure straight quotes ' and " only
  - Curly “smart quotes” cause syntax errors — replace “ ” ’ with straight quotes
  - Trailing backslash (\) continues a command unexpectedly — remove it
  - Leading $, #, or > characters from docs are prompts/quote markers — strip them
- Postgres
  - Verify DATABASE_URL and that schema was applied: psql "$DATABASE_URL" -f sql/schema.sql
- Redis
  - Verify REDIS_URL and connectivity: (in notification-hub) npm run test:redis
- VAPID
  - Hub needs VAPID_PUBLIC, VAPID_PRIVATE, VAPID_SUBJECT to deliver WebPush
- WebSocket
  - Hub WS endpoint: wss://<host>/v1/socket (playground and receiver rely on this)
- Receiver notifications (macOS)
  - If notifications don’t appear, check System Settings → Notifications for the app and view logs at ~/Library/Logs/routed.log

Notes
- Large binaries via Git LFS only. The hub can redirect downloads to a hosted DMG via LATEST_DMG_URL.
- Use straight quotes in commands and avoid leading shell prompt characters.

