import { FastifyInstance } from 'fastify';
import { ENV } from '../env';
import { withTxn, pool } from '../db';
import { fanoutQueue } from '../queues';
import { pushToSockets } from '../adapters/socket';

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
    const ip = (req.headers['x-forwarded-for'] as string) || (req as any).ip;
    const startedAt = Date.now();
    console.log('[HTTP] POST /v1/messages', { ip, ts: startedAt });
    const apiKey = (req.headers.authorization || '').replace('Bearer ', '');
    const pub = await authPublisher(apiKey);
    if (!pub) {
      console.warn('[AUTH] Invalid publisher key', { ip });
      return reply.status(401).send({ error: 'unauthorized' });
    }

    const { topic, title, body, payload, ttl_sec, dedupe_key } = (req.body ?? {}) as any;
    console.log('[HTTP] /v1/messages payload', { topic, hasTitle: Boolean(title), hasBody: Boolean(body) });
    if (!topic || !title || !body) {
      return reply.status(400).send({ error: 'missing required fields (topic,title,body)' });
    }

    const ttl = Number(ttl_sec ?? ENV.DEFAULT_TTL_SEC);
    const expiresAtSql = `now() + interval '${ttl} seconds'`;

    try {
      const result = await withTxn(async (c) => {
        const q1Start = Date.now();
        const topicRow = await c.query(
          `select id from topics where tenant_id=$1 and name=$2`,
          [pub.tenant_id, topic]
        );
        console.log('[DB] select topics', { ms: Date.now() - q1Start });
        let topicId = topicRow.rows[0]?.id;
        if (!topicId) {
          const q2Start = Date.now();
          const ins = await c.query(
            `insert into topics (tenant_id, name) values ($1, $2) returning id`,
            [pub.tenant_id, topic]
          );
          console.log('[DB] insert topic', { ms: Date.now() - q2Start });
          topicId = ins.rows[0].id;
          console.log(`[TOPIC] Created topic '${topic}' id=${topicId}`);
        }

        const q3Start = Date.now();
        const msg = await c.query(
          `
          insert into messages (tenant_id, topic_id, publisher_id, title, body, payload, ttl_sec, expires_at, dedupe_key)
          values ($1,$2,$3,$4,$5,$6,$7, ${expiresAtSql}, $8)
          returning id
          `,
          [pub.tenant_id, topicId, pub.id, title, body, payload ?? null, ttl, dedupe_key ?? null]
        );
        console.log('[DB] insert message', { ms: Date.now() - q3Start });
        const messageId = msg.rows[0].id;
        console.log('[MSG] Inserted', { messageId, tenantId: pub.tenant_id, topic, title: String(title).slice(0, 120) });
        return { messageId, topicId };
      });

      // Fast-path socket delivery (low latency, bypass queue)
      const deliveryDetails: any[] = [];
      try {
        const fastStart = Date.now();
        
        // Get detailed subscription info
        const subs = await pool.query(
          `select s.user_id, u.phone, u.email, s.created_at 
           from subscriptions s 
           join users u on s.user_id = u.id 
           where s.tenant_id=$1 and s.topic_id=$2`,
          [pub.tenant_id, (result as any).topicId]
        );
        
        console.log('[MESSAGE] Found subscribers:', {
          messageId: result.messageId,
          topic,
          tenant_id: pub.tenant_id,
          topic_id: (result as any).topicId,
          subscriber_count: subs.rows.length,
          subscribers: subs.rows.map((r: any) => ({
            user_id: r.user_id,
            phone: r.phone,
            email: r.email,
            subscribed_at: r.created_at
          }))
        });
        
        let pushed = 0;
        const envelope = { title, body, payload: payload ?? null };
        
        for (const r of subs.rows as Array<{ user_id: string; phone: string; email: string }>) {
          const ok = await pushToSockets(r.user_id, { type: 'notification', ...envelope });
          deliveryDetails.push({
            user_id: r.user_id,
            phone: r.phone,
            email: r.email,
            socket_delivery: ok ? 'success' : 'no_active_socket',
            timestamp: new Date().toISOString()
          });
          if (ok) {
            pushed++;
            console.log(`[DELIVERY] Socket push SUCCESS to user=${r.user_id} phone=${r.phone}`);
          } else {
            console.log(`[DELIVERY] Socket push FAILED (user offline) user=${r.user_id} phone=${r.phone}`);
          }
        }
        
        console.log('[SOCKET][FASTPATH] Delivery summary:', { 
          messageId: result.messageId,
          total_subscribers: subs.rows.length, 
          delivered_via_socket: pushed,
          offline_users: subs.rows.length - pushed,
          ms: Date.now() - fastStart,
          delivery_details: deliveryDetails
        });
      } catch (e: any) {
        console.error('[SOCKET][FASTPATH] error', String(e?.message || e));
      }

      let enqueued = false;
      let enqueueTimedOut = false;
      let enqueueError: string | null = null;
      const enqueueStart = Date.now();
      try {
        await Promise.race([
          (async () => { await fanoutQueue.add('fanout', { messageId: result.messageId }, { removeOnComplete: 1000, removeOnFail: 1000 }); enqueued = true; })(),
          new Promise((_r, rej) => setTimeout(() => { enqueueTimedOut = true; rej(new Error('enqueue_timeout')); }, 8000)),
        ]);
      } catch (e: any) {
        enqueueError = String(e?.message || e);
      }
      console.log('[ENQUEUE] Attempt', { messageId: result.messageId, enqueued, enqueueTimedOut, enqueueError, ms: Date.now() - enqueueStart, totalMs: Date.now() - startedAt });
      // Respond regardless; worker may process later if enqueued succeeded after timeout
      if (!enqueued && enqueueTimedOut) {
        // Best-effort response
        return reply.status(202).send({ message_id: result.messageId, enqueue: 'timeout' });
      }
      console.log('[ENQUEUE] Fanout queued', { messageId: result.messageId });
      
      // Return detailed response with delivery info
      return reply.status(202).send({ 
        message_id: result.messageId,
        delivery_summary: {
          total_subscribers: deliveryDetails.length,
          socket_delivered: deliveryDetails.filter(d => d.socket_delivery === 'success').length,
          queued_for_retry: deliveryDetails.filter(d => d.socket_delivery !== 'success').length,
          details: deliveryDetails
        }
      });
    } catch (e: any) {
      if (String(e.message).includes('duplicate key value violates unique constraint') && dedupe_key) {
        console.warn('[DEDUPE] Duplicate dedupe_key; returning 200 with existing reference', { tenantId: pub.tenant_id, dedupe_key });
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
  
  // Debug endpoint to check subscription status
  fastify.get('/v1/debug/subscription-check', async (req, reply) => {
    const { phone, channel_id, user_id } = req.query as any;
    
    if (!phone && !user_id) {
      return reply.status(400).send({ error: 'Provide either phone or user_id' });
    }
    
    try {
      // Find user
      let userQuery;
      if (user_id) {
        userQuery = await pool.query(
          `select u.*, t.name as tenant_name 
           from users u 
           join tenants t on u.tenant_id = t.id 
           where u.id = $1`,
          [user_id]
        );
      } else {
        userQuery = await pool.query(
          `select u.*, t.name as tenant_name 
           from users u 
           join tenants t on u.tenant_id = t.id 
           where u.phone = $1`,
          [phone]
        );
      }
      
      if (userQuery.rows.length === 0) {
        return reply.send({ 
          user_found: false,
          message: 'User not found in database'
        });
      }
      
      const user = userQuery.rows[0];
      
      // Get all subscriptions for this user
      const subsQuery = await pool.query(
        `select s.*, t.name as topic_name, c.short_id as channel_id, c.name as channel_name
         from subscriptions s
         join topics t on s.topic_id = t.id
         left join channels c on c.topic_id = t.id and c.tenant_id = s.tenant_id
         where s.user_id = $1
         order by s.created_at desc`,
        [user.id]
      );
      
      // Check if user is online
      const { isUserOnline } = await import('../adapters/socket');
      const online = isUserOnline(user.id);
      
      // If channel_id provided, check specific channel
      let channelInfo = null;
      if (channel_id) {
        const channelQuery = await pool.query(
          `select c.*, t.name as topic_name 
           from channels c 
           join topics t on c.topic_id = t.id 
           where c.short_id = $1`,
          [channel_id]
        );
        
        if (channelQuery.rows.length > 0) {
          const channel = channelQuery.rows[0];
          const isSubscribed = subsQuery.rows.some((s: any) => 
            s.topic_id === channel.topic_id && s.tenant_id === channel.tenant_id
          );
          
          channelInfo = {
            ...channel,
            user_is_subscribed: isSubscribed
          };
        }
      }
      
      return reply.send({
        user_found: true,
        user: {
          id: user.id,
          phone: user.phone,
          email: user.email,
          tenant_id: user.tenant_id,
          tenant_name: user.tenant_name,
          phone_verified_at: user.phone_verified_at,
          created_at: user.created_at,
          is_online: online
        },
        subscriptions: subsQuery.rows.map((s: any) => ({
          topic_id: s.topic_id,
          topic_name: s.topic_name,
          channel_id: s.channel_id,
          channel_name: s.channel_name,
          subscribed_at: s.created_at,
          wants_push: s.wants_push,
          wants_socket: s.wants_socket
        })),
        channel_check: channelInfo,
        debug_info: {
          timestamp: new Date().toISOString(),
          socket_status: online ? 'CONNECTED' : 'DISCONNECTED',
          subscription_count: subsQuery.rows.length
        }
      });
    } catch (error: any) {
      console.error('[DEBUG] Subscription check error:', error);
      return reply.status(500).send({ 
        error: 'internal_error',
        message: error.message 
      });
    }
  });
}
