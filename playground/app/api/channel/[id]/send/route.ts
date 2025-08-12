import { NextResponse } from 'next/server';
import { channelIdToCode } from '../../../../lib/store';
import { resolveChannelCode } from '../../../../lib/keys';

function sanitize(input: unknown): string {
  const s = String(input ?? '');
  return s.length > 200 ? s.slice(0, 200) + '…' : s;
}

export async function POST(req: Request, ctx: { params: { id: string } }) {
  const id = ctx.params.id;
  console.log('[API] POST /api/channel/:id/send (playground)', { id });
  const code = channelIdToCode.get(id);
  if (!code) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  let payload: any = {};
  try {
    payload = await req.json();
  } catch {}

  const { title, body, payload: extraPayload } = payload || {};
  if (!title || !body) return NextResponse.json({ error: 'missing title/body' }, { status: 400 });

  try {
    const desc = await resolveChannelCode(code);
    const baseUrl = desc.base_url as string;
    const topic = (desc.topic as string) || 'runs.finished';
    const apiKey = desc.api_key as string;
    if (!baseUrl || !apiKey) return NextResponse.json({ error: 'channel_unusable' }, { status: 500 });

    const url = new URL('/v1/messages', baseUrl).toString();
    console.log('[API] Forwarding to hub /v1/messages', { baseUrl, topic, hasApiKey: Boolean(apiKey) });
    const forward = await fetch(url, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic, title, body, payload: extraPayload ?? null }),
      cache: 'no-store',
    });
    const j = await forward.json().catch(() => ({}));
    console.log('[API] Hub response', { status: forward.status, title: sanitize(title), body: j });
    if (!forward.ok) return NextResponse.json({ error: 'hub_error', result: j }, { status: forward.status });
    return NextResponse.json({ ok: true, result: j });
  } catch (e: any) {
    console.error('[API] Channel send failed', String(e?.message || e));
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}


