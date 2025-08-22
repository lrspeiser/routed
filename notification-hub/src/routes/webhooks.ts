import { FastifyInstance } from 'fastify';
import { pool } from '../db';
import { executeScript } from '../runtime/script_executor';
import crypto from 'crypto';

// Verify webhook signature
function verifyWebhookSignature(
  payload: string,
  signature: string | undefined,
  secret: string
): boolean {
  if (!signature) return false;
  
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');
  
  // Timing-safe comparison
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}

export default async function routes(fastify: FastifyInstance) {
  // Webhook endpoint for triggering scripts
  fastify.post('/v1/webhooks/:webhook_path', async (req, reply) => {
    const { webhook_path } = req.params as any;
    
    try {
      // Look up script by webhook path
      const { rows: scripts } = await pool.query(
        `SELECT 
          id, 
          webhook_secret, 
          is_active,
          channel_id,
          name
        FROM channel_scripts 
        WHERE webhook_path = $1 
        AND trigger_type = 'webhook'`,
        [webhook_path]
      );

      if (scripts.length === 0) {
        console.log(`Webhook not found: ${webhook_path}`);
        return reply.status(404).send({ error: 'webhook_not_found' });
      }

      const script = scripts[0];

      if (!script.is_active) {
        console.log(`Script inactive: ${script.id}`);
        return reply.status(403).send({ error: 'script_inactive' });
      }

      // Verify signature if secret is set
      if (script.webhook_secret) {
        const signature = req.headers['x-webhook-signature'] as string;
        const payload = JSON.stringify(req.body);
        
        if (!verifyWebhookSignature(payload, signature, script.webhook_secret)) {
          console.log(`Invalid signature for webhook: ${webhook_path}`);
          return reply.status(401).send({ error: 'invalid_signature' });
        }
      }

      // Prepare trigger data
      const trigger = {
        source: 'webhook',
        path: webhook_path,
        method: req.method,
        headers: req.headers,
        body: req.body,
        query: req.query,
        timestamp: new Date().toISOString()
      };

      console.log(`Executing script ${script.id} via webhook ${webhook_path}`);

      // Execute script asynchronously
      executeScript(script.id, trigger)
        .then(result => {
          console.log(`Script ${script.id} execution complete:`, {
            success: result.success,
            notificationsSent: result.notificationsSent,
            duration: result.duration,
            error: result.error
          });
        })
        .catch(error => {
          console.error(`Script ${script.id} execution failed:`, error);
        });

      // Return immediate response
      return reply.send({
        ok: true,
        message: 'Webhook received',
        script_id: script.id,
        script_name: script.name
      });
    } catch (error: any) {
      console.error('Webhook error:', error);
      return reply.status(500).send({ 
        error: 'internal_error',
        message: error.message 
      });
    }
  });

  // Test endpoint to manually trigger a script
  fastify.post('/v1/scripts/:script_id/execute', async (req, reply) => {
    const { script_id } = req.params as any;
    const apiKey = (req.headers.authorization || '').replace('Bearer ', '');
    
    try {
      // Verify ownership
      const { rows: scripts } = await pool.query(
        `SELECT cs.*, p.api_key
        FROM channel_scripts cs
        JOIN publishers p ON cs.tenant_id = p.tenant_id
        WHERE cs.id = $1 AND p.api_key = $2`,
        [script_id, apiKey]
      );

      if (scripts.length === 0) {
        return reply.status(404).send({ error: 'script_not_found' });
      }

      const script = scripts[0];

      if (!script.is_active) {
        return reply.status(403).send({ error: 'script_inactive' });
      }

      // Prepare trigger data
      const trigger = {
        source: 'manual',
        test_data: req.body,
        timestamp: new Date().toISOString()
      };

      console.log(`Manually executing script ${script_id}`);

      // Execute script (synchronously for testing)
      const result = await executeScript(script_id, trigger);

      return reply.send({
        ok: result.success,
        result: result.result,
        error: result.error,
        logs: result.logs,
        notificationsSent: result.notificationsSent,
        duration: result.duration
      });
    } catch (error: any) {
      console.error('Manual execution error:', error);
      return reply.status(500).send({ 
        error: 'internal_error',
        message: error.message 
      });
    }
  });

  // Get execution logs for a script
  fastify.get('/v1/scripts/:script_id/logs', async (req, reply) => {
    const { script_id } = req.params as any;
    const apiKey = (req.headers.authorization || '').replace('Bearer ', '');
    
    try {
      // Verify ownership
      const { rows: scripts } = await pool.query(
        `SELECT 1
        FROM channel_scripts cs
        JOIN publishers p ON cs.tenant_id = p.tenant_id
        WHERE cs.id = $1 AND p.api_key = $2`,
        [script_id, apiKey]
      );

      if (scripts.length === 0) {
        return reply.status(404).send({ error: 'script_not_found' });
      }

      // Get recent logs
      const { rows: logs } = await pool.query(
        `SELECT 
          id,
          trigger_source,
          trigger_data,
          started_at,
          completed_at,
          duration_ms,
          status,
          error_message,
          notifications_sent
        FROM script_execution_logs
        WHERE script_id = $1
        ORDER BY started_at DESC
        LIMIT 100`,
        [script_id]
      );

      return reply.send({ logs });
    } catch (error: any) {
      return reply.status(500).send({ 
        error: 'internal_error',
        message: error.message 
      });
    }
  });
}
