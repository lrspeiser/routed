import { FastifyInstance } from 'fastify';
import { pool } from '../db';
import { connection } from '../queues';

export default async function routes(fastify: FastifyInstance) {
  // Shallow health for load balancers and uptime checks
  fastify.get('/v1/health', async (_req, reply) => {
    return reply.send({ ok: true, time: Date.now() });
  });

  fastify.get('/v1/health/db', async (_req, reply) => {
    const started = Date.now();
    try {
      const r1 = await pool.query('select 1 as ok');
      const exists = await pool.query(
        `select to_regclass('public.messages') as messages, to_regclass('public.deliveries') as deliveries`
      );
      return reply.send({ ok: true, latency_ms: Date.now() - started, tables: exists.rows[0] });
    } catch (e: any) {
      return reply.status(500).send({ ok: false, error: String(e?.message || e) });
    }
  });

  fastify.get('/v1/health/redis', async (_req, reply) => {
    const started = Date.now();
    try {
      // bullmq uses ioredis; its instance supports .ping()
      // @ts-ignore
      const pong = await (connection as any).ping?.();
      return reply.send({ ok: pong === 'PONG', pong, latency_ms: Date.now() - started });
    } catch (e: any) {
      return reply.status(500).send({ ok: false, error: String(e?.message || e) });
    }
  });

  fastify.get('/v1/health/deep', async (_req, reply) => {
    const started = Date.now();
    const out: any = { ok: true, started_at: started };
    // DB
    try {
      const t0 = Date.now();
      await pool.query('select 1');
      out.db = { ok: true, latency_ms: Date.now() - t0 };
      const schema = await pool.query(
        `select coalesce(to_regclass('public.tenants') is not null,false) as tenants,
                coalesce(to_regclass('public.messages') is not null,false) as messages,
                coalesce(to_regclass('public.deliveries') is not null,false) as deliveries`
      );
      out.db.tables = schema.rows[0];
    } catch (e: any) {
      out.ok = false;
      out.db = { ok: false, error: String(e?.message || e) };
    }
    // Redis
    try {
      const t1 = Date.now();
      // @ts-ignore
      const pong = await (connection as any).ping?.();
      out.redis = { ok: pong === 'PONG', pong, latency_ms: Date.now() - t1 };
      if (pong !== 'PONG') out.ok = false;
    } catch (e: any) {
      out.ok = false;
      out.redis = { ok: false, error: String(e?.message || e) };
    }
    out.total_ms = Date.now() - started;
    return reply.send(out);
  });
}


