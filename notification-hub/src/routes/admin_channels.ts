import { FastifyInstance } from 'fastify';
import { pool, withTxn } from '../db';
import { isUserOnline } from '../adapters/socket';

function requireAdmin(req: any) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!process.env.HUB_ADMIN_TOKEN || token !== process.env.HUB_ADMIN_TOKEN) {
    const err: any = new Error('unauthorized');
    err.statusCode = 401;
    throw err;
  }
}

function makeShortId(): string {
  return Math.random().toString(36).slice(2, 8);
}

async function authPublisher(apiKey?: string) {
  if (!apiKey) return null;
  const { rows } = await pool.query(`select id, tenant_id from publishers where api_key=$1`, [apiKey]);
  return rows[0] ?? null;
}

export default async function routes(fastify: FastifyInstance) {
  // Create a channel bound to a topic
  fastify.post('/v1/admin/channels/create', async (req, reply) => {
    requireAdmin(req);
    const { tenant_id, name, topic_name, short_id } = (req.body ?? {}) as any;
    if (!tenant_id || !name || !topic_name) return reply.status(400).send({ error: 'missing tenant_id/name/topic_name' });

    try {
      const result = await withTxn(async (c) => {
        // ensure topic
        const tr = await c.query(
          `insert into topics (tenant_id, name) values ($1,$2)
           on conflict (tenant_id,name) do update set name=excluded.name
           returning id`,
          [tenant_id, topic_name]
        );
        const topicId = tr.rows[0].id;

        let sid = (short_id as string) || makeShortId();
        // ensure unique short id per tenant
        // If collision, regenerate
        let ok = false;
        for (let i = 0; i < 5 && !ok; i++) {
          try {
            const ins = await c.query(
              `insert into channels (tenant_id, topic_id, name, short_id) values ($1,$2,$3,$4) returning id, short_id`,
              [tenant_id, topicId, name, sid]
            );
            ok = true;
            sid = ins.rows[0].short_id;
          } catch (e: any) {
            const msg = String(e.message || e);
            if (msg.includes('unique') || msg.includes('duplicate')) {
              sid = makeShortId();
            } else {
              throw e;
            }
          }
        }
        return { topicId, short_id: sid };
      });

      return reply.send({ ok: true, short_id: result.short_id });
    } catch (e: any) {
      const msg = String(e?.message || e);
      if (msg.includes('relation') && msg.includes('channels')) {
        return reply.status(500).send({ error: 'channels_table_missing', hint: 'Apply latest SQL migrations to create channels table.' });
      }
      reply.status(500).send({ error: 'internal_error', detail: msg });
    }
  });

  // Publisher-scoped channel create (infer tenant from API key)
  // DEPRECATION: Tenant ID is not required from users; inferred by developer key.
  fastify.post('/v1/channels/create', async (req, reply) => {
    const apiKey = (req.headers.authorization || '').replace('Bearer ', '');
    const pub = await authPublisher(apiKey);
    if (!pub) return reply.status(401).send({ error: 'unauthorized' });
    const { name, topic_name, short_id } = (req.body ?? {}) as any;
    const topicName = (topic_name as string) || 'runs.finished';
    if (!name) return reply.status(400).send({ error: 'missing name' });
    try {
      const result = await withTxn(async (c) => {
        const tr = await c.query(
          `insert into topics (tenant_id, name) values ($1,$2)
           on conflict (tenant_id,name) do update set name=excluded.name
           returning id`,
          [pub.tenant_id, topicName]
        );
        const topicId = tr.rows[0].id;
        let sid = (short_id as string) || makeShortId();
        let ok = false;
        for (let i = 0; i < 5 && !ok; i++) {
          try {
            const ins = await c.query(
              `insert into channels (tenant_id, topic_id, name, short_id) values ($1,$2,$3,$4) returning id, short_id`,
              [pub.tenant_id, topicId, name, sid]
            );
            ok = true;
            sid = ins.rows[0].short_id;
          } catch (e: any) {
            const msg = String(e.message || e);
            if (msg.includes('unique') || msg.includes('duplicate')) sid = makeShortId();
            else throw e;
          }
        }
        return { short_id: sid };
      });
      return reply.send(result);
    } catch (e: any) {
      return reply.status(500).send({ error: 'internal_error', detail: String(e?.message || e) });
    }
  });

  // List channels for a tenant
  fastify.get('/v1/admin/channels/list', async (req, reply) => {
    requireAdmin(req);
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

  // Publisher-scoped list
  fastify.get('/v1/channels/list', async (req, reply) => {
    const apiKey = (req.headers.authorization || '').replace('Bearer ', '');
    const pub = await authPublisher(apiKey);
    if (!pub) return reply.status(401).send({ error: 'unauthorized' });
    const { rows } = await pool.query(
      `select c.id, c.short_id, c.name, t.name as topic
       from channels c join topics t on t.id=c.topic_id
       where c.tenant_id=$1
       order by c.created_at desc`,
      [pub.tenant_id]
    );
    return reply.send({ channels: rows });
  });

  // List users for a given channel short id
  fastify.get('/v1/admin/channels/:short_id/users', async (req, reply) => {
    requireAdmin(req);
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
       where u.tenant_id=$1 order by lower(coalesce(u.phone,u.email)) asc`,
      [tenant_id, topic_id]
    );
    const users = rows.map((r) => ({ user_id: r.user_id, email: r.email, phone: r.phone, online: isUserOnline(r.user_id) }));
    return reply.send({ users });
  });

  // Publisher-scoped users for channel short id (must belong to same tenant)
  fastify.get('/v1/channels/:short_id/users', async (req, reply) => {
    const apiKey = (req.headers.authorization || '').replace('Bearer ', '');
    const pub = await authPublisher(apiKey);
    if (!pub) return reply.status(401).send({ error: 'unauthorized' });
    const params = req.params as any;
    const shortId = params.short_id as string;
    const { rows: chRows } = await pool.query(
      `select tenant_id, topic_id from channels where short_id=$1`,
      [shortId]
    );
    if (chRows.length === 0) return reply.status(404).send({ error: 'not_found' });
    const { tenant_id, topic_id } = chRows[0];
    if (tenant_id !== pub.tenant_id) return reply.status(403).send({ error: 'forbidden' });
    const { rows } = await pool.query(
      `select u.id as user_id, u.email as email, u.phone as phone from users u
       join subscriptions s on s.user_id=u.id and s.tenant_id=u.tenant_id and s.topic_id=$2
       where u.tenant_id=$1 order by lower(coalesce(u.phone,u.email)) asc`,
      [tenant_id, topic_id]
    );
    const users = rows.map((r) => ({ user_id: r.user_id, email: r.email, phone: r.phone, online: isUserOnline(r.user_id) }));
    return reply.send({ users });
  });

  // Publisher-scoped: subscribe a phone number to a channel by short_id
  // Body: { phone: string }
  fastify.post('/v1/channels/:short_id/subscribe', async (req, reply) => {
    const apiKey = (req.headers.authorization || '').replace('Bearer ', '');
    const pub = await authPublisher(apiKey);
    if (!pub) return reply.status(401).send({ error: 'unauthorized' });
    const params = req.params as any;
    const shortId = String(params.short_id || '').trim();
    const body = (req.body ?? {}) as any;
    const phone = String(body.phone || '').trim();
    if (!shortId) return reply.status(400).send({ error: 'missing_short_id' });
    if (!phone) return reply.status(400).send({ error: 'missing_phone' });

    try {
      // Resolve channel within publisher tenant
      const { rows: chRows } = await pool.query(
        `select tenant_id, topic_id from channels where short_id=$1`,
        [shortId]
      );
      if (chRows.length === 0) return reply.status(404).send({ error: 'not_found' });
      const { tenant_id, topic_id } = chRows[0];
      if (tenant_id !== pub.tenant_id) return reply.status(403).send({ error: 'forbidden' });

      // Ensure user and subscription
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        // Ensure user by phone
        let userId: string | null = null;
        await client.query('SAVEPOINT ensure_user');
        try {
          const r = await client.query(
            `insert into users (tenant_id, phone) values ($1,$2)
             on conflict (tenant_id, phone) do update set phone=excluded.phone
             returning id`,
            [tenant_id, phone]
          );
          userId = r.rows[0]?.id ?? null;
        } catch (e) {
          await client.query('ROLLBACK TO SAVEPOINT ensure_user');
          const r2 = await client.query(`select id from users where tenant_id=$1 and phone=$2`, [tenant_id, phone]);
          userId = r2.rows[0]?.id ?? null;
        }
        if (!userId) throw new Error('failed_to_ensure_user');
        // Ensure subscription
        await client.query(
          `insert into subscriptions (tenant_id, user_id, topic_id) values ($1,$2,$3)
           on conflict do nothing`,
          [tenant_id, userId, topic_id]
        );
        await client.query('COMMIT');
        return reply.send({ ok: true, userId });
      } catch (e: any) {
        await (async () => { try { await (pool as any).query('ROLLBACK'); } catch {} })();
        return reply.status(500).send({ error: 'internal_error', detail: String(e?.message || e) });
      } finally {
        try { (client as any)?.release?.(); } catch {}
      }
    } catch (e: any) {
      return reply.status(500).send({ error: 'internal_error', detail: String(e?.message || e) });
    }
  });
}

