import { NextResponse } from 'next/server';
import { createChannelCode } from '../../../lib/keys';

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { hubUrl, tenantId, userId, topic = 'runs.finished' } = body || {};
  if (!hubUrl || !tenantId || !userId) return NextResponse.json({ error: 'missing hubUrl/tenantId/userId' }, { status: 400 });
  const code = await createChannelCode({ base_url: hubUrl, tenant_id: tenantId, user_id: userId, topic });
  return NextResponse.json({ code });
}
