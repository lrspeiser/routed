import { FastifyInstance } from 'fastify';
import fetch from 'node-fetch';
import { withTxn, pool } from '../db';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name}`);
  return v;
}

function twilioAuthHeader(): string {
  // Prefer API Key SID/Secret if present; otherwise fall back to Account SID + Auth Token
  const accountSid = requireEnv('TWILIO_ACCOUNT_SID');
  const apiKeySid = process.env.TWILIO_API_KEY_SID;
  const apiKeySecret = process.env.TWILIO_API_KEY_SECRET;
  let user: string;
  let pass: string;
  if (apiKeySid && apiKeySecret) {
    user = apiKeySid;
    pass = apiKeySecret;
  } else {
    const authToken = requireEnv('TWILIO_AUTH_TOKEN');
    user = accountSid;
    pass = authToken;
  }
  return 'Basic ' + Buffer.from(user + ':' + pass).toString('base64');
}

export default async function routes(fastify: FastifyInstance) {
  fastify.post('/v1/verify/start', async (req, reply) => {
    try {
      const body = (req.body ?? {}) as any;
      const phone = String(body.phone || '').trim();
      const country = (body.country || 'US').toUpperCase();
      if (!phone) return reply.status(400).send({ error: 'missing_phone' });

      const serviceSid = requireEnv('TWILIO_VERIFY_SERVICE_SID');

      const url = `https://verify.twilio.com/v2/Services/${encodeURIComponent(serviceSid)}/Verifications`;
      const params = new URLSearchParams();
      params.set('To', phone);
      params.set('Channel', 'sms');

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': twilioAuthHeader(),
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

      const serviceSid = requireEnv('TWILIO_VERIFY_SERVICE_SID');

      const url = `https://verify.twilio.com/v2/Services/${encodeURIComponent(serviceSid)}/VerificationCheck`;
      const params = new URLSearchParams();
      params.set('To', phone);
      params.set('Code', code);

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': twilioAuthHeader(),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      });
      const j: any = await res.json().catch(() => ({} as any));
      if (!res.ok) return reply.status(res.status).send({ error: 'twilio_error', details: j });
      if ((String(j.status || '')).toLowerCase() !== 'approved') {
        return reply.status(400).send({ error: 'invalid_code' });
      }

      // Create or ensure user record in the same tenant used by auth_complete_sms and mark as verified
      const out = await withTxn(async (c) => {
        // Use the same fixed tenant as auth_complete_sms: 'system'
        let t = await c.query(`select id from tenants where name=$1 limit 1`, ['system']);
        if (t.rows.length === 0) {
          t = await c.query(`insert into tenants (name, plan) values ($1,'free') returning id`, ['system']);
        }
        const tenantId = t.rows[0].id as string;
        // Upsert user and set verified timestamp
        let u = await c.query(`select id, phone_verified_at from users where tenant_id=$1 and phone=$2 limit 1`, [tenantId, phone]);
        if (u.rows.length === 0) {
          u = await c.query(`insert into users (tenant_id, phone, phone_verified_at) values ($1,$2, now()) returning id, phone_verified_at`, [tenantId, phone]);
        } else if (!u.rows[0].phone_verified_at) {
          await c.query(`update users set phone_verified_at=now() where tenant_id=$1 and phone=$2`, [tenantId, phone]);
        }
        const userId = (u.rows[0].id) as string;
        return { tenantId, userId };
      });

      return reply.send({ ok: true, ...out, phone });
    } catch (e: any) {
      return reply.status(500).send({ error: 'internal_error', message: String(e?.message || e) });
    }
  });
}
# Deploy trigger: Thu Aug 21 00:03:19 PDT 2025
