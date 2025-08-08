import { FastifyInstance } from 'fastify';
import { pool } from '../db';
import { randomBytes } from 'crypto';

function requireAdmin(req: any) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!process.env.HUB_ADMIN_TOKEN || token !== process.env.HUB_ADMIN_TOKEN) {
    const err: any = new Error('unauthorized');
    err.statusCode = 401;
    throw err;
  }
}

export default async function routes(fastify: FastifyInstance) {
  // Creates a sandbox tenant with one publisher key and default topic 'runs.finished'
  fastify.post('/v1/admin/sandbox/provision', async (req, reply) => {
    requireAdmin(req);
    const email = ((req.body as any)?.email ?? '').toString() || null;
    const apiKey = randomBytes(16).toString('hex');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const t = await client.query(`insert into tenants (name, plan) values ($1,'free') returning id`, ['Playground Tenant']);
      const tenantId = t.rows[0].id as string;

      const p = await client.query(`insert into publishers (tenant_id, name, api_key) values ($1,$2,$3) returning id`, [tenantId, 'Playground Publisher', apiKey]);
      const publisherId = p.rows[0].id as string;

      const top = await client.query(`insert into topics (tenant_id, name) values ($1,$2) returning id`, [tenantId, 'runs.finished']);
      const topicId = top.rows[0].id as string;

      const u = await client.query(`insert into users (tenant_id, email) values ($1,$2) returning id`, [tenantId, email]);
      const userId = u.rows[0].id as string;

      await client.query(`insert into subscriptions (tenant_id, user_id, topic_id) values ($1,$2,$3)`, [tenantId, userId, topicId]);

      await client.query('COMMIT');
      return reply.send({ tenantId, publisherId, apiKey, userId, topicId });
    } catch (e) {
      await client.query('ROLLBACK');
      fastify.log.error(e);
      return reply.status(500).send({ error: 'internal_error' });
    } finally {
      client.release();
    }
  });
}
