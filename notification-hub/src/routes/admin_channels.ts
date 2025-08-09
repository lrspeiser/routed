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
      `select u.id as user_id, u.email as email from users u
       join subscriptions s on s.user_id=u.id and s.tenant_id=u.tenant_id and s.topic_id=$2
       where u.tenant_id=$1 order by lower(u.email) asc`,
      [tenant_id, topic_id]
    );
    const users = rows.map((r) => ({ user_id: r.user_id, email: r.email, online: isUserOnline(r.user_id) }));
    return reply.send({ users });
  });
}


