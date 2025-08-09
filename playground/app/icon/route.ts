import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function GET() {
  try {
    const p = path.join(process.cwd(), '..', 'receiver-app', 'arrow-icon-routed.png');
    const buf = fs.readFileSync(p);
    return new NextResponse(buf, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' } });
  } catch (e) {
    return NextResponse.json({ error: 'icon_missing' }, { status: 404 });
  }
}


