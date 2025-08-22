import { FastifyInstance } from 'fastify';
import { pool, withTxn } from '../db';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';

// Import OpenAI for LLM code generation
import OpenAI from 'openai';

async function authPublisher(client: any, apiKey?: string) {
  if (!apiKey) return null;
  const { rows } = await client.query(`select id, tenant_id from publishers where api_key=$1`, [apiKey]);
  return rows[0] ?? null;
}

function generateWebhookPath(): string {
  return crypto.randomBytes(16).toString('hex');
}

function generateWebhookSecret(): string {
  return crypto.randomBytes(32).toString('base64');
}

// Generate code using OpenAI
async function generateScriptCode(
  request: string,
  apiDocs: string,
  channelName: string,
  variables: Array<{name: string, description: string, type: string}>
): Promise<{code: string, error?: string}> {
  try {
    const openaiKey = process.env.OPENAI_API_KEY;
    if (!openaiKey) {
      return { code: '', error: 'OpenAI API key not configured' };
    }

    const openai = new OpenAI({ apiKey: openaiKey });

    const systemPrompt = `You are a code generator for the Routed notification system. Generate secure JavaScript code that sends notifications to channel subscribers.

Available APIs:
- sendNotification(userId, { title, body, data }): Send notification to a specific user
- getSubscribers(): Returns array of {userId, phone, variables} for all channel subscribers
- getUserVariable(userId, variableName): Get a user's variable value
- log(message): Log message for debugging

The script will receive these inputs:
- trigger: Object with trigger data (webhook payload or schedule info)
- channel: Object with channel info {id, name, shortId}
- context: Execution context with helper functions

User-defined variables available: ${variables.map(v => `${v.name} (${v.type}): ${v.description}`).join(', ')}

Security requirements:
- Never expose API keys or secrets
- Validate all inputs
- Handle errors gracefully
- Rate limit external API calls
- Use try-catch blocks`;

    const userPrompt = `Channel: ${channelName}

Developer Request: ${request}

API Documentation:
${apiDocs || 'No additional API documentation provided'}

Generate a JavaScript function that:
1. Implements the requested functionality
2. Sends notifications to relevant subscribers
3. Uses user variables where appropriate
4. Handles errors properly
5. Returns execution summary

The function signature should be:
async function executeScript(trigger, channel, context) {
  // Your code here
}`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.3,
      max_tokens: 2000,
    });

    const code = completion.choices[0]?.message?.content || '';
    
    // Basic validation
    if (!code.includes('async function executeScript')) {
      return { 
        code: `async function executeScript(trigger, channel, context) {\n${code}\n}`,
        error: undefined 
      };
    }

    return { code, error: undefined };
  } catch (error: any) {
    console.error('Script generation error:', error);
    return { 
      code: '', 
      error: `Failed to generate script: ${error.message}` 
    };
  }
}

