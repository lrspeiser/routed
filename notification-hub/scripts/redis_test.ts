import IORedis from 'ioredis';

async function main() {
  const url = process.env.REDIS_URL || '';
  if (!url) {
    console.error('REDIS_URL not set');
    process.exit(1);
  }
  const client = new IORedis(url, { maxRetriesPerRequest: null, tls: url.startsWith('rediss://') ? {} : undefined } as any);
  try {
    console.log('[REDIS] Connecting…');
    await client.connect?.(); // ioredis v5 auto connects; connect() exists in v5 when not auto
  } catch {}
  try {
    const pong = await client.ping();
    console.log('[REDIS] PING →', pong);
    const key = `routed:test:${Date.now()}`;
    await client.set(key, 'ok', 'EX', 10);
    const val = await client.get(key);
    console.log('[REDIS] SET/GET →', key, val);
    const info = await client.info('server');
    console.log('[REDIS] INFO server snippet →', info.split('\n').slice(0, 5).join(' | '));
  } finally {
    try { client.disconnect(); } catch {}
  }
}

main().catch((e) => { console.error('[REDIS] Error:', e?.message || e); process.exit(1); });


