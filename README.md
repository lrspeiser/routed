# Routed

A small monorepo for real-time notifications. It includes:
- notification-hub: Fastify + BullMQ service backed by Postgres + Redis
- playground: Next.js demo to exercise the hub and run self-tests
- receiver-app: Electron desktop app that receives notifications and runs user scripts
- ws-probe: Minimal HTTP + WebSocket probe for diagnostics
- packages: Shared TypeScript packages (core, runtime-service, adapters)

Deployed surfaces
- Hub (prod): https://routed.onrender.com
  - Health: GET /healthz and GET /healthz-deep
- Playground: https://routed-gbiz.onrender.com
  - Self-test: /api/self-test and /api/self-test/stream

## Contents
- Quick start (local stack)
- Routed CLI
- Role guides: User, Developer, Script Maker
- Components overview
- Environment variables
- Commands & workflows
- Testing & CI parity
- Admin Testing Suite
- Recent updates
- Troubleshooting

## Quick start (local stack via Docker)
- Requirements: Docker Desktop
- Start everything (Postgres + Redis + Hub):
  ```bash
  docker compose -f notification-hub/docker-compose.yml up --build
  ```
- Hub will listen on http://localhost:8080
- Health checks:
  ```bash
  curl -s http://localhost:8080/healthz
  curl -s http://localhost:8080/healthz-deep
  ```

## Routed CLI
A convenient command-line interface is available for common tasks:
- Installation: The `routed` script is in the project root
- Make it executable: `chmod +x routed`
- Usage: `./routed <command> [options]`
- Examples:
  ```bash
  ./routed hub start         # Start the notification hub dev server
  ./routed docker up         # Run full stack with Docker
  ./routed playground start  # Start the playground demo
  ./routed receiver build    # Build unsigned DMG
  ```
- Run `./routed help` for full command list

## Role guides

### 1) User (trying the system quickly)
- Use the hosted demo playground:
  - https://routed-gbiz.onrender.com
  - Click Run Self-Test to verify connectivity and message delivery.
- Or run playground locally:
  ```bash
  cd playground
  npm ci
  export HUB_URL=https://routed.onrender.com
  export HUB_ADMIN_TOKEN={{HUB_ADMIN_TOKEN}}
  npm run dev
  ```
  - Open http://localhost:3000 and use Self-Test, Create Channel, and Send Message flows.

### 2) Developer (working on services/apps)
- **notification-hub**
  ```bash
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
  
  # Registry host registration (optional)
  npm run register:host -- --registry-url https://registry.example.com --admin-token {{REGISTRY_ADMIN_TOKEN}} --base-url https://your-hub.example.com
  ```

- **playground**
  ```bash
  cd playground && npm ci
  export HUB_URL=https://routed.onrender.com
  export HUB_ADMIN_TOKEN={{HUB_ADMIN_TOKEN}}
  npm run dev
  ```

- **receiver-app (Electron)**
  ```bash
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
  
  # Runtime server config (local-only)
  # Create receiver-app/.server.local.json with the following content:
  # { "baseUrl": "https://your.server", "adminToken": "optional" }
  ```

### 3) Script Maker (Electron scripts orchestrator)
- Purpose: author small pollers/webhooks that can notify you via the hub.
- Prereq: receiver-app installed or running from source.
- Script generation: The app now includes AI-powered script generation:
  - Uses OpenAI API to generate custom notification scripts
  - Configure with OPENAI_API_KEY or OPEN_AI_KEY environment variable
  - Access via receiver-app/scripts/ai_generate_local.js
- Deno runtime: place the appropriate deno binary under receiver-app/resources/bin
  - macOS arm64: deno-darwin-arm64
  - macOS x64:   deno-darwin-x64
  - Windows:     deno.exe (notarization not required for dev)
  - Linux:       deno-linux
- Script execution now uses isolated-vm for secure sandboxed execution
- In the app (dev flow via IPC commands in main.js):
  - Create a new script (poller default) → generates scripts/<id>/script.ts and manifest.json
  - Enable the script → poller runs on interval, webhook runs a local HTTP server
  - Use ctx.notify({ title, body, payload?, topic? }) from your script to send notifications
- Runtime config for scripts is written to scripts/<id>/.runner/config.json, which includes hub base URL and developer apiKey if available.
- On macOS, app logs are at ~/Library/Logs/routed.log.

