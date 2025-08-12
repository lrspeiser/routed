import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  console.log('[API] POST /api/resolve-email');
  const HUB_URL = process.env.HUB_URL || '';
  const HUB_ADMIN_TOKEN = process.env.HUB_ADMIN_TOKEN || '';
  if (!HUB_URL || !HUB_ADMIN_TOKEN) return NextResponse.json({ error: 'server_not_configured' }, { status: 500 });

  const { email, topic = 'runs.finished' } = await req.json().catch(() => ({}));
  const { latestTenantId } = await import('../../lib/state');
  const tId = latestTenantId;
  if (!email) return NextResponse.json({ error: 'missing email' }, { status: 400 });
  if (!tId) return NextResponse.json({ error: 'missing tenant' }, { status: 400 });

  // Ask hub to ensure user and subscription
  const res = await fetch(new URL('/v1/admin/users/ensure', HUB_URL).toString(), {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${HUB_ADMIN_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ tenant_id: tId, email, topic }),
    cache: 'no-store',
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) return NextResponse.json(j, { status: res.status });

  // Return descriptor for socket connect
  return NextResponse.json({ base_url: HUB_URL, tenant_id: tId, user_id: j.userId, topic });
}
