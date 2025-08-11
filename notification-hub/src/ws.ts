import { WebSocketServer } from 'ws';
import type { FastifyInstance } from 'fastify';
import { addSocket, removeSocket } from './adapters/socket';

export function setupWs(app: FastifyInstance) {
  const wss = new WebSocketServer({ noServer: true });

  function handleConnection(ws: any, req: any) {
    const url = new URL(req.url ?? '', 'http://localhost');
    const userId = url.searchParams.get('user_id') ?? 'demo-user';
    const ip = (req.headers['x-forwarded-for'] as string) || (req.socket && req.socket.remoteAddress) || 'unknown';
    console.log('[WS-UPGRADE] Connect', { userId, ip, path: url.pathname });
    addSocket(userId, ws);
    try { ws.send(JSON.stringify({ type: 'hello', user_id: userId, ts: Date.now() })); } catch {}

    let pingTimer: NodeJS.Timeout | null = null;
    const startPing = () => { if (!pingTimer) pingTimer = setInterval(() => { try { ws.ping(); } catch {} }, 25000); };
    const stopPing = () => { if (pingTimer) { clearInterval(pingTimer); pingTimer = null; } };
    startPing();

    ws.on('message', (buf: any) => console.log('[WS-UPGRADE] Received:', buf.toString()));
    ws.on('close', (code: any, reason: any) => { console.log('[WS-UPGRADE] Close', { userId, code, reason: reason?.toString?.() || '' }); removeSocket(userId, ws); stopPing(); });
    ws.on('error', (err: any) => console.warn('[WS-UPGRADE] Error', { userId, err: String(err?.message || err) }));
  }

  app.server.on('upgrade', (req, socket, head) => {
    try {
      const url = new URL(req.url ?? '', 'http://localhost');
      // Accept both /socket and /v1/socket
      if (url.pathname !== '/socket' && url.pathname !== '/v1/socket') {
        return;
      }
      wss.handleUpgrade(req, socket as any, head, (ws) => handleConnection(ws, req));
    } catch (e) {
      console.warn('[WS-UPGRADE] Upgrade handler error', e);
      try { (socket as any).destroy(); } catch {}
    }
  });

  console.log('[WS-UPGRADE] Handler attached to HTTP server');
}


