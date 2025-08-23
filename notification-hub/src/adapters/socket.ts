import { WebSocket } from 'ws';
import { EventEmitter } from 'events';

type SocketRecord = { ws: WebSocket; userId: string; updatedAt: number };

const sockets = new Map<string, SocketRecord[]>();

// Presence events: emits { userId: string, online: boolean }
export const presenceBus = new EventEmitter();

export function addSocket(userId: string, ws: WebSocket) {
  const arr = sockets.get(userId) ?? [];
  arr.push({ ws, userId, updatedAt: Date.now() });
  sockets.set(userId, arr);
  console.log(`[SOCKET] user=${userId} online sockets=${arr.length}`);
  if (arr.length === 1) presenceBus.emit('presence', { userId, online: true });
}

export function removeSocket(userId: string, ws: WebSocket) {
  const arr = (sockets.get(userId) ?? []).filter((s) => s.ws !== ws);
  if (arr.length === 0) sockets.delete(userId);
  else sockets.set(userId, arr);
  console.log(`[SOCKET] user=${userId} disconnected; remaining=${arr.length}`);
  if (arr.length === 0) presenceBus.emit('presence', { userId, online: false });
}

export async function pushToSockets(userId: string, payload: any): Promise<boolean> {
  const arr = sockets.get(userId) ?? [];
  let sent = 0;
  const deliveryAttempts: any[] = [];
  
  console.log(`[SOCKET] Attempting push to user=${userId}, found ${arr.length} socket(s)`);
  
  for (const s of arr) {
    const attempt: any = {
      userId,
      socketState: s.ws.readyState,
      socketOpen: s.ws.readyState === s.ws.OPEN,
      updatedAt: s.updatedAt,
      age: Date.now() - s.updatedAt
    };
    
    if (s.ws.readyState === s.ws.OPEN) {
      try {
        const message = JSON.stringify(payload);
        s.ws.send(message);
        sent++;
        attempt.result = 'success';
        attempt.messageSize = message.length;
        console.log(`[SOCKET] ✓ Message sent to user=${userId}, size=${message.length} bytes`);
      } catch (e: any) {
        attempt.result = 'error';
        attempt.error = e.message;
        console.warn(`[SOCKET] ✗ Send failed for user=${userId}:`, e.message);
        try { s.ws.terminate(); } catch {}
      }
    } else {
      attempt.result = 'socket_not_open';
      console.log(`[SOCKET] Socket not open for user=${userId}, state=${s.ws.readyState}`);
    }
    
    deliveryAttempts.push(attempt);
  }
  
  console.log(`[SOCKET] Push summary for user=${userId}:`, {
    total_sockets: arr.length,
    successful_sends: sent,
    payload_type: payload.type,
    payload_title: payload.title,
    attempts: deliveryAttempts
  });
  
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

export function snapshotSockets(): Array<{ userId: string; count: number; updatedAt: number }> {
  const out: Array<{ userId: string; count: number; updatedAt: number }> = [];
  for (const [userId, arr] of sockets.entries()) {
    const open = arr.filter((s) => s.ws.readyState === s.ws.OPEN);
    const latest = open.reduce((acc, s) => Math.max(acc, s.updatedAt), 0);
    out.push({ userId, count: open.length, updatedAt: latest });
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}
