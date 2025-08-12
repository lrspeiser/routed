import { Worker } from 'bullmq';
import { deliverQueue, deliverJobOpts, connection } from '../queues';
import { pool } from '../db';

type FanoutJob = { messageId: string };

type SubRow = {
  user_id: string;
  device_id: string | null;
  kind: string | null;
  token: any | null;
};

export const fanoutWorker = new Worker<FanoutJob>(
  'fanout',
  async (job) => {
    const messageId = job.data.messageId;
    console.log('[FANOUT] Start', { messageId });

    // Load message and ensure not expired
    const { rows: msgRows } = await pool.query(
      `select tenant_id, topic_id, expires_at from messages where id=$1`,
      [messageId]
    );
    if (msgRows.length === 0) {
      console.warn('[FANOUT] Message not found; skipping.');
      return;
    }
    const msg = msgRows[0];
    if (new Date(msg.expires_at).getTime() <= Date.now()) {
      console.warn('[FANOUT] Message already expired; skipping.');
      return;
    }

    // Resolve subscribers and their devices
    const { rows } = await pool.query<SubRow>(
      `
      select s.user_id, d.id as device_id, d.kind, d.token
      from subscriptions s
      left join devices d on d.user_id = s.user_id and d.tenant_id = s.tenant_id
      where s.topic_id = $1 and s.tenant_id = $2
      `,
      [msg.topic_id, msg.tenant_id]
    );

    if (rows.length === 0) {
      console.log('[FANOUT] No subscribers/devices found; finishing.', { messageId });
      return;
    }

    // Group by user to avoid duplicate socket jobs
    const byUser = new Map<string, SubRow[]>();
    for (const r of rows) {
      const arr = byUser.get(r.user_id) ?? [];
      arr.push(r);
      byUser.set(r.user_id, arr);
    }

    let jobsAdded = 0;

    for (const [userId, devices] of byUser.entries()) {
      // 1) Always enqueue a socket attempt first (no deviceId needed)
      const { rows: del1 } = await pool.query(
        `insert into deliveries (message_id, user_id, device_id, channel, status) values ($1,$2,null,'socket','queued') returning id`,
        [messageId, userId]
      );
      await deliverQueue.add(
        'deliver',
        { deliveryId: del1[0].id, messageId, userId, channel: 'socket' },
        deliverJobOpts
      );
      jobsAdded++;

      // 2) Enqueue per-device deliveries for push channels
      for (const d of devices) {
        if (!d.device_id || !d.kind) continue;
        if (d.kind === 'socket') continue; // sockets handled above
        const { rows: del2 } = await pool.query(
          `insert into deliveries (message_id, user_id, device_id, channel, status) values ($1,$2,$3,$4,'queued') returning id`,
          [messageId, userId, d.device_id, d.kind]
        );
        await deliverQueue.add(
          'deliver',
          {
            deliveryId: del2[0].id,
            messageId,
            userId,
            deviceId: d.device_id,
            channel: (d.kind as any),
            token: d.token,
          },
          deliverJobOpts
        );
        jobsAdded++;
      }
    }

    console.log('[FANOUT] Enqueued deliveries', { messageId, jobsAdded, users: byUser.size });
  },
  { connection }
);

fanoutWorker.on('failed', (job, err) => {
  console.error('[FANOUT] Job failed:', job?.id, err);
});
