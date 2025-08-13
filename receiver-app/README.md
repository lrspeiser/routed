# Routed Receiver App

This Electron app connects to a Routed hub server to receive notifications.

## Configure server (local-only)

You can set the server URL inside the app UI (Server field → Save Server) or by creating a local file that is not committed:

- Create `receiver-app/.server.local.json` (ignored by git) with:

```
{
  "baseUrl": "https://your.server",        // required; include path prefix if any
  "adminToken": "optional"                  // optional; used by Admin debug endpoints
}
```

Notes:
- The app persists the server URL you set in the UI, but this JSON allows you to keep a default for your development machine.
- Do not commit `.server.local.json`.

## Environment variables (build-time only)

Some .env values are used only during build/signing:
- APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID — for notarization
- HUB_URL — optional default base URL baked into the app at build time

At runtime, use the UI Server field or `.server.local.json`.

## Endpoints expected on the server
- Health: `GET /v1/health/deep` (preferred) or `GET /healthz`
- WebSockets: `wss://{host}/v1/socket` (or fallback `wss://{host}/socket`)
- Developer sandbox (optional, public in dev):
  - `POST /v1/dev/sandbox/provision`
  - `POST /v1/dev/users/ensure`
  - `POST /v1/dev/channels/create`
  - `GET  /v1/dev/channels/list?tenant_id=...`
- Admin debug (optional): `GET /v1/admin/debug/sockets` (Authorization: Bearer <adminToken>)

## Running
- Dev: `npm run dev` (from `receiver-app/`)
- Build DMG: `npm run dist`
- Notarize & staple (optional): `scripts/notarize_and_staple.sh`

