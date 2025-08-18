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
- Notarize \u0026 staple (optional): `scripts/notarize_and_staple.sh`

## Auth flow notes (recurring issue and fix)

Symptoms you may see
- App log shows: `auth:complete failed (no response)` even when `/v1/health/deep` is OK.
- Health is green but login doesn’t proceed.

Root cause
- The renderer requested `/v1/auth/complete-sms` but some deployments only expose `/auth/complete-sms` (or vice-versa). Previously, a non-200 caused the app to throw and return `null`, which the UI logs as “no response”.

Fix implemented
- The app now tries both paths: `/v1/auth/complete-sms` then `/auth/complete-sms`.
- If both fail, it returns `{ ok:false, error: ... }` instead of `null`. The UI can keep going: it ensures the user via dev/admin flows and connects WS using the verified userId.
- After a successful phone verification, we auto-provision a developer identity if missing (tenantId + apiKey) and persist it in the local dev store so subsequent API calls work.

What to check on the server (hub)
- Ensure the intended auth route is registered (versioned or unversioned). If running a limited route set, you may only have the unversioned path.
- Verify Twilio Verify env vars are set: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN (or API key SID/secret), TWILIO_VERIFY_SERVICE_SID.

Operational notes
- Phone placeholders do not include `+` because country dial code is selected in a dropdown and we normalize to E.164 automatically.
- Logs: macOS → `~/Library/Logs/routed.log` (search for `auth:complete` and `verify:` when debugging).

