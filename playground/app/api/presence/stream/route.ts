import { NextRequest } from 'next/server';

export async function GET(req: NextRequest) {
  const HUB_URL = process.env.HUB_URL || '';
  const url = new URL(req.url);
  const tenantId = url.searchParams.get('tenantId');
  const topic = url.searchParams.get('topic') || 'runs.finished';
  // For now proxy raw SSE; tenant/topic not used without per-topic filtering
  const target = new URL('/v1/presence/stream', HUB_URL).toString();
  const hubRes = await fetch(target, { headers: { 'Accept': 'text/event-stream' } });
  return new Response(hubRes.body, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}


