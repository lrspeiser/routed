import { Worker } from 'bullmq';
import { pool } from '../db';
import { connection, deliverDlq } from '../queues';
import { sendWebPush } from '../adapters/webpush';
import { pushToSockets } from '../adapters/socket';

type DeliverJob = {
  deliveryId: string;
  messageId: string;
  userId: string;
  deviceId?: string;
  channel: 'socket' | 'webpush' | 'apns' | 'fcm';
  token?: any;
};

export const deliverWorker = new Worker<DeliverJob>(
  'deliver',
  async (job) => {
    const { deliveryId, messageId, userId, channel, token } = job.data;

    const { rows } = await pool.query(
      `select title, body, payload, expires_at from messages where id=$1`,
      [messageId]
    );
    if (rows.length === 0) {
      console.warn('[DELIVER] Message disappeared; marking failed.');
      await pool.query(
        `update deliveries set status='failed', updated_at=now(), last_error='message_missing' where id=$1`,
        [deliveryId]
      );
      return;
    }
    const msg = rows[0];
    if (new Date(msg.expires_at).getTime() <= Date.now()) {
      console.warn('[DELIVER] Message expired before delivery.');
      await pool.query(
        `update deliveries set status='expired', updated_at=now(), last_error='expired' where id=$1`,
        [deliveryId]
      );
      return;
    }

    const envelope = { title: msg.title, body: msg.body, payload: msg.payload };

    try {
      let ok = false;

      if (channel === 'socket') {
        ok = await pushToSockets(userId, { type: 'notification', ...envelope });
      } else if (channel === 'webpush' && token) {
        await sendWebPush(token, envelope);
        ok = true;
      } else if (channel === 'apns') {
        console.log('[DELIVER] (stub) APNs send simulated.');
        ok = true;
      } else if (channel === 'fcm') {
        console.log('[DELIVER] (stub) FCM send simulated.');
        ok = true;
      } else {
        console.warn('[DELIVER] Unknown/unsupported channel:', channel);
      }

      if (ok) {
        await pool.query(
          `update deliveries set status='sent', updated_at=now(), last_error=null where id=$1`,
          [deliveryId]
        );
        console.log(`[DELIVER] Sent via ${channel} to user=${userId}`);
      } else {
        throw new Error('No delivery path succeeded');
      }
    } catch (e: any) {
      console.error('[DELIVER] Failed; will retry:', e.message);
      await pool.query(
        `update deliveries set status='failed', updated_at=now(), last_error=$2 where id=$1`,
        [deliveryId, String(e)]
      );
      // If this was the last attempt, move to DLQ
      if ((job.attemptsMade ?? 0) + 1 >= (job.opts.attempts ?? 1)) {
        await deliverDlq.add('deliver-dlq', job.data);
      }
      throw e;
    }
  },
  { connection }
);

deliverWorker.on('failed', (job, err) => {
  console.error('[DELIVER] Job failed:', job?.id, err);
});
