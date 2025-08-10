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

      // ensure user (support DBs without the unique constraint by falling back)
      let userId: string | null = null;
      await client.query('SAVEPOINT ensure_user');
      try {
        const ur = await client.query(
          `insert into users (tenant_id, email) values ($1,$2)
           on conflict (tenant_id, email) do update set email=excluded.email
           returning id`,
          [tenant_id, email]
        );
        userId = ur.rows[0]?.id ?? null;
      } catch (e: any) {
        // Clear error state for this transaction scope and run fallback path
        await client.query('ROLLBACK TO SAVEPOINT ensure_user');
        const ur2 = await client.query(
          `insert into users (tenant_id, email) values ($1,$2)
           on conflict do nothing
           returning id`,
          [tenant_id, email]
        );
        userId = ur2.rows[0]?.id ?? null;
      }
      if (!userId) {
        const f = await client.query(`select id from users where tenant_id=$1 and email=$2`, [tenant_id, email]);
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
}


