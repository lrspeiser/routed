import { pool } from '../db';

export function startTtlSweeper() {
  const intervalMs = 30_000; // every 30s
  async function sweep() {
    try {
      // Expire deliveries for expired messages
      await pool.query(`
        update deliveries d set status='expired', updated_at=now(), last_error='expired'
        from messages m
        where d.message_id = m.id
          and m.expires_at < now()
          and d.status in ('queued','failed')
      `);
      // Expire messages
      await pool.query(`
        update messages set status='expired'
        where expires_at < now() and status not in ('done','expired')
      `);
      // Cleanup: optionally delete fully expired messages older than 24h
      await pool.query(`
        delete from messages where expires_at < now() - interval '24 hours'
      `);
      // deliveries cascade via FK on message delete
      // Note: adjust retention as needed.
    } catch (e) {
      console.error('[TTL] Sweep error:', e);
    }
  }
  sweep();
  const handle = setInterval(sweep, intervalMs);
  console.log(`[TTL] Sweeper started (${intervalMs}ms interval)`);
  return () => clearInterval(handle);
}
