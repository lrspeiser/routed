import { NextResponse } from 'next/server';
import { getJWKS, initKeys } from '../../lib/keys';

export async function GET() {
  await initKeys();
  return NextResponse.json(getJWKS());
}
