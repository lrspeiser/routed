import { NextResponse } from 'next/server';
import { resolveChannelCode } from '../../lib/keys';

export async function POST(req: Request) {
  console.log('[API] POST /api/resolve');
  const body = await req.json().catch(() => ({}));
  const { code } = body || {};
  if (!code) return NextResponse.json({ error: 'missing code' }, { status: 400 });
  try {
    const desc = await resolveChannelCode(code);
    return NextResponse.json(desc);
  } catch (e: any) {
    return NextResponse.json({ error: 'invalid_code', detail: String(e) }, { status: 400 });
  }
}
