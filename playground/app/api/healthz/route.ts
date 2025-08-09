import { NextResponse } from 'next/server';

export async function GET() {
  const HUB_URL = process.env.HUB_URL || '';
  let hub_ok = false;
  let hub_error: string | null = null;
  if (HUB_URL) {
    try {
      const res = await fetch(new URL('/healthz', HUB_URL).toString(), { cache: 'no-store' });
      hub_ok = res.ok;
      if (!hub_ok) hub_error = `status=${res.status}`;
    } catch (e: any) {
      hub_error = String(e?.message || e);
    }
  }
  return NextResponse.json({ ok: true, hub_ok, hub_url: HUB_URL || null, hub_error });
}


