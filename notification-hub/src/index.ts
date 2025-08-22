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
import { initializeScheduler, stopScheduler } from './cron/script_scheduler';
import fetch from 'node-fetch';
import { randomUUID } from 'crypto';

async function main() {
  const app = Fastify({ logger: { level: 'info' } });

  // Verbose diagnostics: per-request IDs, timings, and headers for clients to inspect
  app.addHook('onRequest', async (request, reply) => {
    try {
      // Ensure a stable request ID
      const rid = request.id || randomUUID();
      (request as any)._rid = String(rid);
      (request as any)._startNs = process.hrtime.bigint();
      reply.header('X-Request-ID', String(rid));
    } catch {}
    // Log inbound request with client hints
    try {
      const ip = (request.headers['x-forwarded-for'] as string) || (request as any).ip;
      app.log.info({ evt: 'req:start', id: (request as any)._rid, method: request.method, url: request.url, ip, ua: request.headers['user-agent'] || '' });
    } catch {}
  });

  app.addHook('onResponse', async (request, reply) => {
    try {
      const start = (request as any)._startNs as bigint | undefined;
      const tookMs = start ? Number((process.hrtime.bigint() - start) / BigInt(1e6)) : undefined;
      const routeUrl = (request.routeOptions && (request.routeOptions as any).url) || request.url;
      if (tookMs !== undefined) reply.header('X-Response-Time', `${tookMs}ms`);
      reply.header('X-Route', String(routeUrl || 'unknown'));
      reply.header('X-Server', 'routed-hub');
      // Success log with timing and size if available
      const len = reply.getHeader('content-length');
      app.log.info({ evt: 'req:done', id: (request as any)._rid, status: reply.statusCode, ms: tookMs, bytes: len ? Number(len as any) : undefined, route: routeUrl });
    } catch (e) {
      app.log.warn({ evt: 'req:done:logfail', id: (request as any)._rid, err: String((e as any)?.message || e) });
    }
  });

  app.setErrorHandler((err, request, reply) => {
    try {
      const start = (request as any)._startNs as bigint | undefined;
      const tookMs = start ? Number((process.hrtime.bigint() - start) / BigInt(1e6)) : undefined;
      const routeUrl = (request.routeOptions && (request.routeOptions as any).url) || request.url;
      reply.header('X-Request-ID', String((request as any)._rid || request.id));
      if (tookMs !== undefined) reply.header('X-Response-Time', `${tookMs}ms`);
      reply.header('X-Route', String(routeUrl || 'unknown'));
      reply.header('X-Server', 'routed-hub');
      const status = (err as any).statusCode || (err as any).status || 500;
      // Log full error context
      app.log.error({ evt: 'req:error', id: (request as any)._rid, status, method: request.method, url: request.url, route: routeUrl, params: request.params, query: request.query, msg: err.message, stack: err.stack });
      // Return verbose JSON so the client can surface exact failure reasons
      return reply
        .status(status)
        .send({ ok: false, error: { message: String(err.message || 'error'), code: (err as any).code || null, status, stack: (err.stack || '').split('\n') }, request: { id: String((request as any)._rid || request.id), method: request.method, url: request.url, route: routeUrl, params: request.params, query: request.query }, timing_ms: tookMs });
    } catch (e) {
      // Fallback if the error handler itself fails
      try { return reply.status(500).send({ ok: false, error: { message: 'internal_error', note: 'error handler failed' } }); } catch {}
    }
  });

  await app.register(fastifyCors, { origin: true });

  // Register websocket routes BEFORE static to avoid any proxy/static interception on GET Upgrade
  await app.register(socket);
  // Explicit WS upgrade handler sharing the same HTTP server
  setupWs(app);

  // Health endpoints should be available regardless of static handling
  await app.register(health);

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
  const devPublic = (await import('./routes/dev_public')).default;
  await app.register(devPublic);
  const verifyRoutes = (await import('./routes/verify')).default;
  await app.register(verifyRoutes);
  const versionRoutes = (await import('./routes/version')).default;
  await app.register(versionRoutes);
  const configHealth = (await import('./routes/config_health')).default;
  await app.register(configHealth);
  const channelScripts = (await import('./routes/channel_scripts')).default;
  await app.register(channelScripts);
  const webhooks = (await import('./routes/webhooks')).default;
  await app.register(webhooks);
  const testMessages = (await import('./routes/test_messages')).default;
  await app.register(testMessages);

  // Log all registered routes to aid debugging deployments
  try {
    const routes = app.printRoutes();
    console.log('[ROUTES]\n' + routes);
  } catch (e) {
    console.warn('[ROUTES] printRoutes failed:', e);
  }

  const stopTtl = startTtlSweeper();
  
  // Initialize script scheduler
  await initializeScheduler();

  app.addHook('onClose', async () => {
    stopTtl();
    stopScheduler();
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
