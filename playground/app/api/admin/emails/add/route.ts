import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  const HUB_URL = process.env.HUB_URL || '';
  const HUB_ADMIN_TOKEN = process.env.HUB_ADMIN_TOKEN || '';
  if (!HUB_URL || !HUB_ADMIN_TOKEN) return NextResponse.json({ error: 'server_not_configured' }, { status: 500 });

  const { email, tenantId, topic = 'runs.finished' } = await req.json().catch(() => ({}));
  if (!email || !String(email).trim()) return NextResponse.json({ error: 'invalid email' }, { status: 400 });
  if (!email || !tenantId) return NextResponse.json({ error: 'missing email/tenantId' }, { status: 400 });

  const res = await fetch(new URL('/v1/admin/users/ensure', HUB_URL).toString(), {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${HUB_ADMIN_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ tenant_id: tenantId, email, topic }),
    cache: 'no-store',
  });
  let payload: any = {};
  try { payload = await res.json(); } catch { payload = { error: 'invalid_json' }; }
  if (!res.ok) {
    return NextResponse.json({ error: 'hub_error', status: res.status, hub: payload }, { status: 500 });
  }
  return NextResponse.json(payload);
}


