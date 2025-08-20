/*
E2E smoke test for the Routed notification hub.

Flow covered (verbose logging):
1) Validate schema constraints the API relies on (users/phone, topics, channels, subscriptions uniques)
2) Provision developer sandbox (tenant + apiKey)
3) Ensure a user by phone and get userId
4) Create a public channel (auto-subscribe creator)
5) Subscribe the user to the channel (public route)
6) Open a WebSocket for the user and send a message to the channel's topic
7) Assert the message is received via WebSocket within a timeout

Env vars:
- HUB_URL (default: https://routed.onrender.com)
- HUB_ADMIN_TOKEN (optional; not required for dev sandbox route)
- TEST_PHONE (required, e.g., +16505551212)
- TEST_COUNTRY (default: US)

Exit codes:
- 0 on success
- non-zero on any failure with a clear console message
*/

import fetchOrig from 'node-fetch';
import WS from 'ws';

const fetch = (fetchOrig as any) as typeof fetchOrig;

function log(msg: string) {
  const ts = new Date().toISOString();
  // eslint-disable-next-line no-console
  console.log(`[e2e] ${ts} ${msg}`);
}

function env(name: string, dflt?: string): string | undefined {
  const v = process.env[name];
  return (v && v.trim()) || dflt;
}

function requireEnv(name: string): string {
  const v = env(name);
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout after ${ms}ms: ${label}`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

async function httpJson(url: string, init?: any) {
  const res = await fetch(url, init);
  const raw = await res.text().catch(() => '');
  let j: any = null; try { j = JSON.parse(raw); } catch {}
  return { res, json: j, raw };
}

function wsUrl(base: string, userId: string, path: string = '/v1/socket'): string {
  const u = new URL(base);
  const proto = u.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${u.host}${path}?user_id=${encodeURIComponent(userId)}`;
}

