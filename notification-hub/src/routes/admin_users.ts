import { FastifyInstance } from 'fastify';
import { pool } from '../db';

function requireAdmin(req: any) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!process.env.HUB_ADMIN_TOKEN || token !== process.env.HUB_ADMIN_TOKEN) {
    const err: any = new Error('unauthorized');
    err.statusCode = 401;
    throw err;
  }
}

export default async function routes(fastify: FastifyInstance) {
  // Ensure a user exists by email for a tenant and is subscribed to a topic.
  fastify.post('/v1/admin/users/ensure', async (req, reply) => {
    requireAdmin(req);
    const { tenant_id, email, topic } = (req.body ?? {}) as any;
    if (!tenant_id || !email) return reply.status(400).send({ error: 'missing tenant_id/email' });
    const topicName = (topic as string) || 'runs.finished';

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // ensure user
      const ur = await client.query(
        `insert into users (tenant_id, email) values ($1,$2)
         on conflict do nothing
         returning id`,
        [tenant_id, email]
      );
      let userId: string;
      if (ur.rows[0]?.id) userId = ur.rows[0].id;
      else {
        const f = await client.query(`select id from users where tenant_id=$1 and email=$2`, [tenant_id, email]);
        userId = f.rows[0].id;
      }

      // ensure topic
      const tr = await client.query(
        `insert into topics (tenant_id, name) values ($1,$2)
         on conflict (tenant_id,name) do update set name=excluded.name
         returning id`,
        [tenant_id, topicName]
      );
      const topicId: string = tr.rows[0].id;

      // ensure subscription
      await client.query(
        `insert into subscriptions (tenant_id, user_id, topic_id) values ($1,$2,$3)
         on conflict do nothing`,
        [tenant_id, userId, topicId]
      );

      await client.query('COMMIT');
      return reply.send({ userId, topicId });
    } catch (e) {
      await client.query('ROLLBACK');
      fastify.log.error(e);
      return reply.status(500).send({ error: 'internal_error' });
    } finally {
      client.release();
    }
  });
}


