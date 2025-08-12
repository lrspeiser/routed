# Routed

Monorepo containing the notification hub service and a Next.js playground for testing and demos.

## Deployed URLs

- Notification Hub (server): `https://routed.onrender.com/`
- Playground (Next.js app): `https://routed-gbiz.onrender.com/`

### Helpful endpoints

- Hub health: `https://routed.onrender.com/healthz`
- Playground self-test (SSE): `https://routed-gbiz.onrender.com/api/self-test/stream`
- Playground self-test (fallback JSON): `https://routed-gbiz.onrender.com/api/self-test`

The playground relies on the hub; ensure the playground service has `HUB_URL` set to `https://routed.onrender.com/` and a matching `HUB_ADMIN_TOKEN`.


