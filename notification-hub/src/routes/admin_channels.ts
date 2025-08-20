import { FastifyInstance } from 'fastify';
import { pool, withTxn } from '../db';
import { isUserOnline, pushToSockets } from '../adapters/socket';

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
    const { tenant_id, name, topic_name, short_id, allow_public, description, creator_phone } = (req.body ?? {}) as any;
    if (!tenant_id || !name || !topic_name) return reply.status(400).send({ error: 'missing tenant_id/name/topic_name' });

    try {
      const result = await withTxn(async (c) => {
        // ensure topic
        const tr = await c.query(
          `insert into topics (tenant_id, name) values ($1,$2)
           on conflict on constraint topics_tenant_id_name_key do update set name=excluded.name
           returning id`,
          [tenant_id, topic_name]
        );
        const topicId = tr.rows[0].id;

        let sid = (short_id as string) || makeShortId();
        let chName = name;
        // ensure unique short id per tenant
        let ok = false;
        for (let i = 0; i < 5 && !ok; i++) {
          try {
            const ins = await c.query(
              `insert into channels (tenant_id, topic_id, name, short_id, allow_public, description) values ($1,$2,$3,$4,$5,$6) returning id, short_id, name`,
              [tenant_id, topicId, name, sid, !!allow_public, description ?? null]
            );
            ok = true;
            sid = ins.rows[0].short_id;
            chName = ins.rows[0].name;
          } catch (e: any) {
            const msg = String(e.message || e);
            if (msg.includes('unique') || msg.includes('duplicate')) sid = makeShortId();
            else throw e;
          }
        }

        // Optional: auto-subscribe creator by phone
        if (creator_phone) {
          let userId: string | null = null;
          const ur = await c.query(
            `insert into users (tenant_id, phone) values ($1,$2)
             on conflict on constraint users_tenant_phone_unique do update set phone=excluded.phone
             returning id`,
            [tenant_id, String(creator_phone).trim()]
          );
          userId = ur.rows[0]?.id ?? null;
          if (userId) {
            const sr = await c.query(
              `insert into subscriptions (tenant_id, user_id, topic_id) values ($1,$2,$3)
               on conflict on constraint subscriptions_user_id_topic_id_key do nothing
               returning user_id`,
              [tenant_id, userId, topicId]
            );
            if ((sr.rowCount ?? 0) > 0) {
              try { await pushToSockets(userId, { type: 'notification', title: 'Routed', body: `You have been subscribed to: ${chName}` }); } catch {}
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
      if (msg.includes('no unique or exclusion constraint matching the ON CONFLICT specification') || msg.includes('ON CONFLICT')) {
        return reply.status(500).send({ error: 'schema_mismatch', hint: 'Missing unique constraint required for ON CONFLICT. Ensure users has unique (tenant_id, phone) and topics has unique (tenant_id, name). See /v1/health/schema.' });
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
    const { name, topic_name, short_id, allow_public, description, creator_phone } = (req.body ?? {}) as any;
    const topicName = (topic_name as string) || 'runs.finished';
    if (!name) return reply.status(400).send({ error: 'missing name' });
    try {
      const result = await withTxn(async (c) => {
        const tr = await c.query(
          `insert into topics (tenant_id, name) values ($1,$2)
           on conflict on constraint topics_tenant_id_name_key do update set name=excluded.name
           returning id`,
          [pub.tenant_id, topicName]
        );
        const topicId = tr.rows[0].id;
        let sid = (short_id as string) || makeShortId();
        let chName = name;
        let ok = false;
        for (let i = 0; i < 5 && !ok; i++) {
          try {
            const ins = await c.query(
              `insert into channels (tenant_id, topic_id, name, short_id, allow_public, description) values ($1,$2,$3,$4,$5,$6) returning id, short_id, name`,
              [pub.tenant_id, topicId, name, sid, !!allow_public, description ?? null]
            );
            ok = true;
            sid = ins.rows[0].short_id;
            chName = ins.rows[0].name;
          } catch (e: any) {
            const msg = String(e.message || e);
            if (msg.includes('unique') || msg.includes('duplicate')) sid = makeShortId();
            else throw e;
          }
        }

        // Auto-subscribe creator if provided
        if (creator_phone) {
          let userId: string | null = null;
          const ur = await c.query(
            `insert into users (tenant_id, phone) values ($1,$2)
             on conflict on constraint users_tenant_phone_unique do update set phone=excluded.phone
             returning id`,
            [pub.tenant_id, String(creator_phone).trim()]
          );
          userId = ur.rows[0]?.id ?? null;
          if (userId) {
            const sr = await c.query(
              `insert into subscriptions (tenant_id, user_id, topic_id) values ($1,$2,$3)
               on conflict on constraint subscriptions_user_id_topic_id_key do nothing
               returning user_id`,
              [pub.tenant_id, userId, topicId]
            );
            if ((sr.rowCount ?? 0) > 0) {
              try { await pushToSockets(userId, { type: 'notification', title: 'Routed', body: `You have been subscribed to: ${chName}` }); } catch {}
            }
          }
        }

        return { short_id: sid };
      });
      return reply.send(result);
    } catch (e: any) {
      return reply.status(500).send({ error: 'internal_error', detail: String(e?.message || e) });
    }
  });

  // Public: list channels joined by a user
  fastify.get('/v1/users/:user_id/channels', async (req, reply) => {
    const params = req.params as any;
    const userId = String(params.user_id || '').trim();
    if (!userId) return reply.status(400).send({ error: 'missing_user_id' });
    const { rows } = await pool.query(
      `select c.short_id, c.name, t.name as topic, c.allow_public
       from subscriptions s
       join channels c on c.tenant_id=s.tenant_id and c.topic_id=s.topic_id
       join topics t on t.id=c.topic_id
       where s.user_id=$1
       order by c.created_at desc`,
      [userId]
    );
    return reply.send({ channels: rows });
  });

  // List channels for a tenant
fastify.get('/v1/admin/channels/list', async (req, reply) => {
    requireAdmin(req);
    const url = new URL(req.url ?? '', 'http://localhost');
    const tenantId = url.searchParams.get('tenant_id');
    if (!tenantId) return reply.status(400).send({ error: 'missing tenant_id' });
    const { rows } = await pool.query(
      `select c.id, c.short_id, c.name, c.description, c.allow_public, t.name as topic
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
      `select c.id, c.short_id, c.name, c.description, c.allow_public, t.name as topic
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

// Public join: any verified user may join if channel.allow_public=true
fastify.post('/v1/public/channels/:short_id/join', async (req, reply) => {
    const params = req.params as any;
    const shortId = String(params.short_id || '').trim();
    const body = (req.body ?? {}) as any;
    const phone = String(body.phone || '').trim();
    if (!shortId) return reply.status(400).send({ error: 'missing_short_id' });
    if (!phone) return reply.status(400).send({ error: 'missing_phone' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const ch = await client.query(`select tenant_id, topic_id, allow_public, name from channels where short_id=$1`, [shortId]);
      if (ch.rowCount === 0) { await client.query('ROLLBACK'); return reply.status(404).send({ error: 'not_found' }); }
      const { tenant_id, topic_id, allow_public, name } = ch.rows[0];
      if (!allow_public) { await client.query('ROLLBACK'); return reply.status(403).send({ error: 'forbidden' }); }
      // ensure user by phone under the channel's tenant
      let userId: string | null = null;
      const u = await client.query(
        `insert into users (tenant_id, phone) values ($1,$2)
         on conflict on constraint users_tenant_phone_unique do update set phone=excluded.phone
         returning id`,
        [tenant_id, phone]
      );
      userId = u.rows[0]?.id || null;
      if (!userId) { await client.query('ROLLBACK'); return reply.status(500).send({ error: 'user_ensure_failed' }); }
      const sr = await client.query(
        `insert into subscriptions (tenant_id, user_id, topic_id) values ($1,$2,$3)
         on conflict do nothing
         returning user_id`,
        [tenant_id, userId, topic_id]
      );
      await client.query('COMMIT');
      if ((sr.rowCount ?? 0) > 0) {
        try { await pushToSockets(userId!, { type: 'notification', title: 'Routed', body: `You have been subscribed to: ${name}` }); } catch {}
      }
      return reply.send({ ok: true, userId });
    } catch (e: any) {
      try { await (client as any).query('ROLLBACK'); } catch {}
      return reply.status(500).send({ error: 'internal_error', detail: String(e?.message || e) });
    } finally {
      try { (client as any)?.release?.(); } catch {}
    }
  });

  // Public leave: remove self from a channel by short_id
  fastify.delete('/v1/public/channels/:short_id/leave', async (req, reply) => {
    const params = req.params as any;
    const shortId = String(params.short_id || '').trim();
    const body = (req.body ?? {}) as any;
    const phone = String(body.phone || '').trim();
    if (!shortId) return reply.status(400).send({ error: 'missing_short_id' });
    if (!phone) return reply.status(400).send({ error: 'missing_phone' });
    try {
      const ch = await pool.query(`select tenant_id, topic_id from channels where short_id=$1`, [shortId]);
      if (ch.rowCount === 0) return reply.status(404).send({ error: 'not_found' });
      const { tenant_id, topic_id } = ch.rows[0];
      const u = await pool.query(`select id from users where tenant_id=$1 and phone=$2`, [tenant_id, phone]);
      const userId = u.rows[0]?.id;
      if (!userId) return reply.send({ ok: true });
      await pool.query(`delete from subscriptions where tenant_id=$1 and user_id=$2 and topic_id=$3`, [tenant_id, userId, topic_id]);
      return reply.send({ ok: true });
    } catch (e: any) {
      return reply.status(500).send({ error: 'internal_error', detail: String(e?.message || e) });
    }
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

    // Resolve channel within publisher tenant
    const { rows: chRows } = await pool.query(
      `select tenant_id, topic_id, name from channels where short_id=$1`,
      [shortId]
    );
    if (chRows.length === 0) return reply.status(404).send({ error: 'not_found' });
    const { tenant_id, topic_id, name } = chRows[0];
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
           on conflict on constraint users_tenant_phone_unique do update set phone=excluded.phone
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
      const sr = await client.query(
        `insert into subscriptions (tenant_id, user_id, topic_id) values ($1,$2,$3)
         on conflict do nothing
         returning user_id`,
        [tenant_id, userId, topic_id]
      );
      await client.query('COMMIT');
      if ((sr.rowCount ?? 0) > 0) {
        try { await pushToSockets(userId!, { type: 'notification', title: 'Routed', body: `You have been subscribed to: ${name}` }); } catch {}
      }
      return reply.send({ ok: true, userId });
    } catch (e: any) {
      try { await (client as any).query('ROLLBACK'); } catch {}
      return reply.status(500).send({ error: 'internal_error', detail: String(e?.message || e) });
    } finally {
      try { (client as any)?.release?.(); } catch {}
    }
  });

  // Public discovery of channels (tenant-scoped); optionally exclude already subscribed for phone
  fastify.get('/v1/public/channels', async (req, reply) => {
    try {
      const url = new URL(req.url ?? '', 'http://localhost');
      const tenantId = String(url.searchParams.get('tenant_id') || '').trim();
      const phone = String(url.searchParams.get('phone') || '').trim();
      if (!tenantId) return reply.status(400).send({ error: 'missing_tenant_id' });
      if (phone) {
        const { rows } = await pool.query(
          `with u as (
             select id from users where tenant_id=$1 and phone=$2
           )
           select c.short_id, c.name, c.description, c.allow_public
           from channels c
           where c.tenant_id=$1 and c.allow_public=true and not exists (
             select 1 from u join subscriptions s on s.user_id=u.id and s.tenant_id=$1 and s.topic_id=c.topic_id
           )
           order by c.created_at desc`,
          [tenantId, phone]
        );
        return reply.send({ channels: rows });
      } else {
        const { rows } = await pool.query(
          `select c.short_id, c.name, c.description, c.allow_public
           from channels c where c.tenant_id=$1 and c.allow_public=true
           order by c.created_at desc`,
          [tenantId]
        );
        return reply.send({ channels: rows });
      }
    } catch (e: any) {
      return reply.status(500).send({ error: 'internal_error', detail: String(e?.message || e) });
    }
  });

  // Publisher-scoped unsubscribe by phone
  fastify.delete('/v1/channels/:short_id/unsubscribe', async (req, reply) => {
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
      const { rows: chRows } = await pool.query(`select tenant_id, topic_id from channels where short_id=$1`, [shortId]);
      if (chRows.length === 0) return reply.status(404).send({ error: 'not_found' });
      const { tenant_id, topic_id } = chRows[0];
      if (tenant_id !== pub.tenant_id) return reply.status(403).send({ error: 'forbidden' });
      const u = await pool.query(`select id from users where tenant_id=$1 and phone=$2`, [tenant_id, phone]);
      const userId = u.rows[0]?.id;
      if (userId) await pool.query(`delete from subscriptions where tenant_id=$1 and user_id=$2 and topic_id=$3`, [tenant_id, userId, topic_id]);
      return reply.send({ ok: true });
    } catch (e: any) {
      return reply.status(500).send({ error: 'internal_error', detail: String(e?.message || e) });
    }
  });
}

