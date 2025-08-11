import { NextResponse } from 'next/server';
import crypto from 'crypto';

function maskToken(tok?: string) {
  if (!tok) return null;
  const len = tok.length;
  const prefix = tok.slice(0, 4);
  const suffix = tok.slice(-4);
  const hash = crypto.createHash('sha256').update(tok).digest('hex');
  return { len, prefix, suffix, sha256: hash };
}

export async function GET() {
  const HUB_URL = process.env.HUB_URL || '';
  const HUB_ADMIN_TOKEN = process.env.HUB_ADMIN_TOKEN || '';
  const payload = {
    node_env: process.env.NODE_ENV || null,
    hub_url: HUB_URL || null,
    has_admin_token: Boolean(HUB_ADMIN_TOKEN),
    admin_token_masked: maskToken(HUB_ADMIN_TOKEN || undefined),
    server_time: new Date().toISOString(),
    node_version: process.version,
  };
  return NextResponse.json(payload);
}


