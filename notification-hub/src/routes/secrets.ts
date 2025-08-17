import { FastifyInstance } from 'fastify';
import { pool } from '../db';
import { cfg } from '../auth/config';
import { encryptSecret, decryptSecret } from '../auth/crypto';
import { requireAuth } from '../middleware/authz';

export default async function routes(fastify: FastifyInstance) {
  // Set/replace user's own LLM API key (encrypted at rest)
  fastify.post('/me/llm-key', { preHandler: requireAuth as any }, async (req, reply) => {
    const userId = (req as any).auth?.sub as string;
    const { llmKey } = (req.body ?? {}) as any;
    if (!llmKey) return reply.status(400).send({ error: 'missing key' });
    const enc = encryptSecret(String(llmKey), cfg.encKey);
    await pool.query(
      `update user_secrets set user_llm_key_enc=$2, updated_at=now() where user_id=$1`,
      [userId, enc]
    );
    return reply.send({ ok: true });
  });

  // Internal/server-side usage (do not return raw keys)
  fastify.post('/internal/use-llm', { preHandler: requireAuth as any }, async (req, reply) => {
    const userId = (req as any).auth?.sub as string;
    const r = await pool.query(`select default_openai_key_enc, user_llm_key_enc from user_secrets where user_id=$1`, [userId]);
    if (!r.rowCount) return reply.status(400).send({ error: 'no key available' });
    const row = r.rows[0];
    const userKey = row.user_llm_key_enc ? decryptSecret(row.user_llm_key_enc, cfg.encKey) : null;
    const defaultKey = row.default_openai_key_enc ? decryptSecret(row.default_openai_key_enc, cfg.encKey) : null;
    const keyToUse = userKey || defaultKey;
    if (!keyToUse) return reply.status(400).send({ error: 'no key available' });
    // Here you'd make the upstream call. We just acknowledge.
    return reply.send({ ok: true });
  });
}
