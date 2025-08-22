import ivm from 'isolated-vm';
import { pool } from '../db';
import { pushToSockets } from '../adapters/socket';

interface ScriptContext {
  sendNotification: (userId: string, notification: any) => Promise<boolean>;
  getSubscribers: () => Promise<any[]>;
  getUserVariable: (userId: string, variableName: string) => Promise<string | null>;
  log: (message: string) => void;
  fetch: typeof fetch;
}

interface ExecutionResult {
  success: boolean;
  result?: any;
  error?: string;
  logs: string[];
  notificationsSent: number;
  duration: number;
}

export class ScriptExecutor {
  private scriptId: string;
  private channelId: string;
  private tenantId: string;
  private topicId: string;
  private logs: string[] = [];
  private notificationsSent: number = 0;
  private startTime: number = 0;

  constructor(scriptId: string, channelId: string, tenantId: string, topicId: string) {
    this.scriptId = scriptId;
    this.channelId = channelId;
    this.tenantId = tenantId;
    this.topicId = topicId;
  }

  private createContext(): ScriptContext {
    return {
      sendNotification: async (userId: string, notification: any) => {
        try {
          // Validate notification structure
          if (!notification.title || !notification.body) {
            this.log(`Invalid notification structure for user ${userId}`);
            return false;
          }

          // Send via WebSocket
          await pushToSockets(userId, {
            type: 'notification',
            title: String(notification.title),
            body: String(notification.body),
            data: notification.data || {},
            timestamp: Date.now()
          });

          // Store in database for offline delivery
          await pool.query(
            `INSERT INTO messages (tenant_id, user_id, title, body, data, channel_id)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
              this.tenantId,
              userId,
              notification.title,
              notification.body,
              JSON.stringify(notification.data || {}),
              this.channelId
            ]
          );

          this.notificationsSent++;
          this.log(`Notification sent to user ${userId}`);
          return true;
        } catch (error: any) {
          this.log(`Failed to send notification to ${userId}: ${error.message}`);
          return false;
        }
      },

      getSubscribers: async () => {
        try {
          const { rows } = await pool.query(
            `SELECT 
              u.id as user_id, 
              u.phone, 
              u.email,
              COALESCE(
                json_object_agg(
                  sv.name, 
                  usv.value
                ) FILTER (WHERE sv.name IS NOT NULL),
                '{}'::json
              ) as variables
            FROM subscriptions s
            JOIN users u ON s.user_id = u.id
            LEFT JOIN user_script_variables usv ON usv.user_id = u.id AND usv.script_id = $1
            LEFT JOIN script_variables sv ON sv.id = usv.variable_id
            WHERE s.topic_id = $2
            GROUP BY u.id, u.phone, u.email`,
            [this.scriptId, this.topicId]
          );

          return rows.map(row => ({
            userId: row.user_id,
            phone: row.phone,
            email: row.email,
            variables: row.variables || {}
          }));
        } catch (error: any) {
          this.log(`Failed to get subscribers: ${error.message}`);
          return [];
        }
      },

      getUserVariable: async (userId: string, variableName: string) => {
        try {
          const { rows } = await pool.query(
            `SELECT usv.value
            FROM user_script_variables usv
            JOIN script_variables sv ON sv.id = usv.variable_id
            WHERE usv.user_id = $1 
            AND usv.script_id = $2 
            AND sv.name = $3`,
            [userId, this.scriptId, variableName]
          );

          return rows[0]?.value || null;
        } catch (error: any) {
          this.log(`Failed to get variable ${variableName} for user ${userId}: ${error.message}`);
          return null;
        }
      },

      log: (message: string) => {
        const timestamp = new Date().toISOString();
        const logLine = `[${timestamp}] ${message}`;
        this.logs.push(logLine);
        console.log(`[SCRIPT ${this.scriptId}] ${logLine}`);
      },

      // Safe fetch with timeout and size limits
      fetch: async (url: string | URL | Request, options: any = {}) => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000); // 10 second timeout

        try {
          // Convert to string if needed and validate URL
          const urlString = typeof url === 'string' ? url : 
                           url instanceof URL ? url.toString() : 
                           (url as Request).url;
          const urlObj = new URL(urlString);
          if (!['http:', 'https:'].includes(urlObj.protocol)) {
            throw new Error('Only HTTP/HTTPS protocols allowed');
          }

          // Limit request size
          if (options.body && JSON.stringify(options.body).length > 100000) {
            throw new Error('Request body too large (max 100KB)');
          }

          const response = await fetch(url, {
            ...options,
            signal: controller.signal,
            size: 1000000, // 1MB response limit
            timeout: 10000
          });

          clearTimeout(timeout);
          return response;
        } catch (error: any) {
          clearTimeout(timeout);
          if (error.name === 'AbortError') {
            throw new Error('Request timeout (10s)');
          }
          throw error;
        }
      }
    };
  }

  private log(message: string) {
    this.logs.push(message);
    console.log(`[SCRIPT ${this.scriptId}] ${message}`);
  }

  async execute(code: string, trigger: any, channel: any): Promise<ExecutionResult> {
    this.startTime = Date.now();
    this.logs = [];
    this.notificationsSent = 0;

    try {
      // Create isolated VM context
      const isolate = new ivm.Isolate({ memoryLimit: 128 }); // 128MB memory limit
      const vmContext = await isolate.createContext();
      
      // Create a jail object for the context
      const jail = vmContext.global;
      await jail.set('global', jail.derefInto());
      
      // Add console logging
      await jail.set('_log', new ivm.Reference((msg: string) => this.log(String(msg))));
      await jail.set('_error', new ivm.Reference((msg: string) => this.log(`ERROR: ${String(msg)}`)));
      await jail.set('_warn', new ivm.Reference((msg: string) => this.log(`WARN: ${String(msg)}`)));
      
      // Add context functions as references
      const context = this.createContext();
      await jail.set('_sendNotification', new ivm.Reference(context.sendNotification));
      await jail.set('_getSubscribers', new ivm.Reference(context.getSubscribers));
      await jail.set('_getUserVariable', new ivm.Reference(context.getUserVariable));
      await jail.set('_contextLog', new ivm.Reference(context.log));
      
      // Set trigger and channel data
      await jail.set('_trigger', new ivm.ExternalCopy(trigger).copyInto());
      await jail.set('_channel', new ivm.ExternalCopy(channel).copyInto());

      // Prepare the script with context injection
      const wrappedCode = `
        // Setup console
        const console = {
          log: (...args) => _log.apply(undefined, [args.map(a => String(a)).join(' ')]),
          error: (...args) => _error.apply(undefined, [args.map(a => String(a)).join(' ')]),
          warn: (...args) => _warn.apply(undefined, [args.map(a => String(a)).join(' ')])
        };
        
        // Setup helper functions in global scope
        const sendNotification = (userId, notification) => {
          return _sendNotification.apply(undefined, [userId, notification]);
        };
        
        const getSubscribers = () => {
          return _getSubscribers.apply(undefined, []);
        };
        
        const getUserVariable = (userId, variableName) => {
          return _getUserVariable.apply(undefined, [userId, variableName]);
        };
        
        const log = (message) => {
          return _contextLog.apply(undefined, [message]);
        };
        
        // Setup context object with same functions
        const context = {
          sendNotification,
          getSubscribers,
          getUserVariable,
          log,
          rateLimit: async (key, limit) => {
            // Simple rate limiting stub
            return true;
          }
        };
        
        const trigger = _trigger;
        const channel = _channel;

        // User's script
        ${code}

        // Execute and return result
        (async () => {
          try {
            if (typeof executeScript !== 'function') {
              throw new Error('Script must define executeScript function');
            }
            const result = await executeScript(trigger, channel, context);
            return { success: true, result };
          } catch (error) {
            return { success: false, error: error.message || String(error) };
          }
        })();
      `;

      // Compile and run script with timeout
      const compiledScript = await isolate.compileScript(wrappedCode);
      const result = await compiledScript.run(vmContext, { 
        timeout: 30000, // 30 second timeout
        promise: true 
      });

      const duration = Date.now() - this.startTime;

      // Log execution to database
      await this.logExecution({
        status: result.success ? 'success' : 'error',
        error: result.error,
        duration,
        trigger
      });

      return {
        success: result.success,
        result: result.result,
        error: result.error,
        logs: this.logs,
        notificationsSent: this.notificationsSent,
        duration
      };
    } catch (error: any) {
      const duration = Date.now() - this.startTime;
      
      // Handle VM errors
      let errorMessage = 'Script execution failed';
      if (error.message.includes('Script execution timed out')) {
        errorMessage = 'Script timeout (30s)';
      } else if (error.message) {
        errorMessage = error.message;
      }

      await this.logExecution({
        status: 'error',
        error: errorMessage,
        duration,
        trigger
      });

      return {
        success: false,
        error: errorMessage,
        logs: this.logs,
        notificationsSent: this.notificationsSent,
        duration
      };
    }
  }

  private async logExecution(details: any) {
    try {
      await pool.query(
        `INSERT INTO script_execution_logs 
        (script_id, trigger_source, trigger_data, status, error_message, 
         notifications_sent, duration_ms, completed_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
        [
          this.scriptId,
          details.trigger?.source || 'manual',
          JSON.stringify(details.trigger || {}),
          details.status,
          details.error,
          this.notificationsSent,
          details.duration
        ]
      );

      // Update script last execution
      await pool.query(
        `UPDATE channel_scripts 
        SET last_executed_at = NOW(), execution_count = execution_count + 1
        WHERE id = $1`,
        [this.scriptId]
      );
    } catch (error: any) {
      console.error('Failed to log execution:', error);
    }
  }
}

// Execute a script by ID
export async function executeScript(
  scriptId: string, 
  trigger: any = { source: 'manual' }
): Promise<ExecutionResult> {
  try {
    // Get script details
    const { rows: scripts } = await pool.query(
      `SELECT 
        cs.*, 
        c.id as channel_id,
        c.name as channel_name,
        c.short_id as channel_short_id,
        c.topic_id
      FROM channel_scripts cs
      JOIN channels c ON cs.channel_id = c.id
      WHERE cs.id = $1 AND cs.is_active = true`,
      [scriptId]
    );

    if (scripts.length === 0) {
      throw new Error('Script not found or inactive');
    }

    const script = scripts[0];

    // Check rate limits
    const { rows: recentExecutions } = await pool.query(
      `SELECT COUNT(*) as count
      FROM script_execution_logs
      WHERE script_id = $1 
      AND started_at > NOW() - INTERVAL '1 hour'`,
      [scriptId]
    );

    if (recentExecutions[0].count >= script.max_executions_per_hour) {
      throw new Error(`Rate limit exceeded (max ${script.max_executions_per_hour}/hour)`);
    }

    // Create executor and run
    const executor = new ScriptExecutor(
      script.id,
      script.channel_id,
      script.tenant_id,
      script.topic_id
    );

    const channel = {
      id: script.channel_id,
      name: script.channel_name,
      shortId: script.channel_short_id
    };

    return await executor.execute(
      script.generated_code,
      trigger,
      channel
    );
  } catch (error: any) {
    console.error('Script execution error:', error);
    return {
      success: false,
      error: error.message,
      logs: [],
      notificationsSent: 0,
      duration: 0
    };
  }
}