## Components overview (big picture)
- **notification-hub** (Node 20, Fastify v4)
  - Entry: notification-hub/src/index.ts
    - Registers routes: messages (publish API), webpush, websocket (/v1/socket), admin*, dev*, auth/verify*, health, static assets.
    - setupWs shares the HTTP server for WebSocket connections.
    - Background cron: TTL sweeper to expire messages.
    - Optional registry heartbeat if REGISTRY_URL/HOST_ID/REGISTRY_HOST_TOKEN are set.
    - Public config endpoint exposes the VAPID public key for clients.
  - Data model (notification-hub/sql/schema.sql): tenants, publishers, topics, users, subscriptions, channels, devices, messages, deliveries (+ indexes).
  - Delivery flow: publisher → POST /v1/messages → enqueued → fanout worker resolves audience → deliver worker sends via WebPush/WebSocket → failures to DLQ with replay.

- **playground** (Next.js)
  - app/page.tsx drives sandbox provisioning, channel creation, quick sends, and presence; server-side /api/* proxy to hub.
  - Requires HUB_URL and HUB_ADMIN_TOKEN.

- **receiver-app** (Electron)
  - main.js implements the desktop receiver and a small "Scripts Orchestrator".
  - Uses hub endpoints for health, verification, channels, debug; maintains a local dev store and writes logs.
  - Bundles extraResources via electron-builder (assets and optional AI config files).
  - Notification click opens deep links if payload.url is present.
  - Now uses custom routed icons (routed.icns) for the DMG installer and app.
  - Version 1.9.9 includes improved error handling and WebSocket push fixes.

- **ws-probe**
  - Minimal HTTP + WS server on the same port (used for platform probing/diagnostics).

## Environment variables
- **notification-hub** (required)
  - DATABASE_URL, REDIS_URL, VAPID_PUBLIC, VAPID_PRIVATE, VAPID_SUBJECT, DEFAULT_TTL_SEC
  - Optional: HOST_ID, REGISTRY_HOST_TOKEN, REGISTRY_URL, BASE_URL, LATEST_DMG_URL
- **playground**
  - HUB_URL, HUB_ADMIN_TOKEN
- **receiver-app**
  - Runtime hub base URL via UI or receiver-app/.server.local.json
  - Build-time notarization (macOS): APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID

## Commands & workflows (cheatsheet)
- Local full stack via Docker:
  ```bash
  docker compose -f notification-hub/docker-compose.yml up --build
  ```
- Hub dev:
  ```bash
  # (in notification-hub)
  npm run dev
  ```
- Hub integration test (against deployed hub):
  ```bash
  export HUB_URL=https://routed.onrender.com
  export HUB_ADMIN_TOKEN={{HUB_ADMIN_TOKEN}}
  # (in notification-hub)
  npm run test:integration
  ```
- Playground dev:
  ```bash
  # (in playground)
  npm run dev
  ```
- Receiver dev / tests:
  ```bash
  # (in receiver-app)
  npm run dev
  TEST_MODE=1 npm run test
  ```

## Testing & CI parity
- CI workflow: .github/workflows/hub-integration.yml
  - Runs notification-hub/scripts/integration.ts against HUB_URL using HUB_ADMIN_TOKEN
- Reproduce locally:
  ```bash
  cd notification-hub && npm ci
  export HUB_URL=https://routed.onrender.com
  export HUB_ADMIN_TOKEN={{HUB_ADMIN_TOKEN}}
  npm run test:integration
  ```

## Admin Testing Suite
Comprehensive test scripts for admin functionality and message sending/receiving:

### Primary Admin Test Scripts
- **test-admin-apis.js** - Complete admin API testing
  - Tests against production: https://routed.onrender.com
  - Creates channels, users, sends messages
  - Tests public/private channels and scripts
  - Verifies message delivery via WebSocket
  ```bash
  export HUB_ADMIN_TOKEN={{HUB_ADMIN_TOKEN}}
  node test-admin-apis.js
  ```

- **test-admin-apis-simple.js** - Streamlined admin testing
  - Simplified test flow with better error handling
  - Health checks and version verification
  - Channel creation and user management
  ```bash
  node test-admin-apis-simple.js
  ```

- **quick-message-test.js** - Quick production verification
  - Rapid health check and message test
  - Developer provisioning with API key generation
  - Channel creation and message sending
  - Minimal dependencies, fast execution
  ```bash
  node quick-message-test.js
  ```

- **notification-hub/test-backend-admin.js** - Core backend testing
  - Database operations and schema validation
  - WebSocket connection testing
  - Message fanout and delivery verification
  - Includes retry logic for transaction errors
  ```bash
  cd notification-hub
  export HUB_ADMIN_TOKEN={{HUB_ADMIN_TOKEN}}
  node test-backend-admin.js
  ```

### Comprehensive Demo & Inspection
- **full-admin-demo.js** - Complete workflow demonstration
  - Step-by-step admin API demonstration
  - Multiple channel configurations
  - User subscription management
  - Message sending with detailed logging
  ```bash
  node full-admin-demo.js
  ```

- **inspect-admin-data.js** - Data inspection tool
  - Tenant data verification
  - Channel listing and analysis
  - User subscription inspection
  - Server configuration status
  ```bash
  node inspect-admin-data.js
  ```

### Interactive & Automated Testing
- **notification-hub/run-admin-test.js** - Puppeteer-based testing
  - Automated browser testing
  - Uses web interface at /test-admin.html
  - Screenshot capture for results
  ```bash
  cd notification-hub
  node run-admin-test.js
  ```

- **notification-hub/scripts/test_send_message.js** - Message testing
  - Direct channel message testing
  - Script execution with webhooks
  - Real-time delivery verification
  ```bash
  cd notification-hub
  node scripts/test_send_message.js
  ```

### UI Button Testing
- **test-all-buttons.js** - Comprehensive button functionality test
  - Tests all UI buttons from Playground, Receiver app, and Admin interface
  - Validates backend endpoints for each button action
  - WebSocket connection testing
  - Full coverage of user interactions
  ```bash
  npm install ws  # First time only
  node test-all-buttons.js
  ```

- **test-essential-buttons.js** - Quick essential button test
  - Rapid testing of core button functionalities
  - Health check, channel creation, message sending
  - User management and channel subscription
  - Faster execution for quick validation
  ```bash
  node test-essential-buttons.js
  ```

### Authentication & Configuration
- **Admin Token**: Set via `HUB_ADMIN_TOKEN` environment variable
  - Default: `33925b5f5b9a2bd3d5a01f2b5857ce73`
- **Admin Phone**: `+16505551212` for SMS authentication
- **API Keys**: Generated through developer sandbox provisioning
- **Test Endpoints**: `/v1/admin/*` routes require admin authentication

### Testing Capabilities
- **Database Operations**: User/channel creation, subscriptions, schema validation
- **Message Delivery**: WebSocket, SMS (Twilio), push notifications
- **Channel Management**: Public/private channels, member management
- **Script Execution**: Channel scripts and webhook testing
- **Queue Operations**: Message fanout, retry mechanisms, DLQ handling
- **Real-time Features**: WebSocket connections, presence tracking

## Recent updates (v1.9.9)
- Added routed CLI wrapper for convenient command-line access
- Implemented AI-powered script generation using OpenAI API
- Switched to isolated-vm for secure script execution
- Fixed WebSocket push error handling and duplicate member display
- Added custom routed icons for DMG installer and app
- Improved error handling for authentication and channel member loading
- Added TypeScript packages: core, runtime-service, adapters
- Fixed node-fetch ESM compatibility (downgraded to v2 for CommonJS)
- Enhanced debugging for fetch operations in isolated-vm scripts

## Troubleshooting
- **Shell pitfalls** (common copy/paste issues)
  - Unmatched quotes; ensure straight quotes ' and " only
  - Curly "smart quotes" cause syntax errors — replace " " ' with straight quotes
  - Trailing backslash (\\) continues a command unexpectedly — remove it
  - Leading $, #, or > characters from docs are prompts/quote markers — strip them
- **Postgres**
  - Verify DATABASE_URL and that schema was applied: `psql "$DATABASE_URL" -f sql/schema.sql`
- **Redis**
  - Verify REDIS_URL and connectivity: (in notification-hub) `npm run test:redis`
- **VAPID**
  - Hub needs VAPID_PUBLIC, VAPID_PRIVATE, VAPID_SUBJECT to deliver WebPush
- **WebSocket**
  - Hub WS endpoint: wss://<host>/v1/socket (playground and receiver rely on this)
- **Receiver notifications (macOS)**
  - If notifications don't appear, check System Settings → Notifications for the app and view logs at ~/Library/Logs/routed.log

## Notes
- Large binaries via Git LFS only. The hub can redirect downloads to a hosted DMG via LATEST_DMG_URL.
- Use straight quotes in commands and avoid leading shell prompt characters.
