import { NextResponse } from 'next/server';
import { createChannelCode } from '../../../lib/keys';
import { channelIdToCode } from '../../../lib/store';

function shortId(): string {
  return Math.random().toString(36).slice(2, 8);
}

export async function POST(req: Request) {
  const { hubUrl, tenantId, userId, topic = 'runs.finished' } = await req.json().catch(() => ({}));
  if (!hubUrl || !tenantId || !userId) return NextResponse.json({ error: 'missing hubUrl/tenantId/userId' }, { status: 400 });
  const code = await createChannelCode({ base_url: hubUrl, tenant_id: tenantId, user_id: userId, topic });
  let channelId = shortId();
  while (channelIdToCode.has(channelId)) channelId = shortId();
  channelIdToCode.set(channelId, code);
  return NextResponse.json({ channelId });
}
