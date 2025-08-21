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
          twilio_verify: true,
          enhanced_logging: true,
          version_check: true
        }
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
