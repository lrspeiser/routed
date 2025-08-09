import { NextResponse } from 'next/server';

function parseCookie(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  header.split(';').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    const k = pair.slice(0, idx).trim();
    const v = pair.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  });
  return out;
}

export async function GET(req: Request) {
  const cookies = parseCookie(req.headers.get('cookie'));
  const existing = cookies['DEV_ID'];
  const devId = existing || crypto.randomUUID();
  const res = NextResponse.json({ developerId: devId, reused: Boolean(existing) });
  // Refresh cookie (or set if missing)
  res.cookies.set('DEV_ID', devId, {
    httpOnly: false,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  });
  return res;
}
