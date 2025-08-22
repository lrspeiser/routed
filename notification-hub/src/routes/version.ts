import { FastifyInstance } from 'fastify';
import { readFileSync } from 'fs';
import { join } from 'path';

// Backend version - update this when making significant changes
const BACKEND_VERSION = '1.0.3';
const BACKEND_BUILD_DATE = '2025-08-21';

export default async function routes(fastify: FastifyInstance) {
  fastify.get('/v1/version', async (req, reply) => {
    try {
      // Try to get package.json version as well
      let packageVersion = 'unknown';
      try {
        const packagePath = join(__dirname, '../../package.json');
        const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));
        packageVersion = packageJson.version || 'unknown';
      } catch {}

      // Check environment configuration status
      const configStatus = {
        database: !!process.env.DATABASE_URL,
        twilio_configured: !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN),
        twilio_verify: !!process.env.TWILIO_VERIFY_SERVICE_SID,
        openai_configured: !!(process.env.OPENAI_API_KEY || process.env.OPEN_AI_KEY),
        gemini_configured: !!process.env.GEMINI_API_KEY,
        redis_configured: !!process.env.REDIS_URL,
        vapid_configured: !!(process.env.VAPID_PUBLIC && process.env.VAPID_PRIVATE),
        admin_token_set: !!process.env.HUB_ADMIN_TOKEN
      };

      const versionInfo = {
        ok: true,
        backend_version: BACKEND_VERSION,
        build_date: BACKEND_BUILD_DATE,
        package_version: packageVersion,
        node_version: process.version,
        environment: process.env.NODE_ENV || 'production',
        base_url: process.env.BASE_URL || 'https://routed.onrender.com',
        timestamp: new Date().toISOString(),
        features: {
          /**
           * Feature flags for client compatibility
           * twilio_verify: Indicates this backend uses Twilio Verify API
           * See /TWILIO_INTEGRATION_FIXES.md for implementation details
           */
          twilio_verify: true,
          enhanced_logging: true,
          version_check: true,
          script_generation: configStatus.openai_configured
        },
        config_status: configStatus
      };

      console.log(`[VERSION] Version check from ${req.ip || 'unknown'}`);
      return reply.send(versionInfo);
    } catch (e: any) {
      console.error('[VERSION] Error:', e);
      return reply.status(500).send({ 
        ok: false, 
        error: 'version_check_failed',
        message: String(e?.message || e) 
      });
    }
  });

  // Health check that also returns version
  fastify.get('/v1/health/version', async (req, reply) => {
    return reply.send({
      ok: true,
      healthy: true,
      backend_version: BACKEND_VERSION,
      timestamp: new Date().toISOString()
    });
  });
}
