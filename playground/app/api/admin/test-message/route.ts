import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  const HUB_URL = process.env.HUB_URL || '';
  const HUB_ADMIN_TOKEN = process.env.HUB_ADMIN_TOKEN || '';
  if (!HUB_URL || !HUB_ADMIN_TOKEN) return NextResponse.json({ error: 'server_not_configured' }, { status: 500 });
  const { tenantId, topic = 'runs.finished', title = 'Test', body = 'Hello', payload = null } = await req.json().catch(() => ({}));
  console.log('[API] /api/admin/test-message (playground) → forwarding', { tenantId: Boolean(tenantId), topic });
  if (!tenantId) return NextResponse.json({ error: 'missing tenantId' }, { status: 400 });
  const res = await fetch(new URL('/v1/admin/test/message', HUB_URL).toString(), {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${HUB_ADMIN_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ tenant_id: tenantId, topic, title, body, payload }),
    cache: 'no-store'
  });
  const text = await res.text();
  let j: any = text;
  try { j = JSON.parse(text); } catch {}
  console.log('[API] /api/admin/test-message (playground) hub response', { status: res.status, bodyType: typeof j });
  return NextResponse.json(j, { status: res.status });
}


