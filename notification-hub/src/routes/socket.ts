import { FastifyInstance } from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import { addSocket, removeSocket } from '../adapters/socket';

export default async function routes(fastify: FastifyInstance) {
  fastify.register(fastifyWebsocket);
  fastify.get('/v1/socket', { websocket: true }, (connection, req) => {
    const url = new URL(req.url ?? '', 'http://localhost');
    const userId = url.searchParams.get('user_id') ?? 'demo-user';
    addSocket(userId, connection.socket);

    connection.socket.on('message', (buf) => {
      console.log('[WS] Received from client:', buf.toString());
    });
    connection.socket.on('close', () => removeSocket(userId, connection.socket));
  });
}
