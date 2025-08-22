import { FastifyInstance } from 'fastify';
import { pool, withTxn } from '../db';
import { pushToSockets } from '../adapters/socket';
import { v4 as uuidv4 } from 'uuid';

async function authPublisher(client: any, apiKey?: string) {
  if (!apiKey) return null;
  const { rows } = await client.query(`select id, tenant_id from publishers where api_key=$1`, [apiKey]);
  return rows[0] ?? null;
}

export default async function routes(fastify: FastifyInstance) {
  // Send a test message to a channel
  fastify.post('/v1/channels/:short_id/test-message', async (req, reply) => {
    const apiKey = (req.headers.authorization || '').replace('Bearer ', '');
    const { short_id } = req.params as any;
    const { 
      title = 'Test Message',
      body = 'This is a test message',
      data = {},
      target_phone // optional: send to specific phone number
    } = req.body as any;

    try {
      const result = await withTxn(async (client) => {
        // Authenticate publisher
        const pub = await authPublisher(client, apiKey);
        if (!pub) throw new Error('unauthorized');

        // Get channel and topic
        const { rows: channelRows } = await client.query(
          `SELECT c.id, c.name, c.tenant_id, c.topic_id
           FROM channels c 
           WHERE c.short_id = $1 AND c.tenant_id = $2`,
          [short_id, pub.tenant_id]
        );

        if (channelRows.length === 0) {
          throw new Error('channel_not_found');
        }

        const channel = channelRows[0];
        
        // Get subscribers for this channel
        let subscriberQuery = `
          SELECT DISTINCT u.id, u.phone, u.email
          FROM subscriptions s
          JOIN users u ON s.user_id = u.id
          WHERE s.topic_id = $1
        `;
        const queryParams: any[] = [channel.topic_id];

        // If target_phone is specified, filter to that user
        if (target_phone) {
          subscriberQuery += ' AND u.phone = $2';
          queryParams.push(target_phone);
        }

        const { rows: subscribers } = await client.query(subscriberQuery, queryParams);

        if (subscribers.length === 0) {
          throw new Error('no_subscribers');
        }

        const messageId = uuidv4();
        const timestamp = Date.now();
        const notifications: any[] = [];

        // Send to all matching subscribers
        for (const subscriber of subscribers) {
          // Store message in database
          await client.query(
            `INSERT INTO messages (id, tenant_id, user_id, title, body, data, channel_id, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
            [
              uuidv4(),
              pub.tenant_id,
              subscriber.id,
              title,
              body,
              JSON.stringify(data),
              channel.id
            ]
          );

          // Push via WebSocket if online
          try {
            await pushToSockets(subscriber.id, {
              type: 'notification',
              id: messageId,
              channel_id: channel.id,
              channel_name: channel.name,
              title,
              body,
              data,
              timestamp
            });
            
            notifications.push({
              user_id: subscriber.id,
              phone: subscriber.phone,
              delivered: true
            });
          } catch (err) {
            // User offline, message stored for later
            notifications.push({
              user_id: subscriber.id,
              phone: subscriber.phone,
              delivered: false,
              stored: true
            });
          }
        }

        return {
          message_id: messageId,
          channel: {
            id: channel.id,
            short_id: short_id,
            name: channel.name
          },
          recipients: notifications.length,
          notifications
        };
      });

      return reply.send({ ok: true, ...result });
    } catch (error: any) {
      if (error.message === 'unauthorized') {
        return reply.status(401).send({ error: 'unauthorized' });
      }
      if (error.message === 'channel_not_found') {
        return reply.status(404).send({ error: 'channel_not_found' });
      }
      if (error.message === 'no_subscribers') {
        return reply.status(404).send({ 
          error: 'no_subscribers',
          message: target_phone ? 
            `User with phone ${target_phone} is not subscribed to this channel` :
            'No subscribers found for this channel'
        });
      }
      console.error('Test message error:', error);
      return reply.status(500).send({ 
        error: 'internal_error', 
        message: error.message 
      });
    }
  });

  // Get messages for the authenticated user
  fastify.get('/v1/messages', async (req, reply) => {
    const user_token = req.headers['x-user-token'] || (req as any).cookies?.user_token;
    const { limit = 50, offset = 0 } = req.query as any;

    if (!user_token) {
      return reply.status(401).send({ error: 'unauthorized' });
    }

    try {
      // Get user from token
      const { rows: users } = await pool.query(
        `SELECT u.* FROM users u 
         JOIN user_secrets us ON u.id = us.user_id 
         WHERE us.secret = $1`,
        [user_token]
      );

      if (users.length === 0) {
        return reply.status(401).send({ error: 'unauthorized' });
      }

      const user = users[0];

      // Get messages
      const { rows: messages } = await pool.query(
        `SELECT 
          m.id,
          m.title,
          m.body,
          m.data,
          m.created_at,
          m.read_at,
          c.name as channel_name,
          c.short_id as channel_short_id
        FROM messages m
        LEFT JOIN channels c ON m.channel_id = c.id
        WHERE m.user_id = $1
        ORDER BY m.created_at DESC
        LIMIT $2 OFFSET $3`,
        [user.id, limit, offset]
      );

      // Mark as read
      if (messages.length > 0) {
        const unreadIds = messages
          .filter(m => !m.read_at)
          .map(m => m.id);
        
        if (unreadIds.length > 0) {
          await pool.query(
            `UPDATE messages SET read_at = NOW() 
             WHERE id = ANY($1::uuid[])`,
            [unreadIds]
          );
        }
      }

      return reply.send({ 
        messages,
        count: messages.length,
        user: {
          id: user.id,
          phone: user.phone,
          email: user.email
        }
      });
    } catch (error: any) {
      console.error('Get messages error:', error);
      return reply.status(500).send({ 
        error: 'internal_error', 
        message: error.message 
      });
    }
  });

  // Delete a message
  fastify.delete('/v1/messages/:message_id', async (req, reply) => {
    const user_token = req.headers['x-user-token'] || (req as any).cookies?.user_token;
    const { message_id } = req.params as any;

    if (!user_token) {
      return reply.status(401).send({ error: 'unauthorized' });
    }

    try {
      // Get user from token
      const { rows: users } = await pool.query(
        `SELECT u.* FROM users u 
         JOIN user_secrets us ON u.id = us.user_id 
         WHERE us.secret = $1`,
        [user_token]
      );

      if (users.length === 0) {
        return reply.status(401).send({ error: 'unauthorized' });
      }

      const user = users[0];

      // Delete message
      const result = await pool.query(
        `DELETE FROM messages 
         WHERE id = $1 AND user_id = $2`,
        [message_id, user.id]
      );

      if (result.rowCount === 0) {
        return reply.status(404).send({ error: 'message_not_found' });
      }

      return reply.send({ ok: true });
    } catch (error: any) {
      console.error('Delete message error:', error);
      return reply.status(500).send({ 
        error: 'internal_error', 
        message: error.message 
      });
    }
  });
}
