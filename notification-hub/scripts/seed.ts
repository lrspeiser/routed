import 'dotenv/config';
import { pool } from '../src/db';
import { randomUUID } from 'crypto';

async function main() {
  const tenantName = process.argv[2] || 'Demo Tenant';
  const apiKey = process.argv[3] || 'dev-api-key-123';
  const topicName = process.argv[4] || 'runs.finished';

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: trows } = await client.query(
      `insert into tenants (name) values ($1) returning id`,
      [tenantName]
    );
    const tenantId = trows[0].id as string;

    const { rows: prows } = await client.query(
      `insert into publishers (tenant_id, name, api_key) values ($1,$2,$3) returning id`,
      [tenantId, 'Demo Publisher', apiKey]
    );
    const publisherId = prows[0].id as string;

    const { rows: urows } = await client.query(
      `insert into users (tenant_id, email) values ($1,$2) returning id`,
      [tenantId, 'demo@example.com']
    );
    const userId = urows[0].id as string;

    const { rows: topicRows } = await client.query(
      `insert into topics (tenant_id, name) values ($1,$2) returning id`,
      [tenantId, topicName]
    );
    const topicId = topicRows[0].id as string;

    await client.query(
      `insert into subscriptions (tenant_id, user_id, topic_id) values ($1,$2,$3)`,
      [tenantId, userId, topicId]
    );

    await client.query('COMMIT');

    console.log('[SEED] OK');
    console.log({ tenantId, publisherId, apiKey, userId, topicId });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('[SEED] Failed:', e);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
