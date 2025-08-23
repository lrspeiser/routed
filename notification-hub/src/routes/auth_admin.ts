import { FastifyInstance } from 'fastify';
import { pool, withTxn } from '../db';
import { cfg } from '../auth/config';
import { encryptSecret, hashToken, randomToken, computeJkt } from '../auth/crypto';
import { signAccessToken } from '../auth/jwt';
import { v4 as uuidv4 } from 'uuid';

const ADMIN_PHONE = '+16505551212';
const ADMIN_PHONES = ['+16505551212', '6505551212', '650-555-1212', '(650) 555-1212'];

export default async function routes(fastify: FastifyInstance) {
  /**
   * Admin authentication endpoint for testing
   * Allows direct authentication without SMS verification for the test admin user
   */
  fastify.post('/auth/admin', async (req, reply) => {
    const { phone, deviceName, devicePublicJwk, wantDefaultOpenAIKey } = (req.body ?? {}) as any;
    if (!phone) return reply.status(400).send({ error: 'missing phone' });

    // Normalize phone number
    const normalizedPhone = phone.replace(/\D/g, '');
    const isAdmin = ADMIN_PHONES.some(p => p.replace(/\D/g, '') === normalizedPhone);
    
    if (!isAdmin) {
      fastify.log.warn(`[ADMIN AUTH] Unauthorized attempt for phone: ${phone}`);
      return reply.status(403).send({ error: 'unauthorized' });
    }

    fastify.log.info(`[ADMIN AUTH] Admin authentication for: ${ADMIN_PHONE}`);

    // Get system tenant
    let tenantId: string;
    {
      const t = await pool.query(`select id from tenants where name=$1`, ['system']);
      if (t.rowCount && t.rows.length) {
        tenantId = t.rows[0].id;
      } else {
        const ins = await pool.query(
          `insert into tenants (name, plan) values ($1,$2) returning id`,
          ['system', 'free']
        );
        tenantId = ins.rows[0].id;
      }
    }

    try {
      const result = await withTxn(async (client) => {
        // Ensure admin user exists with verified status
        const ensureUserQuery = `
          INSERT INTO users (phone, tenant_id, phone_verified_at, is_verified, dev_id)
          VALUES ($1, $2, NOW(), true, $3)
          ON CONFLICT (phone, tenant_id) 
          DO UPDATE SET 
            phone_verified_at = COALESCE(users.phone_verified_at, NOW()),
            is_verified = true,
            dev_id = COALESCE(users.dev_id, $3)
          RETURNING *
        `;
        
        const devId = uuidv4();
        const userResult = await client.query(ensureUserQuery, [ADMIN_PHONE, tenantId, devId]);
        const user = userResult.rows[0];
        
        fastify.log.info(`[ADMIN AUTH] Admin user ensured: ${user.id}`);

        // Ensure user_secrets with default OpenAI key, if requested
        const defaultKey = wantDefaultOpenAIKey ? cfg.defaultOpenAIKey : '';
        const defaultKeyEnc = encryptSecret(defaultKey || '', cfg.encKey);
        await client.query(
          `insert into user_secrets (user_id, default_openai_key_enc)
           values ($1,$2)
           on conflict (user_id) do nothing`,
          [user.id, defaultKeyEnc]
        );

        // Create auth device
        const d = await client.query(
          `insert into auth_devices (user_id, name, public_jwk, last_seen_at)
           values ($1,$2,$3, now())
           returning *`,
          [user.id, deviceName || 'Admin Test Device', devicePublicJwk || null]
        );
        const device = d.rows[0];

        // Issue refresh token + compute access token
        const familyId = uuidv4();
        const refreshRaw = randomToken(48);
        const refreshHash = hashToken(refreshRaw);
        const expiresAt = new Date(Date.now() + cfg.refreshTTLDaysIdle * 24 * 3600 * 1000);
        await client.query(
          `insert into refresh_tokens (user_id, device_id, family_id, token_hash, expires_at)
           values ($1,$2,$3,$4,$5)`,
          [user.id, device.id, familyId, refreshHash, expiresAt]
        );

        const dpopJkt = devicePublicJwk ? computeJkt(devicePublicJwk) : undefined;
        const accessToken = signAccessToken({ userId: user.id, deviceId: device.id, dpopJkt });

        // Also ensure admin user exists in sandbox tenant for channel operations
        const sandboxTenant = await client.query(
          `SELECT id FROM tenants WHERE name = 'sandbox' LIMIT 1`
        );
        
        if (sandboxTenant.rowCount > 0) {
          await client.query(
            `INSERT INTO users (phone, tenant_id, phone_verified_at, is_verified, dev_id)
             VALUES ($1, $2, NOW(), true, $3)
             ON CONFLICT (phone, tenant_id) DO NOTHING`,
            [ADMIN_PHONE, sandboxTenant.rows[0].id, user.dev_id]
          );
          fastify.log.info(`[ADMIN AUTH] Admin user also ensured in sandbox tenant`);
        }

        return {
          user: { 
            id: user.id, 
            phone: user.phone, 
            devId: user.dev_id,
            isAdmin: true 
          },
          deviceId: device.id,
          accessToken,
          refreshToken: refreshRaw,
        };
      });

      fastify.log.info(`[ADMIN AUTH] Admin authentication successful`);
      return reply.send(result);
    } catch (e: any) {
      fastify.log.error(`[ADMIN AUTH] Error:`, e);
      return reply.status(500).send({ error: 'internal_error' });
    }
  });
}
