import { FastifyInstance } from 'fastify';
import { pool } from '../db';
import { isUserOnline } from '../adapters/socket';

function requireAdmin(req: any) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!process.env.HUB_ADMIN_TOKEN || token !== process.env.HUB_ADMIN_TOKEN) {
    const err: any = new Error('unauthorized');
    err.statusCode = 401;
    throw err;
  }
}

// Publisher auth: infer tenant from API key (developer key).
// Note: Tenant ID remains a core internal concept, but is deprecated as a user-facing field.
async function authPublisher(apiKey?: string) {
  if (!apiKey) return null;
  const { rows } = await pool.query(`select id, tenant_id from publishers where api_key=$1`, [apiKey]);
  return rows[0] ?? null;
}

export default async function routes(fastify: FastifyInstance) {
  // Ensure a user exists by identifier (phone preferred; email supported for legacy) for a tenant and is subscribed to a topic.
  fastify.post('/v1/admin/users/ensure', async (req, reply) => {
    requireAdmin(req);
    const { tenant_id, email, phone, topic } = (req.body ?? {}) as any;
    if (!tenant_id || (!phone && !email)) return reply.status(400).send({ error: 'missing tenant_id/phone' });
    const topicName = (topic as string) || 'runs.finished';

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // ensure user by phone first; fallback to email for legacy
      let userId: string | null = null;
      await client.query('SAVEPOINT ensure_user');
      try {
        if (phone) {
          const r = await client.query(
            `insert into users (tenant_id, phone) values ($1,$2)
             on conflict (tenant_id, phone) do update set phone=excluded.phone
             returning id`,
            [tenant_id, phone]
          );
          userId = r.rows[0]?.id ?? null;
        } else if (email) {
          const r = await client.query(
            `insert into users (tenant_id, email) values ($1,$2)
             on conflict (tenant_id, email) do update set email=excluded.email
             returning id`,
            [tenant_id, email]
          );
          userId = r.rows[0]?.id ?? null;
        }
      } catch (e: any) {
        // Clear error state for this transaction scope and run fallback path
        await client.query('ROLLBACK TO SAVEPOINT ensure_user');
        if (phone) {
          const r2 = await client.query(
            `insert into users (tenant_id, phone) values ($1,$2)
             on conflict do nothing
             returning id`,
            [tenant_id, phone]
          );
          userId = r2.rows[0]?.id ?? null;
        } else if (email) {
          const r2 = await client.query(
            `insert into users (tenant_id, email) values ($1,$2)
             on conflict do nothing
             returning id`,
            [tenant_id, email]
          );
          userId = r2.rows[0]?.id ?? null;
        }
      }
      if (!userId) {
        const f = phone
          ? await client.query(`select id from users where tenant_id=$1 and phone=$2`, [tenant_id, phone])
          : await client.query(`select id from users where tenant_id=$1 and email=$2`, [tenant_id, email]);
        userId = f.rows[0]?.id ?? null;
      }
      if (!userId) throw new Error('failed_to_ensure_user');

      // ensure topic
      await client.query('SAVEPOINT ensure_topic');
      let topicId: string;
      try {
        const tr = await client.query(
          `insert into topics (tenant_id, name) values ($1,$2)
           on conflict (tenant_id,name) do update set name=excluded.name
           returning id`,
          [tenant_id, topicName]
        );
        topicId = tr.rows[0].id;
      } catch (e: any) {
        await client.query('ROLLBACK TO SAVEPOINT ensure_topic');
        const tr2 = await client.query(`select id from topics where tenant_id=$1 and name=$2`, [tenant_id, topicName]);
        const hasExisting = (tr2.rowCount ?? 0) > 0 && tr2.rows.length > 0;
        if (hasExisting) topicId = tr2.rows[0].id; else {
          const ins = await client.query(`insert into topics (tenant_id, name) values ($1,$2) returning id`, [tenant_id, topicName]);
          topicId = ins.rows[0].id;
        }
      }

      // ensure subscription
      await client.query('SAVEPOINT ensure_sub');
      try {
        await client.query(
          `insert into subscriptions (tenant_id, user_id, topic_id) values ($1,$2,$3)
           on conflict do nothing`,
          [tenant_id, userId, topicId]
        );
      } catch (e: any) {
        await client.query('ROLLBACK TO SAVEPOINT ensure_sub');
      }

      await client.query('COMMIT');
      return reply.send({ userId, topicId });
    } catch (e) {
      await client.query('ROLLBACK');
      fastify.log.error(e);
      return reply.status(500).send({ error: 'internal_error', detail: String((e as any)?.message || e) });
    } finally {
      client.release();
    }
  });

  // Publisher-scoped equivalent (no admin token). Tenant inferred from API key.
  // DEPRECATION: tenant_id is internal; user-facing flows must not require it.
  fastify.post('/v1/users/ensure', async (req, reply) => {
    const apiKey = (req.headers.authorization || '').replace('Bearer ', '');
    const pub = await authPublisher(apiKey);
    if (!pub) return reply.status(401).send({ error: 'unauthorized' });
    const { email, phone, topic } = (req.body ?? {}) as any;
    if (!phone && !email) return reply.status(400).send({ error: 'missing phone/email' });
    const topicName = (topic as string) || 'runs.finished';

    // Reuse the logic above but with inferred tenant_id
    (req as any).body = { tenant_id: pub.tenant_id, email, phone, topic: topicName };
    return fastify.inject({
      method: 'POST',
      url: '/v1/admin/users/ensure',
      payload: (req as any).body,
      headers: { authorization: `Bearer ${process.env.HUB_ADMIN_TOKEN || 'publisher'}` },
    }).then((res) => reply.status(res.statusCode).send(res.json()));
  });

  // List emails subscribed for tenant/topic and online status
  fastify.get('/v1/admin/users/list', async (req, reply) => {
    requireAdmin(req);
    const url = new URL(req.url ?? '', 'http://localhost');
    const tenantId = url.searchParams.get('tenant_id');
    const topic = url.searchParams.get('topic') || 'runs.finished';
    if (!tenantId) return reply.status(400).send({ error: 'missing tenant_id' });

    const { rows } = await pool.query(
      `select u.id as user_id, u.email as email
       from users u
       join subscriptions s on s.user_id=u.id and s.tenant_id=u.tenant_id
       join topics t on t.id=s.topic_id and t.tenant_id=u.tenant_id and t.name=$2
       where u.tenant_id=$1
         and u.email is not null
         and length(trim(u.email)) > 0
       order by lower(u.email) asc`,
      [tenantId, topic]
    );

    const users = rows.map((r) => ({ user_id: r.user_id, email: r.email, online: isUserOnline(r.user_id) }));
    return reply.send({ users });
  });

  // Publisher-scoped list
  fastify.get('/v1/users/list', async (req, reply) => {
    const apiKey = (req.headers.authorization || '').replace('Bearer ', '');
    const pub = await authPublisher(apiKey);
    if (!pub) return reply.status(401).send({ error: 'unauthorized' });
    const url = new URL(req.url ?? '', 'http://localhost');
    const topic = url.searchParams.get('topic') || 'runs.finished';
    const { rows } = await pool.query(
      `select u.id as user_id, u.email as email
       from users u
       join subscriptions s on s.user_id=u.id and s.tenant_id=u.tenant_id
       join topics t on t.id=s.topic_id and t.tenant_id=u.tenant_id and t.name=$2
       where u.tenant_id=$1
         and u.email is not null
         and length(trim(u.email)) > 0
       order by lower(u.email) asc`,
      [pub.tenant_id, topic]
    );
    const users = rows.map((r) => ({ user_id: r.user_id, email: r.email, online: isUserOnline(r.user_id) }));
    return reply.send({ users });
  });

  // Remove an email's subscription to a topic
  fastify.post('/v1/admin/users/remove', async (req, reply) => {
    requireAdmin(req);
    const { tenant_id, email, topic } = (req.body ?? {}) as any;
    if (!tenant_id || !email) return reply.status(400).send({ error: 'missing tenant_id/email' });
    const topicName = (topic as string) || 'runs.finished';

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const u = await client.query(`select id from users where tenant_id=$1 and email=$2`, [tenant_id, email]);
      if (u.rowCount === 0) {
        await client.query('ROLLBACK');
        return reply.send({ ok: true });
      }
      const userId = u.rows[0].id;
      const t = await client.query(`select id from topics where tenant_id=$1 and name=$2`, [tenant_id, topicName]);
      const topicRowCount = (t.rowCount ?? 0);
      if (topicRowCount > 0 && t.rows.length > 0) {
        const topicId = t.rows[0].id;
        await client.query(`delete from subscriptions where tenant_id=$1 and user_id=$2 and topic_id=$3`, [tenant_id, userId, topicId]);
      }
      await client.query('COMMIT');
      return reply.send({ ok: true });
    } catch (e) {
      await client.query('ROLLBACK');
      fastify.log.error(e);
      return reply.status(500).send({ error: 'internal_error' });
    } finally {
      client.release();
    }
  });

  // Publisher-scoped remove
  fastify.post('/v1/users/remove', async (req, reply) => {
    const apiKey = (req.headers.authorization || '').replace('Bearer ', '');
    const pub = await authPublisher(apiKey);
    if (!pub) return reply.status(401).send({ error: 'unauthorized' });
    const { email, topic } = (req.body ?? {}) as any;
    if (!email) return reply.status(400).send({ error: 'missing email' });
    const topicName = (topic as string) || 'runs.finished';

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const u = await client.query(`select id from users where tenant_id=$1 and email=$2`, [pub.tenant_id, email]);
      if (u.rowCount === 0) {
        await client.query('ROLLBACK');
        return reply.send({ ok: true });
      }
      const userId = u.rows[0].id;
      const t = await client.query(`select id from topics where tenant_id=$1 and name=$2`, [pub.tenant_id, topicName]);
      const topicRowCount = (t.rowCount ?? 0);
      if (topicRowCount > 0 && t.rows.length > 0) {
        const topicId = t.rows[0].id;
        await client.query(`delete from subscriptions where tenant_id=$1 and user_id=$2 and topic_id=$3`, [pub.tenant_id, userId, topicId]);
      }
      await client.query('COMMIT');
      return reply.send({ ok: true });
    } catch (e) {
      await client.query('ROLLBACK');
      fastify.log.error(e);
      return reply.status(500).send({ error: 'internal_error' });
    } finally {
      client.release();
    }
  });
}


