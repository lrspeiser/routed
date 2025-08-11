import { NextResponse } from 'next/server';
import WebSocket from 'ws';

export async function GET() {
  const HUB_URL = process.env.HUB_URL || '';
  const HUB_ADMIN_TOKEN = process.env.HUB_ADMIN_TOKEN || '';
  if (!HUB_URL || !HUB_ADMIN_TOKEN) return NextResponse.json({ ok: false, error: 'server_not_configured' }, { status: 500 });

  try {
    // 1) Provision sandbox
    const provRes = await fetch(new URL('/v1/admin/sandbox/provision', HUB_URL).toString(), {
      method: 'POST', headers: { 'Authorization': `Bearer ${HUB_ADMIN_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({})
    });
    const prov = await provRes.json().catch(() => ({}));
    if (!provRes.ok) return NextResponse.json({ ok: false, step: 'provision', status: provRes.status, hub: prov }, { status: 500 });

    const { tenantId, apiKey, userId } = prov;

    // 2) Open WS
    const url = new URL(HUB_URL);
    const wsProto = url.protocol === 'https:' ? 'wss' : 'ws';
    const sockUrl = `${wsProto}://${url.host}/socket?user_id=${encodeURIComponent(userId)}`;
    const ws = new WebSocket(sockUrl);
    await new Promise<void>((resolve, reject) => {
      const to = setTimeout(() => reject(new Error('ws_timeout')), 6000);
      ws.on('open', () => { clearTimeout(to); resolve(); });
      ws.on('error', (e) => { clearTimeout(to); reject(e as any); });
    });

    // 3) Send message
    const sendRes = await fetch(new URL('/v1/messages', HUB_URL).toString(), {
      method: 'POST', headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic: 'runs.finished', title: 'Self-Test', body: 'Hello', payload: { selftest: true } })
    });
    const send = await sendRes.json().catch(() => ({}));
    if (!sendRes.ok) return NextResponse.json({ ok: false, step: 'send', status: sendRes.status, hub: send }, { status: 500 });

    // 4) Await one message
    const got = await new Promise<any>((resolve, reject) => {
      const to = setTimeout(() => reject(new Error('no_message')), 8000);
      ws.on('message', (buf) => {
        try { const data = JSON.parse(buf.toString()); resolve(data); clearTimeout(to); } catch {}
      });
    });
    try { ws.close(); } catch {}
    return NextResponse.json({ ok: true, hub_url: HUB_URL, received: got });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}


