import { FastifyInstance } from 'fastify';
import { pool, withTxn } from '../db';
import OpenAI from 'openai';

// Helper to authenticate user
async function authUser(req: any) {
  const userToken = req.headers['x-user-token'] || 
                    req.cookies?.user_token ||
                    req.headers.authorization?.replace('Bearer ', '');
  
  if (!userToken) return null;
  
  const { rows } = await pool.query(
    `SELECT u.*, us.secret 
     FROM users u 
     JOIN user_secrets us ON u.id = us.user_id 
     WHERE us.secret = $1 OR u.dev_id = $1`,
    [userToken]
  );
  
  return rows[0] || null;
}

// Extract a meaningful name from user prompt
function extractScriptName(prompt: string): string {
  // Take first line or first 50 chars, clean it up
  const firstLine = prompt.split('\n')[0];
  const cleaned = firstLine
    .substring(0, 50)
    .replace(/[^a-zA-Z0-9 ]/g, '')
    .trim();
  
  return cleaned || 'Untitled Script';
}

// Determine trigger type from prompt using simple heuristics
function determineTriggerType(prompt: string): 'webhook' | 'schedule' | 'manual' {
  const lowerPrompt = prompt.toLowerCase();
  
  // Check for schedule indicators
  const scheduleKeywords = [
    'every', 'daily', 'hourly', 'weekly', 'monthly',
    'morning', 'evening', 'night', 'noon',
    'cron', 'schedule', 'periodic', 'regularly',
    'each day', 'each hour', 'each week',
    'at ', 'every day at', 'every hour',
    '8am', '9am', '10am', '11am', '12pm',
    'minute', 'minutes', 'hour', 'hours'
  ];
  
  // Check for webhook indicators
  const webhookKeywords = [
    'webhook', 'http', 'api call', 'when called',
    'github', 'stripe', 'slack', 'external',
    'post request', 'get request', 'endpoint',
    'trigger from', 'receive from'
  ];
  
  for (const keyword of scheduleKeywords) {
    if (lowerPrompt.includes(keyword)) {
      return 'schedule';
    }
  }
  
  for (const keyword of webhookKeywords) {
    if (lowerPrompt.includes(keyword)) {
      return 'webhook';
    }
  }
  
  return 'manual';
}

// Extract cron expression from prompt
function extractCronExpression(prompt: string): string | null {
  const lowerPrompt = prompt.toLowerCase();
  
  // Common patterns
  if (lowerPrompt.includes('every minute')) return '* * * * *';
  if (lowerPrompt.includes('every 5 minutes')) return '*/5 * * * *';
  if (lowerPrompt.includes('every 10 minutes')) return '*/10 * * * *';
  if (lowerPrompt.includes('every 15 minutes')) return '*/15 * * * *';
  if (lowerPrompt.includes('every 30 minutes')) return '*/30 * * * *';
  if (lowerPrompt.includes('every hour')) return '0 * * * *';
  if (lowerPrompt.includes('hourly')) return '0 * * * *';
  if (lowerPrompt.includes('daily') || lowerPrompt.includes('every day')) {
    // Check for specific time
    const timeMatch = lowerPrompt.match(/at (\d{1,2}):?(\d{2})?\s*(am|pm)?/);
    if (timeMatch) {
      let hour = parseInt(timeMatch[1]);
      const isPM = timeMatch[3] === 'pm';
      if (isPM && hour < 12) hour += 12;
      if (!isPM && hour === 12) hour = 0;
      const minute = timeMatch[2] ? parseInt(timeMatch[2]) : 0;
      return `${minute} ${hour} * * *`;
    }
    return '0 9 * * *'; // Default to 9am
  }
  if (lowerPrompt.includes('weekly') || lowerPrompt.includes('every week')) {
    return '0 9 * * 1'; // Mondays at 9am
  }
  if (lowerPrompt.includes('monthly') || lowerPrompt.includes('every month')) {
    return '0 9 1 * *'; // First day of month at 9am
  }
  
  // Default for scheduled scripts
  return '*/10 * * * *'; // Every 10 minutes
}

