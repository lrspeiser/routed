import { Queue, JobsOptions } from 'bullmq';
import IORedis from 'ioredis';
import { ENV } from './env';

export const connection = new IORedis(ENV.REDIS_URL, { maxRetriesPerRequest: null });

export const fanoutQueue = new Queue('fanout', { connection });
export const deliverQueue = new Queue('deliver', { connection });
export const deliverDlq = new Queue('deliver-dlq', { connection });

export const deliverJobOpts: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 2000 },
  removeOnComplete: 1000,
  removeOnFail: 1000,
};

export function closeQueues() {
  return Promise.all([
    fanoutQueue.close(),
    deliverQueue.close(),
    deliverDlq.close(),
    connection.quit(),
  ]);
}