export default async function routes(fastify: FastifyInstance) {
  // Create a new script for a channel
  fastify.post('/v1/channels/:short_id/scripts', async (req, reply) => {
    const apiKey = (req.headers.authorization || '').replace('Bearer ', '');
    const { short_id } = req.params as any;
    const { 
      name, 
      description, 
      request_prompt, 
      api_docs,
      trigger_type,
      schedule_cron,
      variables = []
    } = req.body as any;

    if (!name || !request_prompt || !trigger_type) {
      return reply.status(400).send({ 
        error: 'missing_required_fields',
        required: ['name', 'request_prompt', 'trigger_type']
      });
    }

    if (trigger_type === 'schedule' && !schedule_cron) {
      return reply.status(400).send({ 
        error: 'schedule_cron_required',
        message: 'Cron expression is required for scheduled scripts'
      });
    }

    try {
      const result = await withTxn(async (client) => {
        // Authenticate publisher
        const pub = await authPublisher(client, apiKey);
        if (!pub) throw new Error('unauthorized');

        // Get channel
        const { rows: channelRows } = await client.query(
          `SELECT c.id, c.name, c.tenant_id, c.topic_id 
           FROM channels c 
           WHERE c.short_id = $1 AND c.tenant_id = $2`,
          [short_id, pub.tenant_id]
        );

        if (channelRows.length === 0) {
          throw new Error('channel_not_found');
        }

        const channel = channelRows[0];

        // Generate script code using LLM
        const { code, error } = await generateScriptCode(
          request_prompt,
          api_docs || '',
          channel.name,
          variables
        );

        if (error) {
          throw new Error(error);
        }

        // Create webhook path and secret if needed
        const webhookPath = trigger_type === 'webhook' ? generateWebhookPath() : null;
        const webhookSecret = trigger_type === 'webhook' ? generateWebhookSecret() : null;

        // Insert script
        const { rows: scriptRows } = await client.query(
          `INSERT INTO channel_scripts (
            channel_id, tenant_id, name, description, 
            request_prompt, api_docs, generated_code, 
            trigger_type, webhook_path, webhook_secret, schedule_cron
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          RETURNING id, webhook_path, webhook_secret`,
          [
            channel.id, pub.tenant_id, name, description,
            request_prompt, api_docs, code,
            trigger_type, webhookPath, webhookSecret, schedule_cron
          ]
        );

        const scriptId = scriptRows[0].id;

        // Insert variables if provided
        for (let i = 0; i < variables.length; i++) {
          const v = variables[i];
          await client.query(
            `INSERT INTO script_variables (
              script_id, name, display_name, description, 
              variable_type, is_required, default_value, 
              validation_regex, allowed_values, display_order
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [
              scriptId, v.name, v.display_name || v.name, v.description,
              v.type || 'string', v.required !== false, v.default,
              v.validation, v.allowed_values ? JSON.stringify(v.allowed_values) : null, i
            ]
          );
        }

        return {
          id: scriptId,
          name,
          trigger_type,
          webhook_url: webhookPath ? `${process.env.BASE_URL || 'http://localhost:3030'}/v1/webhooks/${webhookPath}` : null,
          webhook_secret: webhookSecret,
          generated_code: code
        };
      });

      return reply.send({ ok: true, script: result });
    } catch (error: any) {
      if (error.message === 'unauthorized') {
        return reply.status(401).send({ error: 'unauthorized' });
      }
      if (error.message === 'channel_not_found') {
        return reply.status(404).send({ error: 'channel_not_found' });
      }
      console.error('Script creation error:', error);
      return reply.status(500).send({ 
        error: 'internal_error', 
        message: error.message 
      });
    }
  });

  // List scripts for a channel
  fastify.get('/v1/channels/:short_id/scripts', async (req, reply) => {
    const apiKey = (req.headers.authorization || '').replace('Bearer ', '');
    const { short_id } = req.params as any;

    try {
      const scripts = await withTxn(async (client) => {
        const pub = await authPublisher(client, apiKey);
        if (!pub) throw new Error('unauthorized');

        const { rows } = await client.query(
          `SELECT 
            cs.id, cs.name, cs.description, cs.trigger_type,
            cs.webhook_path, cs.schedule_cron, cs.is_active,
            cs.last_executed_at, cs.execution_count,
            cs.created_at, cs.updated_at,
            COUNT(DISTINCT sv.id) as variable_count
          FROM channel_scripts cs
          JOIN channels c ON cs.channel_id = c.id
          LEFT JOIN script_variables sv ON sv.script_id = cs.id
          WHERE c.short_id = $1 AND c.tenant_id = $2
          GROUP BY cs.id
          ORDER BY cs.created_at DESC`,
          [short_id, pub.tenant_id]
        );

        return rows.map((script: any) => ({
          ...script,
          webhook_url: script.webhook_path ? 
            `${process.env.BASE_URL || 'http://localhost:3030'}/v1/webhooks/${script.webhook_path}` : 
            null
        }));
      });

      return reply.send({ scripts });
    } catch (error: any) {
      if (error.message === 'unauthorized') {
        return reply.status(401).send({ error: 'unauthorized' });
      }
      return reply.status(500).send({ error: 'internal_error' });
    }
  });

  // Get script details including code and variables
  fastify.get('/v1/scripts/:script_id', async (req, reply) => {
    const apiKey = (req.headers.authorization || '').replace('Bearer ', '');
    const { script_id } = req.params as any;

    try {
      const script = await withTxn(async (client) => {
        const pub = await authPublisher(client, apiKey);
        if (!pub) throw new Error('unauthorized');

        // Get script
        const { rows: scriptRows } = await client.query(
          `SELECT cs.*, c.short_id as channel_short_id, c.name as channel_name
          FROM channel_scripts cs
          JOIN channels c ON cs.channel_id = c.id
          WHERE cs.id = $1 AND cs.tenant_id = $2`,
          [script_id, pub.tenant_id]
        );

        if (scriptRows.length === 0) {
          throw new Error('script_not_found');
        }

        const script = scriptRows[0];

        // Get variables
        const { rows: variables } = await client.query(
          `SELECT * FROM script_variables 
          WHERE script_id = $1 
          ORDER BY display_order`,
          [script_id]
        );

        return {
          ...script,
          variables,
          webhook_url: script.webhook_path ? 
            `${process.env.BASE_URL || 'http://localhost:3030'}/v1/webhooks/${script.webhook_path}` : 
            null
        };
      });

      return reply.send({ script });
    } catch (error: any) {
      if (error.message === 'unauthorized') {
        return reply.status(401).send({ error: 'unauthorized' });
      }
      if (error.message === 'script_not_found') {
        return reply.status(404).send({ error: 'script_not_found' });
      }
      return reply.status(500).send({ error: 'internal_error' });
    }
  });

  // Update script (regenerate code or update config)
  fastify.put('/v1/scripts/:script_id', async (req, reply) => {
    const apiKey = (req.headers.authorization || '').replace('Bearer ', '');
    const { script_id } = req.params as any;
    const updates = req.body as any;

    try {
      await withTxn(async (client) => {
        const pub = await authPublisher(client, apiKey);
        if (!pub) throw new Error('unauthorized');

        // Verify script ownership
        const { rows: scriptRows } = await client.query(
          `SELECT cs.*, c.name as channel_name 
          FROM channel_scripts cs
          JOIN channels c ON cs.channel_id = c.id
          WHERE cs.id = $1 AND cs.tenant_id = $2`,
          [script_id, pub.tenant_id]
        );

        if (scriptRows.length === 0) {
          throw new Error('script_not_found');
        }

        const currentScript = scriptRows[0];

        // Regenerate code if requested
        if (updates.regenerate_code) {
          const { rows: variables } = await client.query(
            `SELECT * FROM script_variables WHERE script_id = $1`,
            [script_id]
          );

          const { code, error } = await generateScriptCode(
            updates.request_prompt || currentScript.request_prompt,
            updates.api_docs || currentScript.api_docs,
            currentScript.channel_name,
            variables
          );

          if (error) {
            throw new Error(error);
          }

          updates.generated_code = code;
        }

        // Build update query
        const updateFields = [];
        const updateValues = [];
        let paramIndex = 1;

        const allowedFields = [
          'name', 'description', 'request_prompt', 'api_docs', 
          'generated_code', 'is_active', 'schedule_cron'
        ];

        for (const field of allowedFields) {
          if (field in updates) {
            updateFields.push(`${field} = $${paramIndex++}`);
            updateValues.push(updates[field]);
          }
        }

        if (updateFields.length > 0) {
          updateFields.push(`updated_at = NOW()`);
          updateValues.push(script_id, pub.tenant_id);

          await client.query(
            `UPDATE channel_scripts 
            SET ${updateFields.join(', ')}
            WHERE id = $${paramIndex} AND tenant_id = $${paramIndex + 1}`,
            updateValues
          );
        }
      });

      return reply.send({ ok: true });
    } catch (error: any) {
      if (error.message === 'unauthorized') {
        return reply.status(401).send({ error: 'unauthorized' });
      }
      if (error.message === 'script_not_found') {
        return reply.status(404).send({ error: 'script_not_found' });
      }
      return reply.status(500).send({ error: 'internal_error', message: error.message });
    }
  });

  // Delete script
  fastify.delete('/v1/scripts/:script_id', async (req, reply) => {
    const apiKey = (req.headers.authorization || '').replace('Bearer ', '');
    const { script_id } = req.params as any;

    try {
      await withTxn(async (client) => {
        const pub = await authPublisher(client, apiKey);
        if (!pub) throw new Error('unauthorized');

        const result = await client.query(
          `DELETE FROM channel_scripts 
          WHERE id = $1 AND tenant_id = $2`,
          [script_id, pub.tenant_id]
        );

        if (result.rowCount === 0) {
          throw new Error('script_not_found');
        }
      });

      return reply.send({ ok: true });
    } catch (error: any) {
      if (error.message === 'unauthorized') {
        return reply.status(401).send({ error: 'unauthorized' });
      }
      if (error.message === 'script_not_found') {
        return reply.status(404).send({ error: 'script_not_found' });
      }
      return reply.status(500).send({ error: 'internal_error' });
    }
  });

  // Set user variables for a script
  fastify.post('/v1/scripts/:script_id/variables', async (req, reply) => {
    const { script_id } = req.params as any;
    const { user_id, variables } = req.body as any;

    if (!user_id || !variables) {
      return reply.status(400).send({ 
        error: 'missing_required_fields',
        required: ['user_id', 'variables']
      });
    }

    try {
      await withTxn(async (client) => {
        // Get script variables
        const { rows: scriptVars } = await client.query(
          `SELECT * FROM script_variables WHERE script_id = $1`,
          [script_id]
        );

        // Validate and save user variables
        for (const scriptVar of scriptVars) {
          const userValue = variables[scriptVar.name];
          
          if (scriptVar.is_required && !userValue) {
            throw new Error(`Missing required variable: ${scriptVar.name}`);
          }

          if (userValue !== undefined) {
            // Validate value
            let isValid = true;
            let validationError = null;

            if (scriptVar.validation_regex) {
              const regex = new RegExp(scriptVar.validation_regex);
              if (!regex.test(userValue)) {
                isValid = false;
                validationError = 'Value does not match required format';
              }
            }

            // Upsert user variable
            await client.query(
              `INSERT INTO user_script_variables 
              (user_id, script_id, variable_id, value, is_valid, validation_error)
              VALUES ($1, $2, $3, $4, $5, $6)
              ON CONFLICT (user_id, variable_id) 
              DO UPDATE SET value = $4, is_valid = $5, validation_error = $6, updated_at = NOW()`,
              [user_id, script_id, scriptVar.id, String(userValue), isValid, validationError]
            );
          }
        }
      });

      return reply.send({ ok: true });
    } catch (error: any) {
      return reply.status(400).send({ 
        error: 'validation_error', 
        message: error.message 
      });
    }
  });
}
