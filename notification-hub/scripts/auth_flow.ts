
/*
E2E test for the Routed notification hub authentication flow.

Flow covered (verbose logging):
1) Start SMS-based authentication for a given phone number
2) Prompt for the code sent via SMS
3) Complete authentication using the provided code
4) Log the user and developer IDs upon success

Env vars:
- HUB_URL (default: https://routed.onrender.com)
- TEST_PHONE (required, e.g., +16505551212)
- TEST_COUNTRY (default: US)

Exit codes:
- 0 on success
- non-zero on any failure with a clear console message
*/

import fetchOrig from 'node-fetch';
import readline from 'readline';

const fetch = (fetchOrig as any) as typeof fetchOrig;

function log(msg: string) {
  const ts = new Date().toISOString();
  // eslint-disable-next-line no-console
  console.log(`[auth-e2e] ${ts} ${msg}`);
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

async function httpJson(url: string, init?: any) {
  const res = await fetch(url, init);
  const raw = await res.text().catch(() => '');
  let j: any = null; try { j = JSON.parse(raw); } catch {}
  return { res, json: j, raw };
}

async function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

async function main() {
  const BASE = env('HUB_URL', 'https://routed.onrender.com')!;
  const PHONE = requireEnv('TEST_PHONE');
  const COUNTRY = env('TEST_COUNTRY', 'US');

  log(`base=${BASE} phone=***${PHONE.slice(-4)} country=${COUNTRY}`);

  // 1) Start SMS authentication
  const startUrl = new URL('/v1/verify/start', BASE).toString();
  log(`verify/start → ${startUrl}`);
  const startRes = await httpJson(startUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: PHONE, country: COUNTRY }),
    cache: 'no-store',
  });

  if (!startRes.res.ok) {
    log(`start failed status=${startRes.res.status} body=${startRes.raw.slice(0,400)}`);
    process.exit(2);
  }
  log('verify/start ok');

  // 2) Prompt for the code
  const code = await prompt('Enter the code you received via SMS: ');

  // 3) Complete SMS authentication
  const completeUrl = new URL('/v1/verify/check', BASE).toString();
  log(`verify/check → ${completeUrl}`);
  const verifyRes = await httpJson(completeUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: PHONE, code: code }),
    cache: 'no-store',
  });

  if (!verifyRes.res.ok) {
    log(`verify/check failed status=${verifyRes.res.status} body=${verifyRes.raw.slice(0,400)}`);
    process.exit(2);
  }

  const userId = verifyRes.json?.userId;
  if (!userId) {
    log(`verify/check response missing userId: ${verifyRes.raw.slice(0,400)}`);
    process.exit(2);
  }
  log(`verify/check ok: userId=${userId}`);

  // 4) Complete auth and get devId
  const authUrl = new URL('/auth/complete-sms', BASE).toString();
  log(`auth/complete-sms → ${authUrl}`);
  const authRes = await httpJson(authUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: PHONE }),
    cache: 'no-store',
  });

  if (!authRes.res.ok) {
    log(`auth/complete-sms failed status=${authRes.res.status} body=${authRes.raw.slice(0,400)}`);
    process.exit(2);
  }

  const devId = authRes.json?.user?.devId;
  if (!devId) {
    log(`auth/complete-sms response missing devId: ${authRes.raw.slice(0,400)}`);
    process.exit(2);
  }
  log(`auth/complete-sms ok: devId=${devId}`);

  // 5) Provision developer sandbox
  const provUrl = new URL('/v1/dev/sandbox/provision', BASE).toString();
  log(`provision → ${provUrl}`);
  const provRes = await httpJson(provUrl, { method: 'POST', cache: 'no-store' });
  if (!provRes.res.ok) {
    log(`provision failed status=${provRes.res.status} body=${provRes.raw.slice(0,400)}`);
    process.exit(2);
  }
  const apiKey = provRes.json?.apiKey;
  if (!apiKey) {
    log(`provision response missing apiKey: ${provRes.raw.slice(0,400)}`);
    process.exit(2);
  }
  log(`provision ok`);

  // 6) Create a channel
  const createUrl = new URL('/v1/channels/create', BASE).toString();
  const chName = `e2e-${Date.now().toString(36)}`;
  const createRes = await httpJson(createUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({ name: chName, topic_name: 'runs.finished', allow_public: true }),
    cache: 'no-store',
  });

  if (!createRes.res.ok) {
    log(`channels/create failed status=${createRes.res.status} body=${createRes.raw.slice(0,400)}`);
    process.exit(2);
  }
  log(`channels/create ok`);
  log('E2E AUTH SUCCESS');
  process.exit(0);
}

main().catch((e) => {
  log(`FATAL: ${String(e?.message || e)}`);
  process.exit(1);
});

