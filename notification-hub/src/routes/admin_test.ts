import { FastifyInstance } from 'fastify';
import { withTxn, pool } from '../db';

function requireAdmin(req: any) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!process.env.HUB_ADMIN_TOKEN || token !== process.env.HUB_ADMIN_TOKEN) {
    const err: any = new Error('unauthorized');
    err.statusCode = 401;
    throw err;
  }
}

export default async function routes(fastify: FastifyInstance) {
  fastify.post('/v1/admin/test/message', async (req, reply) => {
    requireAdmin(req);
    const { tenant_id, topic, title, body, payload } = (req.body ?? {}) as any;
    if (!tenant_id || !topic || !title || !body) return reply.status(400).send({ error: 'missing tenant_id/topic/title/body' });

    try {
      const result = await withTxn(async (c) => {
        const topicRow = await c.query(`select id from topics where tenant_id=$1 and name=$2`, [tenant_id, topic]);
        let topicId = topicRow.rows[0]?.id;
        if (!topicId) {
          const ins = await c.query(`insert into topics (tenant_id, name) values ($1, $2) returning id`, [tenant_id, topic]);
          topicId = ins.rows[0].id;
        }
        // Pick any publisher for the tenant to satisfy NOT NULL constraint
        const pubRow = await c.query(`select id from publishers where tenant_id=$1 limit 1`, [tenant_id]);
        let publisherId = pubRow.rows[0]?.id;
        if (!publisherId) {
          const ins = await c.query(`insert into publishers (tenant_id, name, api_key) values ($1,$2,$3) returning id`, [tenant_id, 'admin-test', 'admin-test-key']);
          publisherId = ins.rows[0].id;
        }
        const msg = await c.query(
          `insert into messages (tenant_id, topic_id, publisher_id, title, body, payload, ttl_sec, expires_at)
           values ($1,$2,$3,$4,$5,$6,86400, now() + interval '86400 seconds') returning id`,
          [tenant_id, topicId, publisherId, title, body, payload ?? null]
        );
        return { messageId: msg.rows[0].id };
      });
      // Enqueue fanout job if present
      try {
        const { fanoutQueue } = await import('../queues');
        await fanoutQueue.add('fanout', { messageId: result.messageId }, { removeOnComplete: 1000, removeOnFail: 1000 });
      } catch {}
      return reply.send({ ok: true, message_id: result.messageId });
    } catch (e) {
      fastify.log.error(e);
      return reply.status(500).send({ error: 'internal_error' });
    }
  });
}


