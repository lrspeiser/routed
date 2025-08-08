import { Pool } from 'pg';
import { ENV } from './env';

export const pool = new Pool({ connectionString: ENV.DATABASE_URL });

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
