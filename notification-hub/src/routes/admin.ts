import { FastifyInstance } from 'fastify';
import { deliverDlq, deliverQueue, deliverJobOpts } from '../queues';
import { ENV } from '../env';

export default async function routes(fastify: FastifyInstance) {
  // Public config for client bootstrapping
  fastify.get('/v1/config/public', async () => ({
    host_id: process.env.HOST_ID || null,
    base_url: process.env.BASE_URL || null,
    vapid_public: ENV.VAPID_PUBLIC || null,
  }));

  // DLQ replay: moves all jobs from deliver-dlq back to deliver
  fastify.post('/v1/admin/dlq/replay', async (_req, reply) => {
    const waiting = await deliverDlq.getJobs(['waiting', 'delayed', 'failed'], 0, 1000);
    let moved = 0;
    for (const j of waiting) {
      await deliverQueue.add('deliver', j.data as any, deliverJobOpts);
      await j.remove();
      moved++;
    }
    return reply.send({ moved });
  });
}
