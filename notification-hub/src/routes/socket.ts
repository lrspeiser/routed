import { FastifyInstance } from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import { addSocket, removeSocket } from '../adapters/socket';

export default async function routes(fastify: FastifyInstance) {
  fastify.register(fastifyWebsocket);
  fastify.get('/v1/socket', { websocket: true }, (connection, req) => {
    const url = new URL(req.url ?? '', 'http://localhost');
    const userId = url.searchParams.get('user_id') ?? 'demo-user';
    const ip = (req.headers['x-forwarded-for'] as string) || (req as any).ip;
    console.log('[WS] Connect', { userId, ip });
    addSocket(userId, connection.socket);

    connection.socket.on('message', (buf) => {
      console.log('[WS] Received from client:', buf.toString());
    });
    connection.socket.on('close', (code, reason) => {
      console.log('[WS] Close', { userId, code, reason: reason.toString() });
      removeSocket(userId, connection.socket);
    });
  });
}
