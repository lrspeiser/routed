import { FastifyInstance } from 'fastify';
import fetch from 'node-fetch';
import { withTxn, pool } from '../db';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name}`);
  return v;
}

export default async function routes(fastify: FastifyInstance) {
  fastify.post('/v1/verify/start', async (req, reply) => {
    try {
      const body = (req.body ?? {}) as any;
      const phone = String(body.phone || '').trim();
      const country = (body.country || 'US').toUpperCase();
      if (!phone) return reply.status(400).send({ error: 'missing_phone' });

      const accountSid = requireEnv('TWILIO_ACCOUNT_SID');
      const authToken = requireEnv('TWILIO_AUTH_TOKEN');
      const serviceSid = requireEnv('TWILIO_VERIFY_SERVICE_SID');

      const url = `https://verify.twilio.com/v2/Services/${encodeURIComponent(serviceSid)}/Verifications`;
      const params = new URLSearchParams();
      params.set('To', phone);
      params.set('Channel', 'sms');

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': 'Basic ' + Buffer.from(accountSid + ':' + authToken).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      });
      const j: any = await res.json().catch(() => ({} as any));
      if (!res.ok) return reply.status(res.status).send({ error: 'twilio_error', details: j });
      return reply.send({ ok: true });
    } catch (e: any) {
      return reply.status(500).send({ error: 'internal_error', message: String(e?.message || e) });
    }
  });

  fastify.post('/v1/verify/check', async (req, reply) => {
    try {
      const body = (req.body ?? {}) as any;
      const phone = String(body.phone || '').trim();
      const code = String(body.code || '').trim();
      if (!phone || !code) return reply.status(400).send({ error: 'missing_phone_or_code' });

      const accountSid = requireEnv('TWILIO_ACCOUNT_SID');
      const authToken = requireEnv('TWILIO_AUTH_TOKEN');
      const serviceSid = requireEnv('TWILIO_VERIFY_SERVICE_SID');

      const url = `https://verify.twilio.com/v2/Services/${encodeURIComponent(serviceSid)}/VerificationCheck`;
      const params = new URLSearchParams();
      params.set('To', phone);
      params.set('Code', code);

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': 'Basic ' + Buffer.from(accountSid + ':' + authToken).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      });
      const j: any = await res.json().catch(() => ({} as any));
      if (!res.ok) return reply.status(res.status).send({ error: 'twilio_error', details: j });
      if ((String(j.status || '')).toLowerCase() !== 'approved') {
        return reply.status(400).send({ error: 'invalid_code' });
      }

      // Create or ensure user record and return user_id
      const out = await withTxn(async (c) => {
        // Use a shared tenant for verified users if applicable; here we ensure a user exists in the default/first tenant.
        // For now, if you have multi-tenant, adjust to map phone to correct tenant.
        // We'll find or create a user across all tenants by phone; as a simple default, create a standalone user with null tenant.
        // Assuming users table requires tenant_id, we pick or create a special tenant named 'Public'.
        let t = await c.query(`select id from tenants where name=$1 limit 1`, ['Public']);
        if (t.rows.length === 0) {
          t = await c.query(`insert into tenants (name, plan) values ($1,'free') returning id`, ['Public']);
        }
        const tenantId = t.rows[0].id as string;
        let u = await c.query(`select id from users where tenant_id=$1 and phone=$2 limit 1`, [tenantId, phone]);
        if (u.rows.length === 0) {
          u = await c.query(`insert into users (tenant_id, phone) values ($1,$2) returning id`, [tenantId, phone]);
        }
        const userId = u.rows[0].id as string;
        return { tenantId, userId };
      });

      return reply.send({ ok: true, ...out, phone });
    } catch (e: any) {
      return reply.status(500).send({ error: 'internal_error', message: String(e?.message || e) });
    }
  });
}
