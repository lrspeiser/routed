# Routed Script Authoring Guide (for GPT-5)

Goal: Generate a single-file TypeScript script that runs under Deno inside the Routed desktop app.

Runtime
- Deno is launched with strict flags (net allowed, read/write only in the script folder). No env access.
- The app injects a context object: ctx with:
  - async ctx.notify({ title, body, payload?, topic? }): Post a notification via Routed Hub. topic defaults to the script manifest’s defaultTopic.
  - ctx.log(...args): Use console.log for most logs; stdout/stderr are captured to a rolling log.
  - ctx.dataDir: Path for per-script local storage (read/write permitted).

Entry points
- Poller mode: export async function handler(ctx) { ... }
- Webhook mode: export async function onRequest(req, ctx): Promise<Response>
  - Return a Response, e.g., new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json' } })

Constraints and best practices
- No external npm imports. Use built-in fetch, URL, crypto, TextEncoder/Decoder, etc.
- Be concise and robust: add timeouts, catch errors, and surface meaningful messages in ctx.notify bodies.
- For fetch requests:
  - Use AbortController for a 5–10s timeout.
  - Handle non-2xx with useful error text.
- For JSON parsing: wrap in try/catch or use .json().catch(() => ({})).
- Do not read environment variables. Persist state to files under ctx.dataDir if needed.
- Keep outputs small: titles under ~60 chars, bodies under a few hundred chars.
- Prefer const, async/await, and avoid global state that grows unbounded.

Patterns
- Polling example:
  export async function handler(ctx) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch('https://api.example.com/status', { signal: controller.signal });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = await res.json().catch(() => ({}));
      await ctx.notify({ title: 'Check complete', body: `value=${data.value}` });
    } catch (e) {
      ctx.log('poll error', String(e?.message || e));
    } finally { clearTimeout(t); }
  }

- Webhook example:
  export async function onRequest(req, ctx) {
    const body = await req.json().catch(() => ({}));
    await ctx.notify({ title: 'Webhook', body: JSON.stringify(body).slice(0, 200) });
    return new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json' } });
  }

- File storage example:
  // Persist a cursor under ctx.dataDir
  // Deno APIs allowed for read/write within the script folder
  const cursorPath = `${ctx.dataDir}/cursor.json`;
  let cursor = 0;
  try { cursor = JSON.parse(await Deno.readTextFile(cursorPath)).cursor || 0; } catch {}
  // ... update cursor ...
  await Deno.writeTextFile(cursorPath, JSON.stringify({ cursor }));

Notifications
- ctx.notify({ title, body, payload?, topic? }) posts to the hub.
- Prefer including a link only when helpful: payload: { url: 'https://...' }.

Testing
- Poller: the app’s Test runs handler(ctx) once.
- Webhook: enable the script and POST sample JSON to http://127.0.0.1:<port>/.

