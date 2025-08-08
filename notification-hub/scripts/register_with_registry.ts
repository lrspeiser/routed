import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';

function parseArgs(argv: string[]) {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const val = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
      args[key] = val;
    }
  }
  return args;
}

function upsertEnv(filePath: string, updates: Record<string, string>) {
  let content = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
  const lines = content.split(/\r?\n/);
  const map = new Map<string, string>();
  for (const line of lines) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq > 0) map.set(line.slice(0, eq), line.slice(eq + 1));
  }
  for (const [k, v] of Object.entries(updates)) map.set(k, v);
  const out = Array.from(map.entries()).map(([k, v]) => `${k}=${v}`).join('\n') + '\n';
  fs.writeFileSync(filePath, out, 'utf8');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const registryUrl = args['registry-url'] || process.env.REGISTRY_URL;
  const adminToken = args['admin-token'] || process.env.REGISTRY_ADMIN_TOKEN;
  const baseUrl = args['base-url'] || process.env.BASE_URL || 'http://localhost:8080';

  if (!registryUrl || !adminToken) {
    console.error('Usage: npm run register:host -- --registry-url <url> --admin-token <token> [--base-url <url>]');
    process.exit(1);
  }

  console.log(`[REG][CLI] Registering host at registry=${registryUrl} baseUrl=${baseUrl}`);
  const regRes = await fetch(new URL('/v1/hosts/register', registryUrl).toString(), {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ base_url: baseUrl }),
  });
  if (!regRes.ok) {
    console.error('[REG][CLI] Register failed', regRes.status, await regRes.text());
    process.exit(1);
  }
  const reg = await regRes.json() as any;
  console.log('[REG][CLI] Registered host:', reg);

  const envPath = path.join(process.cwd(), '.env');
  upsertEnv(envPath, {
    HOST_ID: reg.host_id,
    REGISTRY_HOST_TOKEN: reg.host_token,
    REGISTRY_URL: registryUrl,
    BASE_URL: baseUrl,
  });
  console.log(`[REG][CLI] Updated ${envPath} with HOST_ID, REGISTRY_HOST_TOKEN, REGISTRY_URL, BASE_URL`);

  const vapidPublic = process.env.VAPID_PUBLIC || '';
  const beatRes = await fetch(new URL('/v1/hosts/heartbeat', registryUrl).toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ host_id: reg.host_id, host_token: reg.host_token, base_url: baseUrl, vapid_public: vapidPublic || null }),
  });
  if (!beatRes.ok) {
    console.warn('[REG][CLI] Heartbeat failed', beatRes.status, await beatRes.text());
  } else {
    console.log('[REG][CLI] Heartbeat OK');
  }

  const code = reg.code;
  const joinLink = `${registryUrl.replace(/\/$/, '')}/v1/hosts/resolve?code=${encodeURIComponent(code)}`;
  console.log('\n=== Join Info ===');
  console.log('Code:', code);
  console.log('Resolve URL:', joinLink);
  console.log('Client usage: Enter the Join Code and Registry URL in the web client, then click Join.');
}

main().catch((e) => {
  console.error('[REG][CLI] Fatal:', e);
  process.exit(1);
});
