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

  // Schema validator: verify required tables, columns, and unique constraints used by routes
  fastify.get('/v1/health/schema', async (_req, reply) => {
    const out: any = { ok: true, checks: {}, missing: [] as string[] };
    try {
      // Required columns
      const cols = await pool.query(
        `select table_name, column_name from information_schema.columns where table_schema = current_schema() and table_name in ('users','topics','channels','subscriptions')`
      );
      const hasCol = (t: string, c: string) => cols.rows.some(r => r.table_name === t && r.column_name === c);
      if (!hasCol('users','phone')) { out.ok = false; out.missing.push('users.phone'); }
      if (!hasCol('channels','short_id')) { out.ok = false; out.missing.push('channels.short_id'); }
      if (!hasCol('topics','name')) { out.ok = false; out.missing.push('topics.name'); }

      // Required unique constraints
      const idx = await pool.query(
        `select i.relname as index_name
           from pg_class t
           join pg_index ix on t.oid = ix.indrelid
           join pg_class i on i.oid = ix.indexrelid
           join pg_namespace n on n.oid = t.relnamespace
          where n.nspname = current_schema() and t.relname in ('users','topics','channels','subscriptions') and ix.indisunique`
      );
      const names = idx.rows.map(r => String(r.index_name||''));
      function need(name: string, label: string) { if (!names.some(n => n === name)) { out.ok = false; out.missing.push(label); } }
      need('users_tenant_phone_unique', 'unique(users.tenant_id, phone)');
      need('users_tenant_email_unique', 'unique(users.tenant_id, email)');
      need('topics_tenant_id_name_key', 'unique(topics.tenant_id, name)');
      need('channels_tenant_id_short_id_key', 'unique(channels.tenant_id, short_id)');
      need('subscriptions_user_id_topic_id_key', 'unique(subscriptions.user_id, topic_id)');

      out.checks.indexes = names;
    } catch (e: any) {
      out.ok = false;
      out.error = String(e?.message || e);
    }
    return reply.status(out.ok ? 200 : 500).send(out);
  });
}


