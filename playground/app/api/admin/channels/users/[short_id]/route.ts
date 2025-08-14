import { NextResponse } from 'next/server';

// DEPRECATION: tenantId is internal; this route now uses developer key to infer tenant.
export async function GET(req: Request, ctx: { params: { short_id: string } }) {
  const HUB_URL = process.env.HUB_URL || '';
  if (!HUB_URL) return NextResponse.json({ error: 'server_not_configured' }, { status: 500 });
  const apiKey = (req.headers as any)['x-api-key'] || (req.headers as any)['X-Api-Key'] || '';
  if (!apiKey) return NextResponse.json({ error: 'missing apiKey' }, { status: 401 });
  const shortId = ctx.params.short_id;
  const res = await fetch(new URL(`/v1/channels/${encodeURIComponent(shortId)}/users`, HUB_URL).toString(), {
    headers: { 'Authorization': `Bearer ${apiKey}` }, cache: 'no-store'
  });
  const j = await res.json().catch(() => ({}));
  return NextResponse.json(j, { status: res.status });
}


