import { NextResponse } from 'next/server';
import { setLatestTenantId } from '../../../lib/state';

export async function POST() {
  console.log('[API] POST /api/dev/create');
  const HUB_URL = process.env.HUB_URL || 'http://localhost:8080';
  const HUB_ADMIN_TOKEN = process.env.HUB_ADMIN_TOKEN || '';
  if (!HUB_ADMIN_TOKEN) return NextResponse.json({ error: 'HUB_ADMIN_TOKEN not configured' }, { status: 500 });
  const res = await fetch(new URL('/v1/admin/sandbox/provision', HUB_URL).toString(), {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${HUB_ADMIN_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
    cache: 'no-store',
  });
  const data = await res.json();
  if (!res.ok) return NextResponse.json(data, { status: res.status });
  setLatestTenantId(data.tenantId);
  return NextResponse.json({ ...data, hubUrl: HUB_URL });
}
