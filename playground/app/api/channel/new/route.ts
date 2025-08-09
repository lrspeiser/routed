import { NextResponse } from 'next/server';
import { createChannelCode } from '../../../lib/keys';
import { channelIdToCode } from '../../../lib/store';

function shortId(): string {
  return Math.random().toString(36).slice(2, 8);
}

export async function POST(req: Request) {
  const { hubUrl, tenantId, userId, apiKey, topic = 'runs.finished', channelName } = await req.json().catch(() => ({}));
  console.log('[API] POST /api/channel/new', { hasHubUrl: Boolean(hubUrl), hasTenantId: Boolean(tenantId), hasUserId: Boolean(userId) });
  if (!hubUrl || !tenantId || !userId || !apiKey) return NextResponse.json({ error: 'missing hubUrl/tenantId/userId/apiKey' }, { status: 400 });
  const code = await createChannelCode({ base_url: hubUrl, tenant_id: tenantId, user_id: userId, api_key: apiKey, topic, channel_name: channelName || null });
  let channelId = shortId();
  while (channelIdToCode.has(channelId)) channelId = shortId();
  channelIdToCode.set(channelId, code);
  return NextResponse.json({ channelId });
}
