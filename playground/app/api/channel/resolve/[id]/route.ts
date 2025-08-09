import { NextResponse } from 'next/server';
import { channelIdToCode } from '../../../../lib/store';
import { resolveChannelCode } from '../../../../lib/keys';

export async function GET(_req: Request, ctx: { params: { id: string } }) {
  const id = ctx.params.id;
  console.log('[API] GET /api/channel/resolve/:id', { id });
  const code = channelIdToCode.get(id);
  if (!code) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const desc = await resolveChannelCode(code);
  return NextResponse.json(desc);
}
