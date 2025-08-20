import { FastifyInstance } from 'fastify';
import { pool, withTxn } from '../db';
import { cfg } from '../auth/config';
import { encryptSecret, hashToken, randomToken, computeJkt } from '../auth/crypto';
import { signAccessToken } from '../auth/jwt';
import { v4 as uuidv4 } from 'uuid';

export default async function routes(fastify: FastifyInstance) {
  // POST /auth/complete-sms { phone, deviceName, devicePublicJwk?, wantDefaultOpenAIKey? }
  fastify.post('/auth/complete-sms', async (req, reply) => {
    const { phone, deviceName, devicePublicJwk, wantDefaultOpenAIKey } = (req.body ?? {}) as any;
    if (!phone) return reply.status(400).send({ error: 'missing phone' });

    // Upsert a tenantless user is not compatible with current schema; infer tenant via a default system tenant if needed.
    // Here we locate (or create) a user by phone across tenants is not possible; instead, use a global system tenant.
    // For now, we pick or create a special tenant named 'system'.
    let tenantId: string;
    {
      const t = await pool.query(`select id from tenants where name=$1`, ['system']);
      if (t.rowCount && t.rows.length) tenantId = t.rows[0].id;
      else {
        const ins = await pool.query(`insert into tenants (name, plan) values ($1,$2) returning id`, ['system', 'free']);
        tenantId = ins.rows[0].id;
      }
    }

    const result = await withTxn(async (client) => {
      // 1) upsert user by tenant+phone
      let u;
      try {
        u = await client.query(
          `insert into users (tenant_id, phone) values ($1,$2)
           on conflict on constraint users_tenant_phone_unique do update set phone=excluded.phone
           returning *`,
          [tenantId, String(phone)]
        );
      } catch (e: any) {
        // Fallback for environments where the unique constraint name differs
        const code = String((e && (e.code || (e.severity && e.code))) || (e && e.code));
        if (String(code) === '42704' || String(e?.message||'').includes('does not exist')) {
          u = await client.query(
            `insert into users (tenant_id, phone) values ($1,$2)
             on conflict (tenant_id, phone) do update set phone=excluded.phone
             returning *`,
            [tenantId, String(phone)]
          );
        } else {
          throw e;
        }
      }
      const user = u.rows[0];

      // 2) ensure user_secrets with default OpenAI key if requested
      const defaultKey = wantDefaultOpenAIKey ? cfg.defaultOpenAIKey : '';
      const defaultKeyEnc = encryptSecret(defaultKey || '', cfg.encKey);
      await client.query(
        `insert into user_secrets (user_id, default_openai_key_enc) values ($1,$2)
         on conflict (user_id) do nothing`,
        [user.id, defaultKeyEnc]
      );

      // 3) create auth device
      const d = await client.query(
        `insert into auth_devices (user_id, name, public_jwk, last_seen_at)
         values ($1,$2,$3, now()) returning *`,
        [user.id, deviceName || null, devicePublicJwk || null]
      );
      const device = d.rows[0];

      // 4) issue refresh token (family)
      const familyId = uuidv4();
      const refreshRaw = randomToken(48);
      const refreshHash = hashToken(refreshRaw);
      const idleUntil = new Date(Date.now() + cfg.refreshTTLDaysIdle * 24 * 3600 * 1000);
      await client.query(
        `insert into refresh_tokens (user_id, device_id, family_id, token_hash, expires_at)
         values ($1,$2,$3,$4,$5)`,
        [user.id, device.id, familyId, refreshHash, idleUntil]
      );

      const dpopJkt = devicePublicJwk ? computeJkt(devicePublicJwk) : undefined;
      const accessToken = signAccessToken({ userId: user.id, deviceId: device.id, dpopJkt });

      return { user: { id: user.id, phone: user.phone }, deviceId: device.id, accessToken, refreshToken: refreshRaw };
    });

    return reply.send(result);
  });
}
