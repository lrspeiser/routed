import { FastifyInstance } from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import { addSocket, removeSocket, presenceBus } from '../adapters/socket';

export default async function routes(fastify: FastifyInstance) {
  fastify.register(fastifyWebsocket);
  // Presence SSE channel for admin UI: /v1/presence/stream?topic=runs.finished&tenant_id=...
  fastify.get('/v1/presence', async (req, reply) => {
    const url = new URL(req.url ?? '', 'http://localhost');
    const userId = url.searchParams.get('user_id');
    if (!userId) return reply.status(400).send({ error: 'missing user_id' });
    return reply.send({ user_id: userId, online: true });
  });
  fastify.get('/v1/presence/stream', async (req, reply) => {
    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.flushHeaders();
    const onPresence = (ev: any) => {
      reply.raw.write(`event: presence\n`);
      reply.raw.write(`data: ${JSON.stringify(ev)}\n\n`);
    };
    presenceBus.on('presence', onPresence);
    req.raw.on('close', () => presenceBus.off('presence', onPresence));
  });
  fastify.get('/v1/socket', { websocket: true }, (connection, req) => {
    const url = new URL(req.url ?? '', 'http://localhost');
    const userId = url.searchParams.get('user_id') ?? 'demo-user';
    const ip = (req.headers['x-forwarded-for'] as string) || (req as any).ip;
    console.log('[WS] Connect', { userId, ip });
    addSocket(userId, connection.socket);

    // Send handshake hello so clients can verify connection
    try {
      connection.socket.send(JSON.stringify({ type: 'hello', user_id: userId, ts: Date.now() }));
    } catch {}

    // Keepalive ping
    let pingTimer: NodeJS.Timeout | null = null;
    const startPing = () => {
      stopPing();
      pingTimer = setInterval(() => {
        try { connection.socket.ping(); } catch {}
      }, 25000);
    };
    const stopPing = () => { if (pingTimer) { clearInterval(pingTimer); pingTimer = null; } };
    startPing();

    connection.socket.on('message', (buf) => {
      console.log('[WS] Received from client:', buf.toString());
    });
    connection.socket.on('close', (code, reason) => {
      console.log('[WS] Close', { userId, code, reason: reason?.toString?.() || '' });
      removeSocket(userId, connection.socket);
      stopPing();
    });
    connection.socket.on('error', (err) => {
      console.warn('[WS] Error', { userId, err: String(err?.message || err) });
    });
  });
  // Alternate path for proxies that special-case /v1/*
  fastify.get('/socket', { websocket: true }, (connection, req) => {
    const url = new URL(req.url ?? '', 'http://localhost');
    const userId = url.searchParams.get('user_id') ?? 'demo-user';
    const ip = (req.headers['x-forwarded-for'] as string) || (req as any).ip;
    console.log('[WS] Connect', { userId, ip, alt: true });
    addSocket(userId, connection.socket);
    try { connection.socket.send(JSON.stringify({ type: 'hello', user_id: userId, ts: Date.now() })); } catch {}
    let pingTimer: NodeJS.Timeout | null = null;
    const startPing = () => { if (!pingTimer) pingTimer = setInterval(() => { try { connection.socket.ping(); } catch {} }, 25000); };
    const stopPing = () => { if (pingTimer) { clearInterval(pingTimer); pingTimer = null; } };
    startPing();
    connection.socket.on('message', (buf) => console.log('[WS] Received from client (alt):', buf.toString()));
    connection.socket.on('close', (code, reason) => { console.log('[WS] Close', { userId, code, reason: reason?.toString?.() || '', alt: true }); removeSocket(userId, connection.socket); stopPing(); });
    connection.socket.on('error', (err) => console.warn('[WS] Error', { userId, err: String(err?.message || err), alt: true }));
  });
}
