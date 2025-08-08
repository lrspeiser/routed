import { FastifyInstance } from 'fastify';
import { pool } from '../db';

export default async function routes(fastify: FastifyInstance) {
  fastify.post('/v1/webpush/register', async (req, reply) => {
    console.log('[HTTP] POST /v1/webpush/register');
    const { tenant_id, user_id, subscription_json } = (req.body ?? {}) as any;
    if (!tenant_id || !user_id || !subscription_json) {
      return reply.status(400).send({ error: 'missing tenant_id, user_id, subscription_json' });
    }
    await pool.query(
      `
      insert into devices (tenant_id, user_id, kind, token, last_seen_at)
      values ($1, $2, 'webpush', $3::jsonb, now())
      on conflict do nothing
      `,
      [tenant_id, user_id, subscription_json]
    );
    return reply.send({ ok: true });
  });
}
