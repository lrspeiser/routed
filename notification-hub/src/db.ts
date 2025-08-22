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
  let shouldDestroy = false;
  try {
    await client.query('BEGIN');
    const res = await fn(client);
    await client.query('COMMIT');
    return res;
  } catch (e) {
    console.error('[DB] TXN error:', e);
    try {
      await client.query('ROLLBACK');
      console.log('[DB] TXN rolled back successfully.');
    } catch (rollbackErr) {
      console.error('[DB] TXN rollback failed:', rollbackErr);
      // Mark connection for destruction if rollback fails
      shouldDestroy = true;
    }
    throw e;
  } finally {
    // Destroy the connection if it's in a bad state, otherwise release it
    if (shouldDestroy) {
      client.release(true); // true = destroy the connection
      console.log('[DB] Connection destroyed due to rollback failure.');
    } else {
      client.release();
    }
  }
}
