import { FastifyInstance } from 'fastify';

// Mask sensitive values for security
function maskSecret(value: string | undefined): string {
  if (!value) return 'NOT_SET';
  if (value.length <= 8) return 'SET';
  return value.substring(0, 4) + '...' + value.substring(value.length - 4);
}

export default async function routes(fastify: FastifyInstance) {
  // Config health endpoint - reports what's configured without exposing secrets
  fastify.get('/v1/health/config', async (req, reply) => {
    const config = {
      ok: true,
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'production',
      base_url: process.env.BASE_URL || 'https://routed.onrender.com',
      
      services: {
        database: {
          configured: !!process.env.DATABASE_URL,
          ssl_enabled: process.env.DATABASE_SSL === 'true'
        },
        
        redis: {
          configured: !!process.env.REDIS_URL,
          url_prefix: process.env.REDIS_URL ? process.env.REDIS_URL.substring(0, 10) + '...' : 'NOT_SET'
        },
        
        twilio: {
          account_configured: !!process.env.TWILIO_ACCOUNT_SID,
          auth_configured: !!process.env.TWILIO_AUTH_TOKEN,
          verify_service_configured: !!process.env.TWILIO_VERIFY_SERVICE_SID,
          api_key_configured: !!process.env.TWILIO_API_KEY_SID,
          from_number_set: !!process.env.TWILIO_FROM,
          programmable_sms_enabled: process.env.USE_TWILIO_PROGRAMMABLE_SMS === '1',
          account_sid_prefix: maskSecret(process.env.TWILIO_ACCOUNT_SID),
          verify_service_prefix: maskSecret(process.env.TWILIO_VERIFY_SERVICE_SID)
        },
        
        ai: {
          openai: {
            configured: !!(process.env.OPENAI_API_KEY || process.env.OPEN_AI_KEY),
            env_var_used: process.env.OPENAI_API_KEY ? 'OPENAI_API_KEY' : 
                         process.env.OPEN_AI_KEY ? 'OPEN_AI_KEY' : 'NONE',
            key_prefix: maskSecret(process.env.OPENAI_API_KEY || process.env.OPEN_AI_KEY)
          },
          gemini: {
            configured: !!process.env.GEMINI_API_KEY,
            key_prefix: maskSecret(process.env.GEMINI_API_KEY)
          }
        },
        
        push_notifications: {
          vapid_public_set: !!process.env.VAPID_PUBLIC,
          vapid_private_set: !!process.env.VAPID_PRIVATE,
          configured: !!(process.env.VAPID_PUBLIC && process.env.VAPID_PRIVATE)
        },
        
        admin: {
          token_configured: !!process.env.HUB_ADMIN_TOKEN,
          token_prefix: maskSecret(process.env.HUB_ADMIN_TOKEN)
        }
      },
      
      urls: {
        latest_dmg: process.env.LATEST_DMG_URL || 'NOT_SET'
      },
      
      flags: {
        apply_schema_on_boot: process.env.APPLY_SCHEMA_ON_BOOT === 'true',
        git_lfs_skip_smudge: process.env.GIT_LFS_SKIP_SMUDGE === '1'
      },
      
      recommendations: [] as Array<{severity: string, service: string, message: string}>
    };
    
    // Add recommendations based on config
    if (!config.services.ai.openai.configured) {
      config.recommendations.push({
        severity: 'critical',
        service: 'openai',
        message: 'OpenAI API key not configured. Script generation will not work. Set either OPENAI_API_KEY or OPEN_AI_KEY environment variable.'
      });
    }
    
    if (!config.services.twilio.verify_service_configured) {
      config.recommendations.push({
        severity: 'warning',
        service: 'twilio',
        message: 'Twilio Verify service not configured. Phone verification may not work properly.'
      });
    }
    
    if (!config.services.redis.configured) {
      config.recommendations.push({
        severity: 'info',
        service: 'redis',
        message: 'Redis not configured. Caching and rate limiting may be impacted.'
      });
    }
    
    return reply.send(config);
  });
  
  // Simple OpenAI-specific health check
  fastify.get('/v1/health/openai', async (req, reply) => {
    const hasKey = !!(process.env.OPENAI_API_KEY || process.env.OPEN_AI_KEY);
    const keySource = process.env.OPENAI_API_KEY ? 'OPENAI_API_KEY' : 
                     process.env.OPEN_AI_KEY ? 'OPEN_AI_KEY' : null;
    
    if (!hasKey) {
      return reply.status(503).send({
        ok: false,
        configured: false,
        message: 'OpenAI API key not configured. Set OPENAI_API_KEY or OPEN_AI_KEY environment variable.',
        timestamp: new Date().toISOString()
      });
    }
    
    return reply.send({
      ok: true,
      configured: true,
      key_source: keySource,
      key_prefix: maskSecret(process.env.OPENAI_API_KEY || process.env.OPEN_AI_KEY),
      timestamp: new Date().toISOString()
    });
  });
}
