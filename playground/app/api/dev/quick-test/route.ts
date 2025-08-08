import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  const HUB_URL = process.env.HUB_URL;
  if (!HUB_URL) return NextResponse.json({ error: 'HUB_URL not configured' }, { status: 500 });
  const body = await req.json().catch(() => ({}));
  const title = body?.title || 'Test';
  const content = body?.body || 'Hello from Playground';
  const res = await fetch(new URL('/dev/broadcast', HUB_URL).toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, body: content }),
    cache: 'no-store',
  });
  const j = await res.json().catch(() => ({}));
  return NextResponse.json({ status: res.status, result: j });
}
