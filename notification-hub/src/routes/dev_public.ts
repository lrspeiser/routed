import { FastifyInstance } from 'fastify';
import { pool, withTxn } from '../db';

export default async function routes(fastify: FastifyInstance) {
  // Public dev sandbox provision (unsafe; for demo/dev only)
  fastify.post('/v1/dev/sandbox/provision', async (_req, reply) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const t = await client.query(`insert into tenants (name, plan) values ($1,'free') returning id`, ['Dev Tenant']);
      const tenantId = t.rows[0].id as string;
      const apiKey = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
      const p = await client.query(`insert into publishers (tenant_id, name, api_key) values ($1,$2,$3) returning id`, [tenantId, 'Dev Publisher', apiKey]);
      const publisherId = p.rows[0].id as string;
      const top = await client.query(`insert into topics (tenant_id, name) values ($1,$2) returning id`, [tenantId, 'runs.finished']);
      const topicId = top.rows[0].id as string;
      const u = await client.query(`insert into users (tenant_id) values ($1) returning id`, [tenantId]);
      const userId = u.rows[0].id as string;
      await client.query(`insert into subscriptions (tenant_id, user_id, topic_id) values ($1,$2,$3)`, [tenantId, userId, topicId]);
      await client.query('COMMIT');
      return reply.send({ tenantId, publisherId, apiKey, userId, topicId });
    } catch (e) {
      await client.query('ROLLBACK');
      return reply.status(500).send({ error: 'internal_error' });
    } finally {
      client.release();
    }
  });

  // Public dev ensure by phone
  fastify.post('/v1/dev/users/ensure', async (req, reply) => {
    const { tenant_id, phone, topic = 'runs.finished' } = (req.body ?? {}) as any;
    if (!tenant_id || !phone) return reply.status(400).send({ error: 'missing tenant_id/phone' });
    try {
      const out = await withTxn(async (c) => {
        // ensure user
        const ur = await c.query(
          `insert into users (tenant_id, phone) values ($1,$2)
           on conflict (tenant_id, phone) do update set phone=excluded.phone
           returning id`,
          [tenant_id, phone]
        );
        const userId = ur.rows[0].id as string;
        // ensure topic
        const tr = await c.query(
          `insert into topics (tenant_id, name) values ($1,$2)
           on conflict (tenant_id, name) do update set name=excluded.name
           returning id`,
          [tenant_id, topic]
        );
        const topicId = tr.rows[0].id as string;
        // ensure subscription
        await c.query(
          `insert into subscriptions (tenant_id, user_id, topic_id) values ($1,$2,$3)
           on conflict do nothing`,
          [tenant_id, userId, topicId]
        );
        return { userId };
      });
      return reply.send(out);
    } catch (e) {
      return reply.status(500).send({ error: 'internal_error' });
    }
  });

  // Public dev channels create/list/users
  fastify.post('/v1/dev/channels/create', async (req, reply) => {
    const { tenantId, name, topic = 'runs.finished' } = (req.body ?? {}) as any;
    if (!tenantId || !name) return reply.status(400).send({ error: 'missing tenantId/name' });
    try {
      const out = await withTxn(async (c) => {
        const tr = await c.query(
          `insert into topics (tenant_id, name) values ($1,$2)
           on conflict (tenant_id,name) do update set name=excluded.name
           returning id`,
          [tenantId, topic]
        );
        const topicId = tr.rows[0].id as string;
        let sid = Math.random().toString(36).slice(2, 8);
        let ok = false;
        for (let i = 0; i < 5 && !ok; i++) {
          try {
            const ins = await c.query(
              `insert into channels (tenant_id, topic_id, name, short_id) values ($1,$2,$3,$4) returning short_id`,
              [tenantId, topicId, name, sid]
            );
            sid = ins.rows[0].short_id;
            ok = true;
          } catch (e: any) {
            const msg = String(e?.message || e);
            if (msg.includes('unique') || msg.includes('duplicate')) sid = Math.random().toString(36).slice(2, 8);
            else throw e;
          }
        }
        return { short_id: sid };
      });
      return reply.send(out);
    } catch (e) {
      return reply.status(500).send({ error: 'internal_error' });
    }
  });

  fastify.get('/v1/dev/channels/list', async (req, reply) => {
    const url = new URL(req.url ?? '', 'http://localhost');
    const tenantId = url.searchParams.get('tenant_id');
    if (!tenantId) return reply.status(400).send({ error: 'missing tenant_id' });
    const { rows } = await pool.query(
      `select c.id, c.short_id, c.name, t.name as topic
       from channels c join topics t on t.id=c.topic_id
       where c.tenant_id=$1
       order by c.created_at desc`,
      [tenantId]
    );
    return reply.send({ channels: rows });
  });

  fastify.get('/v1/dev/channels/:short_id/users', async (req, reply) => {
    const params = req.params as any;
    const shortId = params.short_id as string;
    const { rows: chRows } = await pool.query(
      `select tenant_id, topic_id from channels where short_id=$1`,
      [shortId]
    );
    if (chRows.length === 0) return reply.status(404).send({ error: 'not_found' });
    const { tenant_id, topic_id } = chRows[0];
    const { rows } = await pool.query(
      `select u.id as user_id, u.email as email, u.phone as phone from users u
       join subscriptions s on s.user_id=u.id and s.tenant_id=u.tenant_id and s.topic_id=$2
       where u.tenant_id=$1 order by coalesce(u.email,u.phone) asc`,
      [tenant_id, topic_id]
    );
    const users = rows.map((r) => ({ user_id: r.user_id, email: r.email, phone: r.phone }));
    return reply.send({ users });
  });

  // Public sockets snapshot for debugging
  fastify.get('/v1/dev/debug/sockets', async (_req, reply) => {
    try {
      const { snapshotSockets } = await import('../adapters/socket');
      const snap = snapshotSockets();
      return reply.send({ sockets: snap, ts: Date.now() });
    } catch (e) {
      return reply.status(500).send({ error: 'internal_error' });
    }
  });
}


