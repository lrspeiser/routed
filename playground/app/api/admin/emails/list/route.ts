import { NextResponse } from 'next/server';

// DEPRECATION: tenantId is internal; this route now uses developer key to infer tenant.
export async function GET(req: Request) {
  const HUB_URL = process.env.HUB_URL || '';
  if (!HUB_URL) return NextResponse.json({ error: 'server_not_configured' }, { status: 500 });

  const url = new URL(req.url);
  const topic = url.searchParams.get('topic') || 'runs.finished';
  const apiKey = (req.headers as any)['x-api-key'] || (req.headers as any)['X-Api-Key'] || '';
  if (!apiKey) return NextResponse.json({ error: 'missing apiKey' }, { status: 401 });

  const forwardUrl = new URL(`/v1/users/list?topic=${encodeURIComponent(topic)}`, HUB_URL).toString();
  const res = await fetch(forwardUrl, { headers: { 'Authorization': `Bearer ${apiKey}` }, cache: 'no-store' });
  const j = await res.json().catch(() => ({}));
  return NextResponse.json(j, { status: res.status });
}


