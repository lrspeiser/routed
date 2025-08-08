import { FastifyInstance } from 'fastify';
import { pool } from '../db';
import { ENV } from '../env';
import { signHostStatement } from '../jwks';
import { randomBytes } from 'crypto';

function newCode(): string {
  // 6 bytes -> 8 char base32-ish without padding; keep simple hex for now
  return randomBytes(4).toString('hex');
}

function requireAdmin(req: any) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (token !== ENV.REGISTRY_ADMIN_TOKEN) {
    const err: any = new Error('unauthorized');
    err.statusCode = 401;
    throw err;
  }
}

export default async function routes(fastify: FastifyInstance) {
  // Admin: register new host
  fastify.post('/v1/hosts/register', async (req, reply) => {
    requireAdmin(req);
    const { base_url } = (req.body ?? {}) as any;
    const code = newCode();
    const hostToken = randomBytes(16).toString('hex');
    const { rows } = await pool.query(
      `insert into registry_hosts (code, base_url, host_token) values ($1,$2,$3) returning id`,
      [code, base_url ?? null, hostToken]
    );
    return reply.send({ host_id: rows[0].id, code, host_token: hostToken });
  });

  // Host heartbeat
  fastify.post('/v1/hosts/heartbeat', async (req, reply) => {
    const { host_id, host_token, base_url, vapid_public } = (req.body ?? {}) as any;
    if (!host_id || !host_token) return reply.status(400).send({ error: 'missing host_id/host_token' });
    const { rowCount } = await pool.query(
      `update registry_hosts set base_url=$2, vapid_public=$3, last_seen_at=now() where id=$1 and host_token=$4`,
      [host_id, base_url ?? null, vapid_public ?? null, host_token]
    );
    if (rowCount === 0) return reply.status(401).send({ error: 'unauthorized' });
    return reply.send({ ok: true });
  });

  // Resolve join code -> descriptor
  fastify.get('/v1/hosts/resolve', async (req, reply) => {
    const code = (req.query as any).code as string;
    if (!code) return reply.status(400).send({ error: 'missing code' });
    const { rows } = await pool.query(`select id, base_url, vapid_public from registry_hosts where code=$1`, [code]);
    if (rows.length === 0) return reply.status(404).send({ error: 'not_found' });
    const h = rows[0];
    const desc = { host_id: h.id, base_url: h.base_url, vapid_public: h.vapid_public };
    const host_statement = await signHostStatement(desc);
    return reply.send({ ...desc, host_statement });
  });
}