async function main() {
  const BASE = env('HUB_URL', 'https://routed.onrender.com')!;
  const ADMIN = env('HUB_ADMIN_TOKEN');
  const PHONE = requireEnv('TEST_PHONE');
  const COUNTRY = env('TEST_COUNTRY', 'US');

  log(`base=${BASE} phone=***${PHONE.slice(-4)} country=${COUNTRY}`);

  // 1) Schema validator (if route present)
  try {
    const healthSchema = new URL('/v1/health/schema', BASE).toString();
    const { res, json, raw } = await httpJson(healthSchema);
    if (res.status === 404) {
      log('health/schema route not found (older hub build); skipping schema check');
    } else if (!res.ok) {
      log(`health/schema failed status=${res.status} body=${raw.slice(0,400)}`);
      throw new Error('schema_check_failed');
    } else {
      const missing = Array.isArray(json?.missing) ? json.missing : [];
      log(`health/schema ok indexes=${(json?.checks?.indexes||[]).length} missing=${missing.length}`);
      if (missing.length > 0) {
        log(`MISSING: ${missing.join(', ')}`);
        log('Your DB is missing required unique constraints (likely root cause of ON CONFLICT errors).');
        log('Action: run: psql "$DATABASE_URL" -f notification-hub/sql/schema.sql');
        process.exit(2);
      }
    }
  } catch (e: any) {
    log(`schema check error: ${String(e?.message || e)}`);
    // Non-fatal; continue to exercise routes and fail with concrete evidence below
  }

  // 2) Provision developer sandbox
  const provPath = ADMIN ? '/v1/admin/sandbox/provision' : '/v1/dev/sandbox/provision';
  const provUrl = new URL(provPath, BASE).toString();
  log(`provision → ${provUrl} (admin=${!!ADMIN})`);
  const headers: any = ADMIN ? { Authorization: `Bearer ${ADMIN}` } : undefined;
  const prov = await httpJson(provUrl, { method: 'POST', headers, cache: 'no-store' });
  if (!prov.res.ok) {
    log(`provision failed status=${prov.res.status} body=${prov.raw.slice(0,400)}`);
    process.exit(2);
  }
  const tenantId = prov.json?.tenantId || prov.json?.tenant_id;
  const apiKey = prov.json?.apiKey || prov.json?.api_key;
  if (!tenantId || !apiKey) {
    log(`provision response missing tenantId/apiKey: ${prov.raw.slice(0,400)}`);
    process.exit(2);
  }
  log(`provision ok tenantId=${tenantId}`);

  // 3) Ensure user by phone, get userId
  const ensureUrl = new URL('/v1/users/ensure', BASE).toString();
  const eu = await httpJson(ensureUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({ phone: PHONE, topic: 'runs.finished' }),
    cache: 'no-store',
  });
  if (!eu.res.ok || !(eu.json?.userId)) {
    log(`users/ensure failed status=${eu.res.status} body=${eu.raw.slice(0,400)}`);
    process.exit(2);
  }
  const userId = eu.json.userId;
  log(`users/ensure ok userId=${userId}`);

  // 4) Create public channel
  const createUrl = new URL('/v1/channels/create', BASE).toString();
  const chName = `e2e-${Date.now().toString(36)}`;
  const cc = await httpJson(createUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({ name: chName, topic_name: 'runs.finished', allow_public: true, creator_phone: PHONE }),
    cache: 'no-store',
  });
  if (!cc.res.ok) {
    log(`channels/create failed status=${cc.res.status} body=${cc.raw.slice(0,400)}`);
    if (/no unique or exclusion constraint/.test(cc.raw)) {
      log('HINT: Apply DB schema: psql "$DATABASE_URL" -f notification-hub/sql/schema.sql');
    }
    process.exit(2);
  }
  // For some builds, the response may just be { ok:true } and require a follow-up list to get short_id
  let shortId: string | null = cc.json?.short_id || null;

  // 5) List channels to get topic and short_id
  const listUrl = new URL('/v1/channels/list', BASE).toString();
  const lc = await httpJson(listUrl, { headers: { Authorization: `Bearer ${apiKey}` }, cache: 'no-store' });
  if (!lc.res.ok) {
    log(`channels/list failed status=${lc.res.status} body=${lc.raw.slice(0,400)}`);
    process.exit(2);
  }
  const chan = (Array.isArray(lc.json?.channels) ? lc.json.channels : []).find((c: any) => c.name === chName) || null;
  if (!chan) {
    log(`created channel not found in list; list=${JSON.stringify(lc.json).slice(0,400)}`);
    process.exit(2);
  }
  shortId = shortId || chan.short_id;
  const topicName = chan.topic;
  if (!shortId || !topicName) {
    log(`missing short_id/topic after creation; chan=${JSON.stringify(chan)}`);
    process.exit(2);
  }
  log(`channel ok short_id=${shortId} topic=${topicName}`);

  // 6) Subscribe via public join
  const joinUrl = new URL(`/v1/public/channels/${encodeURIComponent(shortId)}/join`, BASE).toString();
  const join = await httpJson(joinUrl, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: PHONE }), cache: 'no-store'
  });
  if (!join.res.ok) {
    log(`public join failed status=${join.res.status} body=${join.raw.slice(0,400)}`);
    // continue; user may already be subscribed (creator)
  } else {
    log('public join ok');
  }

  // 7) WebSocket connect, then send a message
  // Prepare WS listener first
  const wsu = wsUrl(BASE, userId, '/v1/socket');
  log(`ws → ${wsu}`);
  const ws = new WS(wsu, { perMessageDeflate: false });
  let got = false;
  const waitMsg = new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => {
      if (!got) reject(new Error('no message received within 6s'));
    }, 6000);
    ws.on('open', () => log('ws open'));
    ws.on('message', (data) => {
      try {
        const j = JSON.parse(String(data));
        log(`ws message: ${String(data).slice(0,200)}`);
        if (j && j.title && j.body) { got = true; clearTimeout(t); resolve(); }
      } catch (e) { log(`ws parse error: ${String(e)}`); }
    });
    ws.on('error', (e) => log(`ws error: ${String((e as any)?.message || e)}`));
    ws.on('close', (code) => log(`ws close code=${code}`));
  });

  // Send message
  const sendUrl = new URL('/v1/messages', BASE).toString();
  const body = { topic: topicName, title: 'Routed', body: `E2E ${new Date().toISOString()}`, payload: { url: 'https://example.com' } };
  const send = await httpJson(sendUrl, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` }, body: JSON.stringify(body), cache: 'no-store'
  });
  if (!send.res.ok) {
    log(`send failed status=${send.res.status} body=${send.raw.slice(0,400)}`);
    process.exit(2);
  }
  log('send ok; waiting for WS delivery...');

  await withTimeout(waitMsg, 8000, 'ws delivery');
  log('ws delivery ok');

  ws.close();
  log('E2E SUCCESS');
  process.exit(0);
}

main().catch((e) => {
  log(`FATAL: ${String(e?.message || e)}`);
  process.exit(1);
});
