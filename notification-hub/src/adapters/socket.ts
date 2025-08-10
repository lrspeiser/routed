import { WebSocket } from 'ws';

type SocketRecord = { ws: WebSocket; userId: string; updatedAt: number };

const sockets = new Map<string, SocketRecord[]>();

export function addSocket(userId: string, ws: WebSocket) {
  const arr = sockets.get(userId) ?? [];
  arr.push({ ws, userId, updatedAt: Date.now() });
  sockets.set(userId, arr);
  console.log(`[SOCKET] user=${userId} online sockets=${arr.length}`);
}

export function removeSocket(userId: string, ws: WebSocket) {
  const arr = (sockets.get(userId) ?? []).filter((s) => s.ws !== ws);
  if (arr.length === 0) sockets.delete(userId);
  else sockets.set(userId, arr);
  console.log(`[SOCKET] user=${userId} disconnected; remaining=${arr.length}`);
}

export async function pushToSockets(userId: string, payload: any): Promise<boolean> {
  const arr = sockets.get(userId) ?? [];
  let sent = 0;
  for (const s of arr) {
    if (s.ws.readyState === s.ws.OPEN) {
      try {
        s.ws.send(JSON.stringify(payload));
        sent++;
      } catch (e) {
        console.warn('[SOCKET] send failed; will drop socket:', e);
        try { s.ws.terminate(); } catch {}
      }
    }
  }
  if (sent > 0) console.log(`[SOCKET] pushed to user=${userId} sockets=${sent}`);
  return sent > 0;
}

export async function broadcastToAll(payload: any): Promise<number> {
  let total = 0;
  for (const [userId, arr] of sockets.entries()) {
    for (const s of arr) {
      if (s.ws.readyState === s.ws.OPEN) {
        try {
          s.ws.send(JSON.stringify(payload));
          total++;
        } catch {}
      }
    }
  }
  console.log(`[SOCKET] broadcast sent to ${total} sockets`);
  return total;
}

export function isUserOnline(userId: string): boolean {
  const arr = sockets.get(userId) ?? [];
  for (const s of arr) {
    if (s.ws.readyState === s.ws.OPEN) return true;
  }
  return false;
}