export default async function routes(fastify: FastifyInstance) {
  // Create script with all business logic
  fastify.post('/v1/user/channels/:shortId/scripts', async (req, reply) => {
    try {
      const user = await authUser(req);
      if (!user) {
        return reply.status(401).send({ error: 'unauthorized' });
      }

      const { shortId } = req.params as any;
      const { userPrompt, variables = [] } = req.body as any;

      // Backend validates input
      if (!userPrompt || userPrompt.trim().length === 0) {
        return reply.status(400).send({ 
          error: 'validation_error',
          message: 'Script description is required'
        });
      }

      if (userPrompt.length > 2000) {
        return reply.status(400).send({ 
          error: 'validation_error',
          message: 'Script description must be 2000 characters or less'
        });
      }

      // Backend extracts name from prompt
      const scriptName = extractScriptName(userPrompt);
      
      // Backend determines trigger type
      const triggerType = determineTriggerType(userPrompt);
      
      // Backend determines cron expression if scheduled
      const scheduleCron = triggerType === 'schedule' 
        ? extractCronExpression(userPrompt) 
        : null;

      // Backend enriches prompt with technical context
      const enrichedPrompt = `
User Request: ${userPrompt}

Technical Context:
- This is for a notification channel named "${shortId}"
- The script should send notifications to channel subscribers
- Use the provided APIs: sendNotification(), getSubscribers(), etc.
- Handle errors gracefully and log progress
- The script will run as: ${triggerType}
${scheduleCron ? `- Schedule: ${scheduleCron}` : ''}

Generate clean, production-ready code.`;

      const result = await withTxn(async (client) => {
        // Get channel
        const { rows: channelRows } = await client.query(
          `SELECT c.* 
           FROM channels c 
           WHERE c.short_id = $1 AND c.tenant_id = $2`,
          [shortId, user.tenant_id]
        );

        if (channelRows.length === 0) {
          throw new Error('channel_not_found');
        }

        const channel = channelRows[0];

        // Check if user owns the channel
        if (channel.creator_user_id !== user.id) {
          throw new Error('not_authorized');
        }

        // Check OpenAI API key
        const openaiKey = process.env.OPENAI_API_KEY || process.env.OPEN_AI_KEY;
        if (!openaiKey) {
          throw new Error('script_generation_unavailable');
        }

        // Generate script code using OpenAI
        const openai = new OpenAI({ apiKey: openaiKey });
        
        try {
          const completion = await openai.chat.completions.create({
            model: 'gpt-4-turbo-preview',
            messages: [
              {
                role: 'system',
                content: `You are a code generator for the Routed notification system. 
Generate a JavaScript function that implements the user's request.
The function signature must be: async function executeScript(trigger, channel, context) { }
Available in context: sendNotification(userId, {title, body, data}), getSubscribers(), log(message), fetch(url)
Return ONLY the JavaScript code, no explanations.`
              },
              {
                role: 'user',
                content: enrichedPrompt
              }
            ],
            temperature: 0.3,
            max_tokens: 2000,
            response_format: { type: "json_object" }
          });

          const responseContent = completion.choices[0]?.message?.content || '{}';
          let generatedCode = '';
          
          try {
            const parsed = JSON.parse(responseContent);
            generatedCode = parsed.code || '';
          } catch {
            // Fallback to raw content
            generatedCode = responseContent;
          }

          // Clean up code
          generatedCode = generatedCode
            .replace(/^```javascript\n/, '')
            .replace(/^```js\n/, '')
            .replace(/\n```$/, '')
            .replace(/^```\n/, '');

          // Ensure function signature
          if (!generatedCode.includes('async function executeScript')) {
            generatedCode = `async function executeScript(trigger, channel, context) {
  const { sendNotification, getSubscribers, log, fetch } = context;
  
  try {
    ${generatedCode}
  } catch (error) {
    log('Script error: ' + error.message);
    return 'Failed: ' + error.message;
  }
}`;
          }

          // Store script in database
          const { rows: scriptRows } = await client.query(
            `INSERT INTO channel_scripts (
              channel_id, tenant_id, name, description,
              request_prompt, generated_code, trigger_type,
              schedule_cron, is_active, created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, NOW())
            RETURNING *`,
            [
              channel.id,
              user.tenant_id,
              scriptName,
              `Generated from: ${userPrompt.substring(0, 200)}`,
              userPrompt,
              generatedCode,
              triggerType,
              scheduleCron
            ]
          );

          const script = scriptRows[0];

          // Store variables if any
          for (const variable of variables) {
            await client.query(
              `INSERT INTO script_variables (
                script_id, name, display_name, description,
                variable_type, is_required, display_order
              ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
              [
                script.id,
                variable.name,
                variable.displayName || variable.name,
                variable.description || '',
                variable.type || 'string',
                variable.required !== false,
                variables.indexOf(variable)
              ]
            );
          }

          return {
            id: script.id,
            name: script.name,
            triggerType: script.trigger_type,
            scheduleCron: script.schedule_cron,
            isActive: script.is_active
          };
        } catch (aiError: any) {
          console.error('OpenAI generation error:', aiError);
          throw new Error('script_generation_failed');
        }
      });

      return reply.send({ ok: true, script: result });
    } catch (error: any) {
      if (error.message === 'channel_not_found') {
        return reply.status(404).send({ 
          error: 'channel_not_found',
          message: 'Channel does not exist'
        });
      }
      if (error.message === 'not_authorized') {
        return reply.status(403).send({ 
          error: 'not_authorized',
          message: 'Only channel owner can create scripts'
        });
      }
      if (error.message === 'script_generation_unavailable') {
        return reply.status(503).send({ 
          error: 'script_generation_unavailable',
          message: 'Script generation service is not configured'
        });
      }
      if (error.message === 'script_generation_failed') {
        return reply.status(500).send({ 
          error: 'script_generation_failed',
          message: 'Failed to generate script code. Please try again or simplify your request.'
        });
      }
      console.error('Script creation error:', error);
      return reply.status(500).send({ 
        error: 'internal_error',
        message: 'Failed to create script'
      });
    }
  });

  // Execute script with all orchestration
  fastify.post('/v1/user/scripts/:scriptId/execute', async (req, reply) => {
    try {
      const user = await authUser(req);
      if (!user) {
        return reply.status(401).send({ error: 'unauthorized' });
      }

      const { scriptId } = req.params as any;
      const { testData = {} } = req.body as any;

      // Import the executor
      const { executeScript } = await import('../runtime/script_executor');

      // Execute with proper context
      const result = await executeScript(scriptId, {
        source: 'manual',
        user_id: user.id,
        test_data: testData
      });

      // Format response for frontend
      return reply.send({
        ok: result.success,
        executed: result.success,
        error: result.error,
        logs: result.logs,
        notificationsSent: result.notificationsSent,
        duration: result.duration,
        message: result.success 
          ? `Script executed successfully. Sent ${result.notificationsSent} notifications.`
          : `Script failed: ${result.error}`
      });
    } catch (error: any) {
      console.error('Script execution error:', error);
      return reply.status(500).send({ 
        error: 'internal_error',
        message: 'Failed to execute script'
      });
    }
  });
}
