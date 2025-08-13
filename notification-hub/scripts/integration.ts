/*
 Integration test script
 Requires env:
  - HUB_URL (e.g., https://routed-notify.onrender.com)
  - HUB_ADMIN_TOKEN

 Steps:
 1) Provision sandbox tenant/publisher/user
 2) Create channel for topic
 3) Ensure a test email is subscribed
 4) Open WS for that user
 5) Send message via /v1/messages and assert receipt over WS
*/

import WebSocket from 'ws';
import fetch from 'node-fetch';

function invariant(cond: any, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

async function main() {
  const HUB_URL = process.env.HUB_URL || '';
  const HUB_ADMIN_TOKEN = process.env.HUB_ADMIN_TOKEN || '';
  invariant(HUB_URL && HUB_ADMIN_TOKEN, 'HUB_URL and HUB_ADMIN_TOKEN are required');

  const topic = 'runs.finished';
  const testPhone = `+1555${Math.floor(1000000 + Math.random()*8999999)}`;

  // 1) Provision sandbox
  const provRes = await fetch(new URL('/v1/admin/sandbox/provision', HUB_URL).toString(), {
    method: 'POST', headers: { 'Authorization': `Bearer ${HUB_ADMIN_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  const prov = await provRes.json();
  invariant(provRes.ok, `provision failed ${provRes.status} ${JSON.stringify(prov)}`);
  const { tenantId, apiKey, userId } = prov as any;
  console.log('[TEST] Provisioned', { tenantId, userId });

  // 2) Create channel
  const chRes = await fetch(new URL('/v1/admin/channels/create', HUB_URL).toString(), {
    method: 'POST', headers: { 'Authorization': `Bearer ${HUB_ADMIN_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ tenant_id: tenantId, name: 'Integration Channel', topic_name: topic }),
  });
  const ch = await chRes.json();
  invariant(chRes.ok, `channel create failed ${chRes.status} ${JSON.stringify(ch)}`);
  console.log('[TEST] Channel created', ch);

  // 3) Ensure a test phone
  const ensRes = await fetch(new URL('/v1/admin/users/ensure', HUB_URL).toString(), {
    method: 'POST', headers: { 'Authorization': `Bearer ${HUB_ADMIN_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ tenant_id: tenantId, phone: testPhone, topic }),
  });
  const ens: any = await ensRes.json().catch(() => ({} as any));
  invariant(ensRes.ok, `ensure failed ${ensRes.status} ${JSON.stringify(ens)}`);
  const targetUserId = (ens as any).userId || (ens as any).user_id || userId;
  console.log('[TEST] Ensured phone', { phone: testPhone, userId: targetUserId });

  // 4) Open WS
  const url = new URL(HUB_URL);
  const wsProto = url.protocol === 'https:' ? 'wss' : 'ws';
  const sockUrl = `${wsProto}://${url.host}/v1/socket?user_id=${encodeURIComponent(targetUserId)}`;
  console.log('[TEST] Connecting WS', sockUrl);
  const ws = new WebSocket(sockUrl);
  let received: any = null;
  ws.on('message', (buf) => {
    try { received = JSON.parse(buf.toString()); } catch { received = { raw: buf.toString() }; }
    console.log('[TEST] WS message', received);
  });
  await new Promise<void>((resolve, reject) => {
    const to = setTimeout(() => reject(new Error('WS open timeout')), 8000);
    ws.on('open', () => { clearTimeout(to); resolve(); });
    ws.on('error', (e) => { clearTimeout(to); reject(e as any); });
  });

  // 5) Send message
  const sendRes = await fetch(new URL('/v1/messages', HUB_URL).toString(), {
    method: 'POST', headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ topic, title: 'Integration Test', body: 'Hello world', payload: { k: 'v' } }),
  });
  const send = await sendRes.json();
  invariant(sendRes.ok, `send failed ${sendRes.status} ${JSON.stringify(send)}`);
  console.log('[TEST] Message enqueued', send);

  // Wait for delivery
  const start = Date.now();
  while (!received && Date.now() - start < 15000) {
    await sleep(200);
  }
  invariant(received && (received.title || received.type === 'notification'), 'did not receive notification over WS');
  console.log('[TEST] PASS received notification');
  process.exit(0);
}

main().catch((e) => {
  console.error('[TEST] FAIL', e);
  process.exit(1);
});


