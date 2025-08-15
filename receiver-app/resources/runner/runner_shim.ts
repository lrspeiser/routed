// Deno runner shim for Routed scripts
// Usage (spawned by the Electron app):
// deno run --quiet --allow-net --allow-read=<scriptDir> --allow-write=<scriptDir> runner_shim.ts \
//   --config <path/to/.runner/config.json> --entry <path/to/script.ts> --mode poller|webhook [--oneshot]

interface RunnerConfig {
  scriptId: string;
  hubBaseUrl: string;
  apiKey: string | null;
  defaultTopic?: string;
  dataDir: string;
  logLevel?: 'info' | 'debug' | 'warn' | 'error';
  port?: number | null; // for webhook mode (assigned by app later)
}

type Ctx = {
  notify: (msg: { title: string; body: string; payload?: unknown; topic?: string }) => Promise<void>;
  log: (...args: unknown[]) => void;
  dataDir: string;
};

type PollerModule = { handler?: (ctx: Ctx) => Promise<void> | void };
// Deno server will pass Request to onRequest
// deno-lint-ignore no-explicit-any
 type WebhookModule = { onRequest?: (req: Request, ctx: Ctx) => Promise<Response> | Response };

function ts(): string {
  return new Date().toISOString();
}

function redact(s: string): string {
  // Redact simple bearer tokens
  return s.replace(/Bearer\s+[A-Za-z0-9._-]+/g, 'Bearer **REDACTED**');
}

function parseArgs(argv: string[]) {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--oneshot') { out['oneshot'] = true; continue; }
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const v = argv[i + 1];
      if (v && !v.startsWith('--')) { out[k] = v; i++; } else { out[k] = 'true'; }
      continue;
    }
  }
  return out;
}

function toFileUrl(p: string): string {
  // Basic conversion that should work cross-platform
  // If already a file URL, return as is
  if (p.startsWith('file://')) return p;
  let path = p;
  if (!p.startsWith('/')) {
    // Make relative paths absolute from CWD
    path = `${Deno.cwd()}/${p}`;
  }
  // Windows drive letters
  if (/^[A-Za-z]:\\/.test(path)) {
    const replaced = path.replace(/\\/g, '/');
    return `file:///${replaced}`;
  }
  return `file://${path}`;
}

async function loadJson(path: string) {
  const txt = await Deno.readTextFile(path);
  return JSON.parse(txt);
}

async function main() {
  const args = parseArgs(Deno.args);
  const configPath = String(args['config'] || '');
  const entryPath = String(args['entry'] || '');
  const mode = String(args['mode'] || 'poller');
  const oneShot = Boolean(args['oneshot']);

  if (!configPath || !entryPath) {
    console.error(`[${ts()}] runner: missing --config or --entry`);
    Deno.exit(2);
  }

  let cfg: RunnerConfig;
  try {
    cfg = await loadJson(configPath) as RunnerConfig;
  } catch (e) {
    console.error(`[${ts()}] runner: failed to load config: ${e?.message || e}`);
    Deno.exit(2);
  }

  const log = (...a: unknown[]) => console.log(`[${ts()}][${cfg.scriptId}]`, ...a);

  const ctx: Ctx = {
    notify: async ({ title, body, payload, topic }) => {
      const url = new URL('/v1/messages', cfg.hubBaseUrl).toString();
      const data = { topic: topic || cfg.defaultTopic || 'runs.finished', title, body, payload: payload ?? null };
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 7000);
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(cfg.apiKey ? { 'Authorization': `Bearer ${cfg.apiKey}` } : {}),
          },
          body: JSON.stringify(data),
          signal: controller.signal,
        });
        const text = await res.text().catch(() => '');
        if (!res.ok) throw new Error(`notify failed status=${res.status} body=${text}`);
      } catch (e) {
        const msg = String(e?.message || e);
        log('notify error:', redact(msg));
        throw e;
      } finally {
        clearTimeout(t);
      }
    },
    log,
    dataDir: cfg.dataDir,
  };

  const modUrl = toFileUrl(entryPath);
  let mod: PollerModule & WebhookModule;
  try {
    // Dynamic import of the user script; cache-bust to pick up edits during testing
    mod = await import(`${modUrl}#${Date.now()}`);
  } catch (e) {
    console.error(`[${ts()}] runner: failed to import script: ${e?.message || e}`);
    Deno.exit(2);
  }

  if (mode === 'poller') {
    if (typeof mod.handler !== 'function') {
      console.error(`[${ts()}] runner: script missing export function handler(ctx)`);
      Deno.exit(2);
    }
    try {
      await mod.handler!(ctx);
      log('poller completed successfully');
      Deno.exit(0);
    } catch (e) {
      console.error(`[${ts()}] poller error: ${e?.message || e}`);
      Deno.exit(1);
    }
  } else if (mode === 'webhook') {
    if (typeof mod.onRequest !== 'function') {
      console.error(`[${ts()}] runner: script missing export function onRequest(req, ctx)`);
      Deno.exit(2);
    }
    const port = cfg.port && Number(cfg.port) > 0 ? Number(cfg.port) : 0; // 0 = random free port
    const handler = async (req: Request): Promise<Response> => {
      try {
        const res = await mod.onRequest!(req, ctx);
        return res instanceof Response ? res : new Response('OK');
      } catch (e) {
        console.error(`[${ts()}] webhook handler error: ${e?.message || e}`);
        return new Response('Internal Error', { status: 500 });
      }
    };
    const server = Deno.serve({ hostname: '127.0.0.1', port }, handler);
    log(`webhook listening on ${server.addr.hostname}:${(server.addr as Deno.NetAddr).port}`);
    if (oneShot) {
      // For a one-shot smoke test, run briefly and exit
      await new Promise((r) => setTimeout(r, 1500));
      log('webhook one-shot test done');
      Deno.exit(0);
    }
    // Keep running
    await server.finished;
  } else {
    console.error(`[${ts()}] runner: unknown mode '${mode}'`);
    Deno.exit(2);
  }
}

if (import.meta.main) {
  // Top-level await supported in Deno
  await main();
}

