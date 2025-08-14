import fetch from 'node-fetch';

const BASE_URL = process.env.BASE_URL || 'https://routed.onrender.com';
const ADMIN_TOKEN = process.env.HUB_ADMIN_TOKEN || '';

async function jfetch(url: string, init: any = {}) {
  const res = await fetch(url, init);
  const text = await res.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}\nBody: ${text}`);
  }
  return body;
}

async function main() {
  console.log('[TEST] BASE_URL =', BASE_URL);

  // Health
  const deep = await jfetch(`${BASE_URL}/v1/health/deep`);
  if (!deep || deep.status !== 'ok') throw new Error('Health check failed');
  console.log('[TEST] health ok');

  // Provision sandbox
  const sandbox = await jfetch(`${BASE_URL}/v1/dev/sandbox/provision`, { method: 'POST' });
  const { tenantId, apiKey, topicId } = sandbox;
  if (!tenantId || !apiKey || !topicId) throw new Error('Sandbox provision missing fields');
  console.log('[TEST] sandbox ok tenantId=', tenantId);

  // Ensure phone subscription via dev endpoint
  const ensurePhone = await jfetch(`${BASE_URL}/v1/dev/users/ensure`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tenant_id: tenantId, phone: '+14155550123', topic: 'runs.finished' })
  });
  if (!ensurePhone.userId) throw new Error('Dev ensure phone failed');
  console.log('[TEST] dev ensure phone ok');

  // Create channel via dev endpoint
  const ch = await jfetch(`${BASE_URL}/v1/dev/channels/create`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tenantId, name: 'Test Channel', topic: 'runs.finished' })
  });
  if (!ch.short_id) throw new Error('Dev channel create failed');
  console.log('[TEST] dev channel create ok short_id=', ch.short_id);

  // List channels via dev endpoint
  const chList = await jfetch(`${BASE_URL}/v1/dev/channels/list?tenant_id=${encodeURIComponent(tenantId)}`);
  if (!Array.isArray(chList.channels)) throw new Error('Dev channels list failed');
  console.log('[TEST] dev channels list ok count=', chList.channels.length);

  // Send a message with payload.link using publisher API key
  const msg = await jfetch(`${BASE_URL}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      topic: 'runs.finished',
      title: 'API Test Message',
      body: 'Hello from test',
      payload: { link: 'https://example.com' },
    }),
  });
  if (!msg.message_id) throw new Error('Message send failed');
  console.log('[TEST] message send ok id=', msg.message_id);

  // Optionally test admin endpoints if token provided
  if (ADMIN_TOKEN) {
    console.log('[TEST] admin token present; testing admin endpoints');

    // admin channel create
    const ach = await jfetch(`${BASE_URL}/v1/admin/channels/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ADMIN_TOKEN}` },
      body: JSON.stringify({ tenant_id: tenantId, name: 'Admin Channel', topic_name: 'runs.finished' })
    });
    if (!ach.short_id) throw new Error('Admin channel create failed');

    const alist = await jfetch(`${BASE_URL}/v1/admin/channels/list?tenant_id=${encodeURIComponent(tenantId)}`, {
      headers: { 'Authorization': `Bearer ${ADMIN_TOKEN}` },
    });
    if (!Array.isArray(alist.channels)) throw new Error('Admin channels list failed');

    // admin users ensure (legacy email)
    const aensure = await jfetch(`${BASE_URL}/v1/admin/users/ensure`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ADMIN_TOKEN}` },
      body: JSON.stringify({ tenant_id: tenantId, email: 'test@example.com', topic: 'runs.finished' })
    });
    if (!aensure.userId) throw new Error('Admin users ensure failed');

    console.log('[TEST] admin endpoints ok');
  } else {
    console.log('[TEST] HUB_ADMIN_TOKEN not set; skipping admin endpoint tests');
  }

  console.log('[TEST] All checks passed');
}

main().catch((e) => { console.error(e); process.exit(1); });

