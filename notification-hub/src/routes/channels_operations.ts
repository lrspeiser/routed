import { FastifyInstance } from 'fastify';
import { pool, withTxn } from '../db';
import { pushToSockets } from '../adapters/socket';
import { v4 as uuidv4 } from 'uuid';

// Helper to authenticate user from cookie/token
async function authUser(req: any) {
  try {
    const userToken = req.headers['x-user-token'] || 
                      req.cookies?.user_token ||
                      req.headers.authorization?.replace('Bearer ', '');
    
    if (!userToken) return null;
    
    const { rows } = await pool.query(
      `SELECT u.*, us.secret 
       FROM users u 
       JOIN user_secrets us ON u.id = us.user_id 
       WHERE us.secret = $1 OR u.dev_id = $1`,
      [userToken]
    );
    
    return rows[0] || null;
  } catch (error) {
    console.error('Auth lookup error:', error);
    return null;
  }
}

// Generate a short ID for channels
function generateShortId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 6; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return id;
}

export default async function routes(fastify: FastifyInstance) {
  // Create a channel with all business logic
  fastify.post('/v1/user/channels/create', async (req, reply) => {
    try {
      const user = await authUser(req);
      if (!user) {
        return reply.status(401).send({ error: 'unauthorized' });
      }

      // Extract only raw input from frontend
      const { name, description, isPublic } = req.body as any;

      // Backend handles all validation
      if (!name || name.trim().length === 0) {
        return reply.status(400).send({ 
          error: 'validation_error',
          message: 'Channel name is required'
        });
      }

      if (name.length > 100) {
        return reply.status(400).send({ 
          error: 'validation_error',
          message: 'Channel name must be 100 characters or less'
        });
      }

      const result = await withTxn(async (client) => {
        // Backend generates the short ID
        let shortId = generateShortId();
        let attempts = 0;
        
        // Ensure unique short ID
        while (attempts < 10) {
          const existing = await client.query(
            'SELECT id FROM channels WHERE short_id = $1',
            [shortId]
          );
          if (existing.rows.length === 0) break;
          shortId = generateShortId();
          attempts++;
        }

        // Backend determines the topic
        const topicName = `channel.${shortId}`;
        const { rows: topicRows } = await client.query(
          `INSERT INTO topics (topic, tenant_id) 
           VALUES ($1, $2) 
           ON CONFLICT (topic) DO UPDATE SET topic = EXCLUDED.topic
           RETURNING id`,
          [topicName, user.tenant_id]
        );
        const topicId = topicRows[0].id;

        // Create the channel
        const { rows: channelRows } = await client.query(
          `INSERT INTO channels (
            name, description, short_id, tenant_id, topic_id, 
            allow_public, creator_user_id, created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
          RETURNING *`,
          [
            name.trim(),
            description?.trim() || null,
            shortId,
            user.tenant_id,
            topicId,
            !!isPublic,
            user.id
          ]
        );

        const channel = channelRows[0];

        // Backend automatically subscribes creator
        await client.query(
          `INSERT INTO subscriptions (user_id, topic_id, created_at)
           VALUES ($1, $2, NOW())
           ON CONFLICT (user_id, topic_id) DO NOTHING`,
          [user.id, topicId]
        );

        return {
          id: channel.id,
          name: channel.name,
          description: channel.description,
          shortId: channel.short_id,
          isPublic: channel.allow_public,
          createdAt: channel.created_at
        };
      });

      return reply.send({ ok: true, channel: result });
    } catch (error: any) {
      console.error('Channel creation error:', error);
      return reply.status(500).send({ 
        error: 'internal_error',
        message: 'Failed to create channel'
      });
    }
  });

  // Send message to channel with all business logic
  fastify.post('/v1/user/channels/:shortId/send', async (req, reply) => {
    try {
      const user = await authUser(req);
      if (!user) {
        return reply.status(401).send({ error: 'unauthorized' });
      }

      const { shortId } = req.params as any;
      const { message } = req.body as any;

      // Backend validates input
      if (!message || message.trim().length === 0) {
        return reply.status(400).send({ 
          error: 'validation_error',
          message: 'Message is required'
        });
      }

      if (message.length > 1000) {
        return reply.status(400).send({ 
          error: 'validation_error',
          message: 'Message must be 1000 characters or less'
        });
      }

      const result = await withTxn(async (client) => {
        // Get channel details
        const { rows: channelRows } = await client.query(
          `SELECT c.*, t.topic 
           FROM channels c 
           JOIN topics t ON c.topic_id = t.id
           WHERE c.short_id = $1 AND c.tenant_id = $2`,
          [shortId, user.tenant_id]
        );

        if (channelRows.length === 0) {
          throw new Error('channel_not_found');
        }

        const channel = channelRows[0];

        // Check if user has permission to send
        const { rows: subRows } = await client.query(
          `SELECT 1 FROM subscriptions s 
           WHERE s.user_id = $1 AND s.topic_id = $2`,
          [user.id, channel.topic_id]
        );

        if (subRows.length === 0 && channel.creator_user_id !== user.id) {
          throw new Error('not_authorized');
        }

        // Get all subscribers
        const { rows: subscribers } = await client.query(
          `SELECT DISTINCT u.id, u.phone, u.email
           FROM subscriptions s
           JOIN users u ON s.user_id = u.id
           WHERE s.topic_id = $1`,
          [channel.topic_id]
        );

        // Backend composes the notification
        const messageId = uuidv4();
        const notification = {
          id: messageId,
          title: `${channel.name}`, // Backend determines title format
          body: message.trim(),
          channelId: channel.id,
          channelName: channel.name,
          senderId: user.id,
          senderPhone: user.phone,
          timestamp: Date.now()
        };

        // Send to all subscribers
        let sentCount = 0;
        for (const subscriber of subscribers) {
          // Store in database
          await client.query(
            `INSERT INTO messages (
              id, tenant_id, user_id, title, body, 
              data, channel_id, created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
            [
              uuidv4(),
              user.tenant_id,
              subscriber.id,
              notification.title,
              notification.body,
              JSON.stringify({
                senderId: notification.senderId,
                senderPhone: notification.senderPhone
              }),
              channel.id
            ]
          );

          // Push via WebSocket if online
          try {
            const pushed = await pushToSockets(subscriber.id, {
              type: 'notification',
              ...notification
            });
            if (pushed) sentCount++;
          } catch (err) {
            // User offline, message stored for later
            console.log(`[CHANNEL] User ${subscriber.id} offline, message stored`);
          }
        }

        return {
          messageId,
          recipientCount: subscribers.length,
          sentCount,
          channel: {
            id: channel.id,
            shortId: channel.short_id,
            name: channel.name
          }
        };
      });

      return reply.send({ ok: true, ...result });
    } catch (error: any) {
      if (error.message === 'channel_not_found') {
        return reply.status(404).send({ 
          error: 'channel_not_found',
          message: 'Channel does not exist'
        });
      }
      if (error.message === 'not_authorized') {
        return reply.status(403).send({ 
          error: 'not_authorized',
          message: 'You must be subscribed to send messages'
        });
      }
      console.error('Send message error:', error);
      return reply.status(500).send({ 
        error: 'internal_error',
        message: 'Failed to send message'
      });
    }
  });

  // Add subscriber with all validation
  fastify.post('/v1/user/channels/:shortId/subscribe', async (req, reply) => {
    try {
      const user = await authUser(req);
      if (!user) {
        return reply.status(401).send({ error: 'unauthorized' });
      }

      const { shortId } = req.params as any;
      const { phone } = req.body as any;

      // Backend validates and normalizes phone
      if (!phone) {
        return reply.status(400).send({ 
          error: 'validation_error',
          message: 'Phone number is required'
        });
      }

      // Normalize phone number (basic US format)
      let normalizedPhone = phone.replace(/\D/g, '');
      if (normalizedPhone.length === 10) {
        normalizedPhone = '+1' + normalizedPhone;
      } else if (normalizedPhone.length === 11 && normalizedPhone.startsWith('1')) {
        normalizedPhone = '+' + normalizedPhone;
      } else if (!normalizedPhone.startsWith('+')) {
        normalizedPhone = '+' + normalizedPhone;
      }

      // Validate phone format
      if (!/^\+\d{10,15}$/.test(normalizedPhone)) {
        return reply.status(400).send({ 
          error: 'validation_error',
          message: 'Invalid phone number format'
        });
      }

      const result = await withTxn(async (client) => {
        // Get channel
        const { rows: channelRows } = await client.query(
          `SELECT c.*, t.id as topic_id 
           FROM channels c 
           JOIN topics t ON c.topic_id = t.id
           WHERE c.short_id = $1 AND c.tenant_id = $2`,
          [shortId, user.tenant_id]
        );

        if (channelRows.length === 0) {
          throw new Error('channel_not_found');
        }

        const channel = channelRows[0];

        // Check permissions
        if (channel.creator_user_id !== user.id && !channel.allow_public) {
          throw new Error('not_authorized');
        }

        // Find or create subscriber user
        let subscriberId;
        const { rows: existingUsers } = await client.query(
          `SELECT id FROM users WHERE phone = $1 AND tenant_id = $2`,
          [normalizedPhone, user.tenant_id]
        );

        if (existingUsers.length > 0) {
          subscriberId = existingUsers[0].id;
        } else {
          // Create placeholder user
          const { rows: newUsers } = await client.query(
            `INSERT INTO users (phone, tenant_id, created_at)
             VALUES ($1, $2, NOW())
             RETURNING id`,
            [normalizedPhone, user.tenant_id]
          );
          subscriberId = newUsers[0].id;
        }

        // Add subscription
        const { rows: subRows } = await client.query(
          `INSERT INTO subscriptions (user_id, topic_id, created_at)
           VALUES ($1, $2, NOW())
           ON CONFLICT (user_id, topic_id) DO NOTHING
           RETURNING *`,
          [subscriberId, channel.topic_id]
        );

        const wasNew = subRows.length > 0;

        return {
          subscriberId,
          phone: normalizedPhone,
          wasNew,
          channel: {
            id: channel.id,
            shortId: channel.short_id,
            name: channel.name
          }
        };
      });

      return reply.send({ 
        ok: true, 
        ...result,
        message: result.wasNew ? 'Subscriber added' : 'Already subscribed'
      });
    } catch (error: any) {
      if (error.message === 'channel_not_found') {
        return reply.status(404).send({ 
          error: 'channel_not_found',
          message: 'Channel does not exist'
        });
      }
      if (error.message === 'not_authorized') {
        return reply.status(403).send({ 
          error: 'not_authorized',
          message: 'Only channel owner can add subscribers to private channels'
        });
      }
      console.error('Subscribe error:', error);
      return reply.status(500).send({ 
        error: 'internal_error',
        message: 'Failed to add subscriber'
      });
    }
  });

  // Join public channel
  fastify.post('/v1/user/channels/join', async (req, reply) => {
    try {
      const user = await authUser(req);
      if (!user) {
        return reply.status(401).send({ error: 'unauthorized' });
      }

      const { shortId } = req.body as any;

      if (!shortId) {
        return reply.status(400).send({ 
          error: 'validation_error',
          message: 'Channel ID is required'
        });
      }

      const result = await withTxn(async (client) => {
        // Get channel (any tenant)
        const { rows: channelRows } = await client.query(
          `SELECT c.*, t.id as topic_id 
           FROM channels c 
           JOIN topics t ON c.topic_id = t.id
           WHERE c.short_id = $1 AND c.allow_public = true`,
          [shortId]
        );

        if (channelRows.length === 0) {
          throw new Error('channel_not_found');
        }

        const channel = channelRows[0];

        // Add subscription
        const { rows: subRows } = await client.query(
          `INSERT INTO subscriptions (user_id, topic_id, created_at)
           VALUES ($1, $2, NOW())
           ON CONFLICT (user_id, topic_id) DO NOTHING
           RETURNING *`,
          [user.id, channel.topic_id]
        );

        const wasNew = subRows.length > 0;

        return {
          channel: {
            id: channel.id,
            shortId: channel.short_id,
            name: channel.name,
            description: channel.description
          },
          wasNew
        };
      });

      return reply.send({ 
        ok: true, 
        ...result,
        message: result.wasNew ? 'Joined channel' : 'Already a member'
      });
    } catch (error: any) {
      if (error.message === 'channel_not_found') {
        return reply.status(404).send({ 
          error: 'channel_not_found',
          message: 'Channel does not exist or is not public'
        });
      }
      console.error('Join channel error:', error);
      return reply.status(500).send({ 
        error: 'internal_error',
        message: 'Failed to join channel'
      });
    }
  });
}
