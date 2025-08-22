import { FastifyInstance } from 'fastify';
import { pool, withTxn } from '../db';
import { isUserOnline, pushToSockets } from '../adapters/socket';

async function requireAdmin(req: any) {
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

async function authPublisher(client: any, apiKey?: string) {
  if (!apiKey) return null;
  const { rows } = await client.query(`select id, tenant_id from publishers where api_key=$1`, [apiKey]);
  return rows[0] ?? null;
}

export default async function routes(fastify: FastifyInstance) {
// Create a channel bound to a topic
fastify.post('/v1/admin/channels/create', async (req, reply) => {
    const { tenant_id, name, topic_name, short_id, allow_public, description, creator_phone } = (req.body ?? {}) as any;
    if (!tenant_id || !name || !topic_name) return reply.status(400).send({ error: 'missing tenant_id/name/topic_name' });

    try {
      const sid = await withTxn(async (client) => {
        await requireAdmin(req);
        const tr = await client.query(
          `insert into topics (tenant_id, name) values ($1,$2)
           on conflict (tenant_id, name) do update set name=excluded.name
           returning id`,
          [tenant_id, topic_name]
        );
        const topicId = tr.rows[0].id;

        let sid = (short_id as string) || makeShortId();
        let chName = name;
        let ok = false;
        for (let i = 0; i < 5 && !ok; i++) {
          try {
            const ins = await client.query(
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

        if (creator_phone) {
          let userId: string | null = null;
          let ur;
          // Use column-based ON CONFLICT instead of constraint name
          ur = await client.query(
            `insert into users (tenant_id, phone) values ($1,$2)
             on conflict (tenant_id, phone) do update set phone=excluded.phone
             returning id`,
            [tenant_id, String(creator_phone).trim()]
          );
          userId = ur.rows[0]?.id ?? null;
          if (userId) {
            const sr = await client.query(
              `insert into subscriptions (tenant_id, user_id, topic_id) values ($1,$2,$3)
               on conflict (user_id, topic_id) do nothing
               returning user_id`,
              [tenant_id, userId, topicId]
            );
            if ((sr.rowCount ?? 0) > 0) {
              try { await pushToSockets(userId, { type: 'notification', title: 'Routed', body: `You have been subscribed to: ${chName}` }); } catch {}
            }
          }
        }
        return sid;
      });
      return reply.send({ ok: true, short_id: sid });
    } catch (e: any) {
      if (e.message === 'unauthorized') {
        return reply.status(401).send({ error: 'unauthorized' });
      }
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
    const { name, topic_name, short_id, allow_public, description, creator_phone } = (req.body ?? {}) as any;
    const topicName = (topic_name as string) || 'runs.finished';
    
    console.log('[CHANNEL_CREATE] Starting with:', { 
      name, topic_name, short_id, allow_public, description, 
      creator_phone: creator_phone ? '***' + String(creator_phone).slice(-4) : 'none',
      apiKey: apiKey ? '***' + apiKey.slice(-6) : 'none'
    });
    
    if (!name) return reply.status(400).send({ error: 'missing name' });

    try {
      const sid = await withTxn(async (client) => {
        console.log('[CHANNEL_CREATE] Transaction started');
        
        const pub = await authPublisher(client, apiKey);
        console.log('[CHANNEL_CREATE] Publisher auth result:', pub ? { id: pub.id, tenant_id: pub.tenant_id } : null);
        if (!pub) throw new Error('unauthorized');

        // WORKAROUND: SELECT-then-INSERT pattern instead of ON CONFLICT
        // See docs/ON_CONFLICT_WORKAROUND.md for why we can't use ON CONFLICT
        // Render's PostgreSQL doesn't have the required unique constraints
        console.log('[CHANNEL_CREATE] Checking for existing topic:', { tenant_id: pub.tenant_id, topicName });
        let tr;
        try {
          tr = await client.query(
            `select id from topics where tenant_id=$1 and name=$2`,
            [pub.tenant_id, topicName]
          );
          console.log('[CHANNEL_CREATE] Topic SELECT result:', { rowCount: tr.rows.length, rows: tr.rows });
        } catch (e: any) {
          console.error('[CHANNEL_CREATE] Topic SELECT failed:', e.message);
          throw e;
        }
        
        if (tr.rows.length === 0) {
          // Create new topic only if it doesn't exist
          console.log('[CHANNEL_CREATE] Creating new topic');
          try {
            tr = await client.query(
              `insert into topics (tenant_id, name) values ($1,$2) returning id`,
              [pub.tenant_id, topicName]
            );
            console.log('[CHANNEL_CREATE] Topic INSERT result:', tr.rows);
          } catch (e: any) {
            console.error('[CHANNEL_CREATE] Topic INSERT failed:', e.message);
            throw e;
          }
        }
        const topicId = tr.rows[0].id;
        console.log('[CHANNEL_CREATE] Using topicId:', topicId);
        let sid = (short_id as string) || makeShortId();
        let chName = name;
        let ok = false;
        for (let i = 0; i < 5 && !ok; i++) {
          try {
            const ins = await client.query(
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

        if (creator_phone) {
          let userId: string | null = null;
          const phoneNormalized = String(creator_phone).trim();
          
          // CRITICAL FIX: First check if this phone has a verified user in 'system' tenant
          // This ensures we use the same userId that was created during phone verification
          // preventing the user ID mismatch that causes offline status
          console.log('[CHANNEL_CREATE] Looking for verified user with phone:', phoneNormalized);
          
          // Get the system tenant ID
          const systemTenant = await client.query(
            `select id from tenants where name='system' limit 1`
          );
          
          if (systemTenant.rows.length > 0) {
            const systemTenantId = systemTenant.rows[0].id;
            const verifiedUser = await client.query(
              `select id, dev_id from users where tenant_id=$1 and phone=$2 and phone_verified_at is not null limit 1`,
              [systemTenantId, phoneNormalized]
            );
            
            if (verifiedUser.rows.length > 0) {
              // Use the verified user from system tenant
              userId = verifiedUser.rows[0].id;
              console.log('[CHANNEL_CREATE] Using verified user from system tenant:', { 
                userId, 
                devId: verifiedUser.rows[0].dev_id 
              });
            }
          }
          
          // If no verified user found, fall back to publisher's tenant (backwards compatibility)
          if (!userId) {
            console.log('[CHANNEL_CREATE] No verified user found, checking publisher tenant');
            // WORKAROUND: SELECT-then-INSERT pattern instead of ON CONFLICT
            // See docs/ON_CONFLICT_WORKAROUND.md for full explanation
            // Required because Render's DB lacks unique constraint on (tenant_id, phone)
            const existingUser = await client.query(
              `select id from users where tenant_id=$1 and phone=$2`,
              [pub.tenant_id, phoneNormalized]
            );
            if (existingUser.rows.length > 0) {
              userId = existingUser.rows[0].id;
            } else {
              // Create new user only if doesn't exist
              const newUser = await client.query(
                `insert into users (tenant_id, phone) values ($1,$2) returning id`,
                [pub.tenant_id, phoneNormalized]
              );
              userId = newUser.rows[0]?.id ?? null;
            }
          }
          if (userId) {
            // CRITICAL: Get the correct tenant_id for the user (could be 'system' or publisher tenant)
            const userTenantQuery = await client.query(
              `select tenant_id from users where id=$1`,
              [userId]
            );
            const userTenantId = userTenantQuery.rows[0]?.tenant_id || pub.tenant_id;
            console.log('[CHANNEL_CREATE] Using tenant for subscription:', { userId, userTenantId });
            
            // WORKAROUND: SELECT-then-INSERT for subscriptions too
            // See docs/ON_CONFLICT_WORKAROUND.md
            // ON CONFLICT (user_id, topic_id) fails on Render
            const existingSub = await client.query(
              `select 1 from subscriptions where user_id=$1 and topic_id=$2`,
              [userId, topicId]
            );
            let sr = { rowCount: 0 };
            if (existingSub.rows.length === 0) {
              sr = await client.query(
                `insert into subscriptions (tenant_id, user_id, topic_id) values ($1,$2,$3) returning user_id`,
                [userTenantId, userId, topicId]
              );
            }
            if ((sr.rowCount ?? 0) > 0) {
              try { await pushToSockets(userId, { type: 'notification', title: 'Routed', body: `You have been subscribed to: ${chName}` }); } catch {}
            }
          }
        }
        return sid;
      });
      return reply.send({ ok: true, short_id: sid });
    } catch (e: any) {
      if (e.message === 'unauthorized') {
        return reply.status(401).send({ error: 'unauthorized' });
      }
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
    try {
      const channels = await withTxn(async (client) => {
        const pub = await authPublisher(client, apiKey);
        if (!pub) throw new Error('unauthorized');
        const { rows } = await client.query(
          `select c.id, c.short_id, c.name, c.description, c.allow_public, t.name as topic
           from channels c join topics t on t.id=c.topic_id
           where c.tenant_id=$1
           order by c.created_at desc`,
          [pub.tenant_id]
        );
        return rows;
      });
      return reply.send({ channels });
    } catch (e: any) {
      if (e.message === 'unauthorized') {
        return reply.status(401).send({ error: 'unauthorized' });
      }
      return reply.status(500).send({ error: 'internal_error', detail: String(e?.message || e) });
    }
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
    const params = req.params as any;
    const shortId = params.short_id as string;
    try {
      const users = await withTxn(async (client) => {
        const pub = await authPublisher(client, apiKey);
        if (!pub) throw new Error('unauthorized');
        const { rows: chRows } = await client.query(
          `select tenant_id, topic_id from channels where short_id=$1`,
          [shortId]
        );
        if (chRows.length === 0) throw new Error('not_found');
        const { tenant_id, topic_id } = chRows[0];
        if (tenant_id !== pub.tenant_id) throw new Error('forbidden');
        const { rows } = await client.query(
          `select u.id as user_id, u.email as email, u.phone as phone from users u
           join subscriptions s on s.user_id=u.id and s.tenant_id=u.tenant_id and s.topic_id=$2
           where u.tenant_id=$1 order by lower(coalesce(u.phone,u.email)) asc`,
          [tenant_id, topic_id]
        );
        return rows.map((r: any) => ({ user_id: r.user_id, email: r.email, phone: r.phone, online: isUserOnline(r.user_id) }));
      });
      return reply.send({ users });
    } catch (e: any) {
      if (e.message === 'unauthorized') return reply.status(401).send({ error: 'unauthorized' });
      if (e.message === 'not_found') return reply.status(404).send({ error: 'not_found' });
      if (e.message === 'forbidden') return reply.status(403).send({ error: 'forbidden' });
      return reply.status(500).send({ error: 'internal_error', detail: String(e?.message || e) });
    }
  });

// Public join: any verified user may join if channel.allow_public=true
fastify.post('/v1/public/channels/:short_id/join', async (req, reply) => {
    const params = req.params as any;
    const shortId = String(params.short_id || '').trim();
    const body = (req.body ?? {}) as any;
    const phone = String(body.phone || '').trim();
    if (!shortId) return reply.status(400).send({ error: 'missing_short_id' });
    if (!phone) return reply.status(400).send({ error: 'missing_phone' });

    try {
      const userId = await withTxn(async (client) => {
        const ch = await client.query(`select tenant_id, topic_id, allow_public, name from channels where short_id=$1`, [shortId]);
        if (ch.rowCount === 0) {
          reply.status(404).send({ error: 'not_found' });
          return;
        }
        const { tenant_id, topic_id, allow_public, name } = ch.rows[0];
        if (!allow_public) {
          reply.status(403).send({ error: 'forbidden' });
          return;
        }
        
        let userId: string | null = null;
        let u;
        // Use column-based ON CONFLICT
        u = await client.query(
          `insert into users (tenant_id, phone) values ($1,$2)
           on conflict (tenant_id, phone) do update set phone=excluded.phone
           returning id`,
          [tenant_id, phone]
        );
        userId = u.rows[0]?.id || null;
        if (!userId) throw new Error('user_ensure_failed');
        
        const sr = await client.query(
          `insert into subscriptions (tenant_id, user_id, topic_id) values ($1,$2,$3)
           on conflict do nothing
           returning user_id`,
          [tenant_id, userId, topic_id]
        );

        if ((sr.rowCount ?? 0) > 0) {
          try { await pushToSockets(userId!, { type: 'notification', title: 'Routed', body: `You have been subscribed to: ${name}` }); } catch {}
        }
        return userId;
      });

      if (userId) {
        return reply.send({ ok: true, userId });
      }
    } catch (e: any) {
      if (e.message === 'user_ensure_failed') {
        return reply.status(500).send({ error: 'user_ensure_failed' });
      }
      return reply.status(500).send({ error: 'internal_error', detail: String(e?.message || e) });
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
    const params = req.params as any;
    const shortId = String(params.short_id || '').trim();
    const body = (req.body ?? {}) as any;
    const phone = String(body.phone || '').trim();
    if (!shortId) return reply.status(400).send({ error: 'missing_short_id' });
    if (!phone) return reply.status(400).send({ error: 'missing_phone' });

    try {
      const userId = await withTxn(async (client) => {
        const pub = await authPublisher(client, apiKey);
        if (!pub) throw new Error('unauthorized');

        const { rows: chRows } = await client.query(
          `select tenant_id, topic_id, name from channels where short_id=$1`,
          [shortId]
        );
        if (chRows.length === 0) throw new Error('not_found');
        const { tenant_id, topic_id, name } = chRows[0];
        if (tenant_id !== pub.tenant_id) throw new Error('forbidden');

        let userId: string | null = null;
        try {
          let r;
          // Use column-based ON CONFLICT
          r = await client.query(
            `insert into users (tenant_id, phone) values ($1,$2)
             on conflict (tenant_id, phone) do update set phone=excluded.phone
             returning id`,
            [tenant_id, phone]
          );
          userId = r.rows[0]?.id ?? null;
        } catch (e) {
          const r2 = await client.query(`select id from users where tenant_id=$1 and phone=$2`, [tenant_id, phone]);
          userId = r2.rows[0]?.id ?? null;
        }
        if (!userId) throw new Error('failed_to_ensure_user');

        const sr = await client.query(
          `insert into subscriptions (tenant_id, user_id, topic_id) values ($1,$2,$3)
           on conflict do nothing
           returning user_id`,
          [tenant_id, userId, topic_id]
        );

        if ((sr.rowCount ?? 0) > 0) {
          try { await pushToSockets(userId!, { type: 'notification', title: 'Routed', body: `You have been subscribed to: ${name}` }); } catch {}
        }
        return userId;
      });

      return reply.send({ ok: true, userId });
    } catch (e: any) {
      if (e.message === 'unauthorized') return reply.status(401).send({ error: 'unauthorized' });
      if (e.message === 'not_found') return reply.status(404).send({ error: 'not_found' });
      if (e.message === 'forbidden') return reply.status(403).send({ error: 'forbidden' });
      if (e.message === 'failed_to_ensure_user') return reply.status(500).send({ error: 'failed_to_ensure_user' });
      return reply.status(500).send({ error: 'internal_error', detail: String(e?.message || e) });
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

  // Publisher-scoped unsubscribe by userId (for removing users without phone/email)
  fastify.delete('/v1/channels/:short_id/unsubscribe/user/:user_id', async (req, reply) => {
    const apiKey = (req.headers.authorization || '').replace('Bearer ', '');
    const params = req.params as any;
    const shortId = String(params.short_id || '').trim();
    const userId = String(params.user_id || '').trim();
    if (!shortId) return reply.status(400).send({ error: 'missing_short_id' });
    if (!userId) return reply.status(400).send({ error: 'missing_user_id' });
    
    try {
      await withTxn(async (client) => {
        const pub = await authPublisher(client, apiKey);
        if (!pub) throw new Error('unauthorized');
        const { rows: chRows } = await client.query(`select tenant_id, topic_id from channels where short_id=$1`, [shortId]);
        if (chRows.length === 0) throw new Error('not_found');
        const { tenant_id, topic_id } = chRows[0];
        if (tenant_id !== pub.tenant_id) throw new Error('forbidden');
        
        // Verify the user exists and belongs to this tenant
        const u = await client.query(`select id from users where id=$1 and tenant_id=$2`, [userId, tenant_id]);
        if (u.rows.length === 0) throw new Error('user_not_found');
        
        await client.query(`delete from subscriptions where tenant_id=$1 and user_id=$2 and topic_id=$3`, [tenant_id, userId, topic_id]);
      });
      return reply.send({ ok: true });
    } catch (e: any) {
      if (e.message === 'unauthorized') return reply.status(401).send({ error: 'unauthorized' });
      if (e.message === 'not_found') return reply.status(404).send({ error: 'channel_not_found' });
      if (e.message === 'user_not_found') return reply.status(404).send({ error: 'user_not_found' });
      if (e.message === 'forbidden') return reply.status(403).send({ error: 'forbidden' });
      return reply.status(500).send({ error: 'internal_error', detail: String(e?.message || e) });
    }
  });

  // Publisher-scoped unsubscribe by phone
fastify.delete('/v1/channels/:short_id/unsubscribe', async (req, reply) => {
    const apiKey = (req.headers.authorization || '').replace('Bearer ', '');
    const params = req.params as any;
    const shortId = String(params.short_id || '').trim();
    const body = (req.body ?? {}) as any;
    const phone = String(body.phone || '').trim();
    if (!shortId) return reply.status(400).send({ error: 'missing_short_id' });
    if (!phone) return reply.status(400).send({ error: 'missing_phone' });
    try {
      await withTxn(async (client) => {
        const pub = await authPublisher(client, apiKey);
        if (!pub) throw new Error('unauthorized');
        const { rows: chRows } = await client.query(`select tenant_id, topic_id from channels where short_id=$1`, [shortId]);
        if (chRows.length === 0) throw new Error('not_found');
        const { tenant_id, topic_id } = chRows[0];
        if (tenant_id !== pub.tenant_id) throw new Error('forbidden');
        const u = await client.query(`select id from users where tenant_id=$1 and phone=$2`, [tenant_id, phone]);
        const userId = u.rows[0]?.id;
        if (userId) await client.query(`delete from subscriptions where tenant_id=$1 and user_id=$2 and topic_id=$3`, [tenant_id, userId, topic_id]);
      });
      return reply.send({ ok: true });
    } catch (e: any) {
      if (e.message === 'unauthorized') return reply.status(401).send({ error: 'unauthorized' });
      if (e.message === 'not_found') return reply.status(404).send({ error: 'not_found' });
      if (e.message === 'forbidden') return reply.status(403).send({ error: 'forbidden' });
      return reply.status(500).send({ error: 'internal_error', detail: String(e?.message || e) });
    }
  });
}

