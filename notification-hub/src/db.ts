import { Pool } from 'pg';
import { ENV } from './env';

// Render/managed Postgres often requires TLS. Enable SSL by default; allow override.
const shouldUseSSL = (process.env.DATABASE_SSL ?? 'true').toLowerCase() !== 'false';
export const pool = new Pool({
  connectionString: ENV.DATABASE_URL,
  ssl: shouldUseSSL ? { rejectUnauthorized: false } : undefined,
});

pool.on('error', (err: unknown) => {
  console.error('[DB] Pool error (will crash):', err);
  process.exit(1);
});

export async function withTxn<T>(fn: (client: any) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const res = await fn(client);
    await client.query('COMMIT');
    return res;
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('[DB] TXN rollback due to error:', e);
    throw e;
  } finally {
    client.release();
  }
}
