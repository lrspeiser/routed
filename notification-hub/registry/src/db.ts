import { Pool } from 'pg';
import { ENV } from './env';

export const pool = new Pool({ connectionString: ENV.DATABASE_URL });

pool.on('error', (err: unknown) => {
  console.error('[REG][DB] Pool error (will crash):', err);
  process.exit(1);
});
