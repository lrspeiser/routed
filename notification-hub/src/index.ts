import Fastify from 'fastify';
import path from 'path';
import fastifyStatic from '@fastify/static';
import fastifyCors from '@fastify/cors';
import { ENV } from './env';
import messages from './routes/messages';
import webpush from './routes/webpush';
import socket from './routes/socket';
import { setupWs } from './ws';
import admin from './routes/admin';
import adminProvision from './routes/admin_provision';
import devroutes from './routes/dev';
import adminUsers from './routes/admin_users';
import adminTest from './routes/admin_test';
import adminChannels from './routes/admin_channels';
import health from './routes/health';
import './workers/fanout';
import './workers/deliver';
import { startTtlSweeper } from './cron/ttl';
import fetch from 'node-fetch';

async function main() {
  const app = Fastify({ logger: { level: 'info' } });

  await app.register(fastifyCors, { origin: true });

  // Register websocket routes BEFORE static to avoid any proxy/static interception on GET Upgrade
  await app.register(socket);
  // Explicit WS upgrade handler sharing the same HTTP server
  setupWs(app);

  await app.register(fastifyStatic, {
    root: path.join(__dirname, '..', 'public'),
    prefix: '/',
  });

  // Redirect for latest DMG to avoid storing large binaries in Git/LFS
  app.get('/downloads/Routed-latest.dmg', async (req, reply) => {
    const url = process.env.LATEST_DMG_URL;
    if (url && /^https?:\/\//i.test(url)) {
      return reply.redirect(302, url);
    }
    return reply.status(404).send({ error: 'not_configured' });
  });

  // Serve site images from /images/
  await app.register(fastifyStatic, {
    root: path.join(__dirname, '..', 'images'),
    prefix: '/images/',
    decorateReply: false,
  });

  app.get('/healthz', async () => ({ ok: true }));
  app.get('/healthz-deep', async () => ({ ok: true, time: Date.now() }));

  await app.register(messages);
  await app.register(webpush);
  await app.register(admin);
  await app.register(adminProvision);
  await app.register(devroutes);
  await app.register(adminUsers);
  await app.register(adminTest);
  await app.register(adminChannels);
  // Auth + secrets routes
  const authComplete = (await import('./routes/auth_complete_sms')).default;
  await app.register(authComplete);
  const authRefresh = (await import('./routes/auth_refresh')).default;
  await app.register(authRefresh);
  const authLogout = (await import('./routes/auth_logout')).default;
  await app.register(authLogout);
  const secrets = (await import('./routes/secrets')).default;
  await app.register(secrets);
  await app.register(health);
  const devPublic = (await import('./routes/dev_public')).default;
  await app.register(devPublic);
  const verifyRoutes = (await import('./routes/verify')).default;
  await app.register(verifyRoutes);

  // Log all registered routes to aid debugging deployments
  try {
    const routes = app.printRoutes();
    console.log('[ROUTES]\n' + routes);
  } catch (e) {
    console.warn('[ROUTES] printRoutes failed:', e);
  }

  const stopTtl = startTtlSweeper();

  app.addHook('onClose', async () => {
    stopTtl();
  });

  // Optional: Heartbeat to registry if configured
  const registryUrl = process.env.REGISTRY_URL;
  const hostId = process.env.HOST_ID;
  const hostToken = process.env.REGISTRY_HOST_TOKEN;
  const baseUrl = process.env.BASE_URL;
  if (registryUrl && hostId && hostToken) {
    const beat = async () => {
      try {
        await fetch(new URL('/v1/hosts/heartbeat', registryUrl).toString(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ host_id: hostId, host_token: hostToken, base_url: baseUrl, vapid_public: ENV.VAPID_PUBLIC || null }),
        });
      } catch (e) {
        console.warn('[REG][HUB] Heartbeat failed:', e);
      }
    };
    setInterval(beat, 60_000);
    beat();
  }

  app.listen({ port: ENV.PORT, host: '0.0.0.0' }, (err, addr) => {
    if (err) {
      console.error('[BOOT] Server failed to start:', err);
      process.exit(1);
    }
    console.log(`[BOOT] Router API listening at ${addr}`);
  });
}

main().catch((e) => {
  console.error('[BOOT] Fatal:', e);
  process.exit(1);
});
