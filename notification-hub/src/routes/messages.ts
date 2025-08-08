import { FastifyInstance } from 'fastify';
import { ENV } from '../env';
import { withTxn, pool } from '../db';
import { fanoutQueue } from '../queues';

async function authPublisher(apiKey?: string) {
  if (!apiKey) return null;
  const { rows } = await pool.query(
    `select id, tenant_id from publishers where api_key=$1`,
    [apiKey]
  );
  return rows[0] ?? null;
}

export default async function routes(fastify: FastifyInstance) {
  fastify.post('/v1/messages', async (req, reply) => {
    console.log('[HTTP] POST /v1/messages');
    const apiKey = (req.headers.authorization || '').replace('Bearer ', '');
    const pub = await authPublisher(apiKey);
    if (!pub) {
      console.warn('[AUTH] Invalid publisher key');
      return reply.status(401).send({ error: 'unauthorized' });
    }

    const { topic, title, body, payload, ttl_sec, dedupe_key } = (req.body ?? {}) as any;
    if (!topic || !title || !body) {
      return reply.status(400).send({ error: 'missing required fields (topic,title,body)' });
    }

    const ttl = Number(ttl_sec ?? ENV.DEFAULT_TTL_SEC);
    const expiresAtSql = `now() + interval '${ttl} seconds'`;

    try {
      const result = await withTxn(async (c) => {
        const topicRow = await c.query(
          `select id from topics where tenant_id=$1 and name=$2`,
          [pub.tenant_id, topic]
        );
        let topicId = topicRow.rows[0]?.id;
        if (!topicId) {
          const ins = await c.query(
            `insert into topics (tenant_id, name) values ($1, $2) returning id`,
            [pub.tenant_id, topic]
          );
          topicId = ins.rows[0].id;
          console.log(`[TOPIC] Created topic '${topic}' id=${topicId}`);
        }

        const msg = await c.query(
          `
          insert into messages (tenant_id, topic_id, publisher_id, title, body, payload, ttl_sec, expires_at, dedupe_key)
          values ($1,$2,$3,$4,$5,$6,$7, ${expiresAtSql}, $8)
          returning id
          `,
          [pub.tenant_id, topicId, pub.id, title, body, payload ?? null, ttl, dedupe_key ?? null]
        );
        return { messageId: msg.rows[0].id };
      });

      await fanoutQueue.add('fanout', { messageId: result.messageId }, { removeOnComplete: 1000, removeOnFail: 1000 });
      console.log(`[ENQUEUE] Fanout queued for message=${result.messageId}`);
      return reply.status(202).send({ message_id: result.messageId });
    } catch (e: any) {
      if (String(e.message).includes('duplicate key value violates unique constraint') && dedupe_key) {
        console.warn('[DEDUPE] Duplicate dedupe_key; returning 200 with existing reference');
        const { rows } = await pool.query(
          `select id from messages where tenant_id=$1 and dedupe_key=$2`,
          [pub.tenant_id, dedupe_key]
        );
        return reply.send({ message_id: rows[0]?.id });
      }
      console.error('[HTTP] Failed to create message:', e);
      return reply.status(500).send({ error: 'internal_error' });
    }
  });

  fastify.get('/v1/messages/:id', async (req, reply) => {
    const id = (req.params as any).id as string;
    const { rows: msgs } = await pool.query(
      `select id, title, body, payload, status, created_at, expires_at from messages where id=$1`,
      [id]
    );
    if (msgs.length === 0) return reply.status(404).send({ error: 'not_found' });

    const { rows: counts } = await pool.query(
      `select status, count(*) from deliveries where message_id=$1 group by status`,
      [id]
    );
    const byStatus: Record<string, number> = {};
    for (const r of counts) byStatus[r.status] = Number(r.count);

    return reply.send({ message: msgs[0], deliveries: byStatus });
  });
}
