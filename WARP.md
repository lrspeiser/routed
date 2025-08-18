# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

Routed monorepo: notification hub service (Fastify + BullMQ + Postgres + Redis), a Next.js playground, a small websocket probe, and an Electron receiver app.

Commands you’ll actually use

- notification-hub
  - Setup
    - cd notification-hub
    - npm ci
  - Dev server
    - npm run dev
  - Build and run
    - npm run build
    - npm start
  - Typecheck
    - npm run typecheck
  - Database (Postgres)
    - export DATABASE_URL=postgres://user:pass@host:5432/notification_hub
    - psql "$DATABASE_URL" -f sql/schema.sql
    - To clear all data (dangerous): psql "$DATABASE_URL" -f sql/clear.sql
  - Seed demo data
    - npm run seed
  - Integration checks (against a running hub)
    - export HUB_URL=https://routed.onrender.com
    - export HUB_ADMIN_TOKEN={{HUB_ADMIN_TOKEN}}
    - npm run test:integration
  - Redis connectivity sanity check
    - export REDIS_URL=redis://127.0.0.1:6379
    - npm run test:redis
  - Registry host registration (optional)
    - npm run register:host -- --registry-url https://registry.example.com --admin-token {{REGISTRY_ADMIN_TOKEN}} --base-url https://your-hub.example.com
  - Local stack via Docker (Postgres + Redis + app)
    - docker compose -f notification-hub/docker-compose.yml up --build

- playground (Next.js demo)
  - Setup and dev
    - cd playground
    - npm ci
    - export HUB_URL=https://routed.onrender.com
    - export HUB_ADMIN_TOKEN={{HUB_ADMIN_TOKEN}}
    - npm run dev
  - Build and start
    - npm run build
    - npm start
  - Typecheck
    - npm run typecheck

- receiver-app (Electron)
  - Dev
    - cd receiver-app
    - npm ci
    - npm run dev
  - Build DMG (unsigned)
    - npm run dist
  - Signed/notarized build (macOS)
    - npx dotenv -e .env -- npm run dist:sign  (expects APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID in env)
  - Tests (Vitest)
    - Run all: TEST_MODE=1 npm run test
    - Watch: TEST_MODE=1 npx vitest
    - Single file: TEST_MODE=1 npx vitest run path/to/test.ts
    - Single test name: TEST_MODE=1 npx vitest run -t "test name"
  - E2E (Playwright)
    - npx playwright test -c tests/e2e/playwright.electron.config.ts
  - Runtime server config (local-only)
    - Create receiver-app/.server.local.json with { "baseUrl": "https://your.server", "adminToken": "optional" }

- ws-probe
  - cd ws-probe && npm ci && npm start

- Reproduce CI “Hub Integration Test” locally
  - cd notification-hub && npm ci
  - export HUB_URL=https://routed.onrender.com
  - export HUB_ADMIN_TOKEN={{HUB_ADMIN_TOKEN}}
  - npm run test:integration

Deployed URLs and quick health
- Hub (prod): https://routed.onrender.com
  - GET /healthz and GET /healthz-deep
- Playground: https://routed-gbiz.onrender.com
  - Self-test: /api/self-test and /api/self-test/stream

Big-picture architecture

- notification-hub (Node 20, Fastify v4)
  - Entry: src/index.ts
    - Registers routes: messages (publish API), webpush, websocket (/v1/socket), admin*, dev*, auth/verify*, health, plus static assets.
    - setupWs shares the HTTP server for WebSocket connections.
    - Background cron: TTL sweeper to expire messages.
    - Optional heartbeat to an external registry if REGISTRY_URL/HOST_ID/REGISTRY_HOST_TOKEN set.
  - Data model (sql/schema.sql)
    - tenants, publishers, topics, users, subscriptions, channels, devices, messages, deliveries (+ indexes).
  - Delivery flow
    - Publisher POST /v1/messages → enqueue
    - Fanout worker (src/workers/fanout) resolves audience from subscriptions
    - Deliver worker (src/workers/deliver) pushes via WebPush and WebSocket
    - Failures land in a DLQ with replay endpoints
  - Public config endpoint exposes VAPID public key for clients.

- playground (Next.js)
  - Purpose: exercise the hub for demos and self-tests.
  - app/page.tsx coordinates sandbox provisioning, channel creation, quick-sends, and presence; server-side /api/* routes proxy to hub.
  - Requires HUB_URL and HUB_ADMIN_TOKEN to be set in the server env.

- receiver-app (Electron)
  - main.js implements the desktop receiver and a small “Scripts Orchestrator”.
  - Uses hub endpoints for health, verification, channels, debug; persists a local dev store and writes logs (see ~/Library/Logs/routed.log on macOS).
  - Bundles extraResources (assets and optional AI config files) via electron-builder.
  - Notifications open deep links via shell.openExternal when payload.url is present.

- ws-probe
  - Minimal HTTP + WS server on the same port (used for platform probing/diagnostics).

Environment notes
- notification-hub expects: DATABASE_URL, REDIS_URL, DEFAULT_TTL_SEC, VAPID_PUBLIC, VAPID_PRIVATE, VAPID_SUBJECT
  - Optional: HOST_ID, REGISTRY_HOST_TOKEN, REGISTRY_URL, BASE_URL, LATEST_DMG_URL
- playground expects: HUB_URL and HUB_ADMIN_TOKEN
- receiver-app runtime hub URL can be set via UI or receiver-app/.server.local.json; build-time notarization uses APPLE_* env vars.

Repo-specific practices
- Large binaries should use Git LFS. The hub exposes a redirect for latest DMG via LATEST_DMG_URL; avoid committing installer artifacts directly.
- When pasting commands, use straight quotes and avoid leading $/> markers; do not leave trailing backslashes.

