import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  const HUB_URL = process.env.HUB_URL || '';
  const HUB_ADMIN_TOKEN = process.env.HUB_ADMIN_TOKEN || '';
  if (!HUB_URL || !HUB_ADMIN_TOKEN) return NextResponse.json({ error: 'server_not_configured' }, { status: 500 });
  const url = new URL(req.url);
  const tenantId = url.searchParams.get('tenantId');
  if (!tenantId) return NextResponse.json({ error: 'missing tenantId' }, { status: 400 });
  const res = await fetch(new URL(`/v1/admin/channels/list?tenant_id=${encodeURIComponent(tenantId)}`, HUB_URL).toString(), {
    headers: { 'Authorization': `Bearer ${HUB_ADMIN_TOKEN}` }, cache: 'no-store'
  });
  const j = await res.json().catch(() => ({}));
  return NextResponse.json(j, { status: res.status });
}


