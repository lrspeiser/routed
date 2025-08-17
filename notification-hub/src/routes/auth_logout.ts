import { FastifyInstance } from 'fastify';
import { pool } from '../db';
import { requireAuth } from '../middleware/authz';

export default async function routes(fastify: FastifyInstance) {
  fastify.post('/auth/logout', { preHandler: requireAuth as any }, async (req, reply) => {
    const userId = (req as any).auth?.sub;
    const { deviceId } = (req.body ?? {}) as any;
    if (!deviceId) return reply.status(400).send({ error: 'missing deviceId' });
    await pool.query(
      `update refresh_tokens set revoked_at=now() where user_id=$1 and device_id=$2 and revoked_at is null`,
      [userId, deviceId]
    );
    return reply.send({ ok: true });
  });

  fastify.post('/auth/logout-all', { preHandler: requireAuth as any }, async (req, reply) => {
    const userId = (req as any).auth?.sub;
    await pool.query(`update refresh_tokens set revoked_at=now() where user_id=$1 and revoked_at is null`, [userId]);
    return reply.send({ ok: true });
  });
}
