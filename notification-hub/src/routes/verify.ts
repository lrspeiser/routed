import { FastifyInstance } from 'fastify';
import fetch from 'node-fetch';
import { withTxn, pool } from '../db';
import { v4 as uuidv4 } from 'uuid';

/**
 * IMPORTANT: Twilio Verify Integration
 * See /TWILIO_INTEGRATION_FIXES.md for troubleshooting and fix history
 * 
 * Critical fixes applied:
 * - Changed const to let for reassignable variables (fixed TypeError)
 * - Added comprehensive logging for debugging
 * - Proper error handling for Twilio responses
 * 
 * Required ENV vars:
 * - TWILIO_ACCOUNT_SID
 * - TWILIO_AUTH_TOKEN (or TWILIO_API_KEY_SID + TWILIO_API_KEY_SECRET)
 * - TWILIO_VERIFY_SERVICE_SID
 */

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
    /**
     * Start phone verification via Twilio Verify
     * See /TWILIO_INTEGRATION_FIXES.md for troubleshooting
     * 
     * Flow:
     * 1. Accept phone number in E.164 format (+1XXXXXXXXXX)
     * 2. Send verification code via Twilio Verify API
     * 3. Return success/failure to client
     */
    try {
      const body = (req.body ?? {}) as any;
      const phone = String(body.phone || '').trim();
      const country = (body.country || 'US').toUpperCase();
      if (!phone) return reply.status(400).send({ error: 'missing_phone' });

      console.log(`[VERIFY START] Sending phone to Twilio: ${phone}`);
      const serviceSid = requireEnv('TWILIO_VERIFY_SERVICE_SID');

      // Twilio Verify API endpoint for starting verification
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
      if (!res.ok) {
        console.log(`[VERIFY START] Twilio error: ${JSON.stringify(j)}`);
        return reply.status(res.status).send({ error: 'twilio_error', details: j });
      }
      console.log(`[VERIFY START] Twilio confirmed sent to ${phone}`);
      return reply.send({ ok: true });
    } catch (e: any) {
      return reply.status(500).send({ error: 'internal_error', message: String(e?.message || e) });
    }
  });

  fastify.post('/v1/verify/check', async (req, reply) => {
    /**
     * Check verification code via Twilio Verify
     * See /TWILIO_INTEGRATION_FIXES.md for troubleshooting
     * 
     * Flow:
     * 1. Accept phone + verification code
     * 2. Verify with Twilio API
     * 3. Create/update user in database if successful
     * 4. Return user info or error
     * 
     * Common errors:
     * - invalid_code: Wrong or expired code (10 min TTL)
     * - twilio_error: Service error (check details)
     */
    try {
      const body = (req.body ?? {}) as any;
      const phone = String(body.phone || '').trim();
      const code = String(body.code || '').trim();
      if (!phone || !code) return reply.status(400).send({ error: 'missing_phone_or_code' });

      console.log(`[VERIFY CHECK] Sending code to Twilio - phone: ${phone}, code: ${code}`);
      const serviceSid = requireEnv('TWILIO_VERIFY_SERVICE_SID');

      // Twilio Verify API endpoint for checking verification code
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
      if (!res.ok) {
        console.log(`[VERIFY CHECK] Twilio error: ${JSON.stringify(j)}`);
        return reply.status(res.status).send({ error: 'twilio_error', details: j });
      }
      if ((String(j.status || '')).toLowerCase() !== 'approved') {
        console.log(`[VERIFY CHECK] Twilio could not match code - status: ${j.status}, message: ${j.message || 'No message'}`);
        return reply.status(400).send({ error: 'invalid_code', status: j.status, message: j.message });
      }
      console.log(`[VERIFY CHECK] Twilio confirmed code OK for ${phone}`);

      // Create or ensure user record in the same tenant used by auth_complete_sms and mark as verified
      const out = await withTxn(async (c) => {
        /**
         * CRITICAL FIX: Use 'let' instead of 'const' for reassignable variables
         * See /TWILIO_INTEGRATION_FIXES.md for details
         * 
         * Bug: Using const caused "TypeError: Assignment to constant variable"
         * Fix: Changed to let for t and u variables that get reassigned
         */
        
        // Use the same fixed tenant as auth_complete_sms: 'system'
        let t = await c.query(`select id from tenants where name=$1 limit 1`, ['system']);
        if (t.rows.length === 0) {
          t = await c.query(`insert into tenants (name, plan) values ($1,'free') returning id`, ['system']);
        }
        const tenantId = t.rows[0].id as string;
        
        /**
         * DEV_ID MANAGEMENT: CRITICAL - DO NOT REMOVE OR MODIFY WITHOUT UNDERSTANDING
         * 
         * Purpose: dev_id is a unique developer identifier for each user that:
         * - Persists across authentication sessions
         * - Provides non-PII identifier for developer tools
         * - Required for analytics and external integrations
         * 
         * Flow:
         * 1. Check if user exists in database
         * 2. If new user: Generate UUID and save with user record
         * 3. If existing user without dev_id: Generate and update
         * 4. If existing user with dev_id: Use existing
         * 5. ALWAYS return dev_id in response for client storage
         * 
         * Client expectations:
         * - Client saves dev_id to local storage (dev.json)
         * - Client includes dev_id in subsequent API calls
         * - Client shows dev_id in UI for developer reference
         * 
         * IMPORTANT: Breaking this will cause:
         * - Missing dev_id in client UI
         * - Broken developer tool integrations
         * - Lost user tracking across sessions
         * 
         * See /DEV_ID_MANAGEMENT.md for complete documentation
         */
        
        // Upsert user and set verified timestamp with dev_id
        let u = await c.query(`select id, phone_verified_at, dev_id from users where tenant_id=$1 and phone=$2 limit 1`, [tenantId, phone]);
        let userId: string;
        let devId: string;
        
        if (u.rows.length === 0) {
          // New user - create with dev_id and verified timestamp
          devId = uuidv4();
          u = await c.query(
            `insert into users (tenant_id, phone, phone_verified_at, dev_id) values ($1,$2, now(), $3) returning id, phone_verified_at, dev_id`, 
            [tenantId, phone, devId]
          );
          userId = u.rows[0].id as string;
          devId = u.rows[0].dev_id as string;
          console.log(`[VERIFY CHECK] Created new user with dev_id - userId: ${userId}, devId: ${devId}`);
        } else {
          // Existing user - update verification and ensure dev_id
          const user = u.rows[0];
          userId = user.id as string;
          devId = user.dev_id;
          
          // Generate dev_id if missing (for users created before dev_id was added)
          if (!devId) {
            devId = uuidv4();
            await c.query(`update users set dev_id=$1 where id=$2`, [devId, userId]);
            console.log(`[VERIFY CHECK] Generated dev_id for existing user - userId: ${userId}, devId: ${devId}`);
          } else {
            console.log(`[VERIFY CHECK] Existing user has dev_id - userId: ${userId}, devId: ${devId}`);
          }
          
          // Update verification timestamp if not already verified
          if (!user.phone_verified_at) {
            await c.query(`update users set phone_verified_at=now() where tenant_id=$1 and phone=$2`, [tenantId, phone]);
          }
        }
        
        return { tenantId, userId, devId };
      });

      // Include devId in response for client to store/use
      console.log(`[VERIFY CHECK] Returning response with devId: ${out.devId}`);
      return reply.send({ ok: true, ...out, phone });
    } catch (e: any) {
      console.error(`[VERIFY CHECK] Internal error: ${e?.message || e}`);
      return reply.status(500).send({ error: 'internal_error', message: String(e?.message || e) });
    }
  });
}
