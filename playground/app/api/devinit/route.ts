import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';

export async function GET(req: Request) {
  const devId = crypto.randomUUID();
  const res = NextResponse.json({ developerId: devId });
  res.cookies.set('DEV_ID', devId, { httpOnly: false, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 365 });
  return res;
}
