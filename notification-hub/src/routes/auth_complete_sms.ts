import { FastifyInstance } from 'fastify';
import { pool, withTxn } from '../db';
import { cfg } from '../auth/config';
import { encryptSecret, hashToken, randomToken, computeJkt } from '../auth/crypto';
import { signAccessToken } from '../auth/jwt';
import { v4 as uuidv4 } from 'uuid';

class PhoneNotVerifiedError extends Error {
  status = 403 as const;
  code = 'phone_not_verified' as const;
  constructor() {
    super('phone_not_verified');
  }
}

export default async function routes(fastify: FastifyInstance) {
  // POST /auth/complete-sms { phone, deviceName, devicePublicJwk?, wantDefaultOpenAIKey? }
  fastify.post('/auth/complete-sms', async (req, reply) => {
    const { phone, deviceName, devicePublicJwk, wantDefaultOpenAIKey } = (req.body ?? {}) as any;
    if (!phone) return reply.status(400).send({ error: 'missing phone' });

    // Resolve (or create) the fixed tenant used for verification flow
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
        // 1) Load verified user
        const u = await client.query(
          `select * from users where tenant_id=$1 and phone=$2`,
          [tenantId, String(phone)]
        );
        if (!u.rowCount) {
          fastify.log.info(`verify:check: phone not found tenantId=${tenantId} phone=${phone}`);
          throw new PhoneNotVerifiedError();
        }
        const user = u.rows[0];
        if (!user.phone_verified_at) {
          fastify.log.info(`verify:check: phone not verified userId=${user.id}`);
          throw new PhoneNotVerifiedError();
        }

        // 1.5) Ensure dev_id
        if (!user.dev_id) {
          user.dev_id = uuidv4();
          await client.query(`update users set dev_id=$1 where id=$2`, [user.dev_id, user.id]);
        }

        // 2) Ensure user_secrets with default OpenAI key, if requested
        const defaultKey = wantDefaultOpenAIKey ? cfg.defaultOpenAIKey : '';
        const defaultKeyEnc = encryptSecret(defaultKey || '', cfg.encKey);
        await client.query(
          `insert into user_secrets (user_id, default_openai_key_enc)
           values ($1,$2)
           on conflict (user_id) do nothing`,
          [user.id, defaultKeyEnc]
        );

        // 3) Create auth device
        const d = await client.query(
          `insert into auth_devices (user_id, name, public_jwk, last_seen_at)
           values ($1,$2,$3, now())
           returning *`,
          [user.id, deviceName || null, devicePublicJwk || null]
        );
        const device = d.rows[0];

        // 4) Issue refresh token + compute access token
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

        return {
          user: { id: user.id, phone: user.phone, devId: user.dev_id },
          deviceId: device.id,
          accessToken,
          refreshToken: refreshRaw,
        };
      });

      // ✅ Reply *after* the txn finished successfully
      return reply.send(result);
    } catch (e: any) {
      if (e instanceof PhoneNotVerifiedError) {
        return reply.status(403).send({ error: e.code });
      }
      fastify.log.error(e);
      return reply.status(500).send({ error: 'internal_error' });
    }
  });
}
