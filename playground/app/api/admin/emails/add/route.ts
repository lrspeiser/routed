import { NextResponse } from 'next/server';

// DEPRECATION: tenantId is internal; this route now uses developer key to infer tenant.
export async function POST(req: Request) {
  const HUB_URL = process.env.HUB_URL || '';
  if (!HUB_URL) return NextResponse.json({ error: 'server_not_configured' }, { status: 500 });

  const { email, topic = 'runs.finished' } = await req.json().catch(() => ({}));
  const apiKey = (req.headers as any)['x-api-key'] || (req.headers as any)['X-Api-Key'] || '';
  if (!apiKey) return NextResponse.json({ error: 'missing apiKey' }, { status: 401 });
  if (!email || !String(email).trim()) return NextResponse.json({ error: 'invalid email' }, { status: 400 });

  const res = await fetch(new URL('/v1/users/ensure', HUB_URL).toString(), {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, topic }),
    cache: 'no-store',
  });
  let payload: any = {};
  try { payload = await res.json(); } catch { payload = { error: 'invalid_json' }; }
  if (!res.ok) {
    return NextResponse.json({ error: 'hub_error', status: res.status, hub: payload }, { status: 500 });
  }
  return NextResponse.json(payload);
}


