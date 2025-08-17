import { FastifyInstance } from 'fastify';
import { pool, withTxn } from '../db';
import { cfg } from '../auth/config';
import { computeJkt, hashToken, randomToken } from '../auth/crypto';
import { signAccessToken } from '../auth/jwt';

export default async function routes(fastify: FastifyInstance) {
  // POST /auth/refresh { refreshToken, deviceId }
  fastify.post('/auth/refresh', async (req, reply) => {
    const { refreshToken, deviceId } = (req.body ?? {}) as any;
    if (!refreshToken || !deviceId) return reply.status(400).send({ error: 'missing' });

    const hashed = hashToken(String(refreshToken));
    const tokenRowRes = await pool.query(
      `select * from refresh_tokens where token_hash=$1 and device_id=$2`,
      [hashed, String(deviceId)]
    );
    const tokenRow = tokenRowRes.rows[0];
    if (!tokenRow) return reply.status(401).send({ error: 'invalid token' });
    if (tokenRow.revoked_at) return reply.status(401).send({ error: 'revoked' });
    if (new Date(tokenRow.expires_at) < new Date()) return reply.status(401).send({ error: 'expired' });

    // If used_once and chained, treat as replay → revoke family
    if (tokenRow.used_once && tokenRow.rotated_from) {
      await pool.query(`update refresh_tokens set revoked_at=now() where family_id=$1 and revoked_at is null`, [tokenRow.family_id]);
      return reply.status(401).send({ error: 'reused token; family revoked' });
    }

    // Fetch device for optional DPoP binding
    const devRes = await pool.query(`select * from auth_devices where id=$1`, [tokenRow.device_id]);
    const device = devRes.rows[0];
    let dpopJkt: string | undefined;
    if (device?.public_jwk) {
      try { dpopJkt = computeJkt(device.public_jwk); } catch {}
    }

    const out = await withTxn(async (client) => {
      const newRaw = randomToken(48);
      const newHash = hashToken(newRaw);
      const idleUntil = new Date(Date.now() + cfg.refreshTTLDaysIdle * 24 * 3600 * 1000);

      await client.query(`update refresh_tokens set used_once=true where id=$1`, [tokenRow.id]);
      await client.query(
        `insert into refresh_tokens (user_id, device_id, family_id, token_hash, expires_at, rotated_from)
         values ($1,$2,$3,$4,$5,$6)`,
        [tokenRow.user_id, tokenRow.device_id, tokenRow.family_id, newHash, idleUntil, tokenRow.id]
      );
      await client.query(`update auth_devices set last_seen_at=now() where id=$1`, [tokenRow.device_id]);

      const accessToken = signAccessToken({ userId: tokenRow.user_id, deviceId: tokenRow.device_id, dpopJkt });
      return { accessToken, refreshToken: newRaw };
    });

    return reply.send(out);
  });
}
