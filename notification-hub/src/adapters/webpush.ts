import webpush from 'web-push';
import { ENV } from '../env';

if (ENV.VAPID_PUBLIC && ENV.VAPID_PRIVATE) {
  webpush.setVapidDetails(ENV.VAPID_SUBJECT, ENV.VAPID_PUBLIC, ENV.VAPID_PRIVATE);
} else {
  console.warn('[WEBPUSH] VAPID keys not set; web push disabled.');
}

export async function sendWebPush(subJson: any, data: any) {
  return webpush.sendNotification(subJson, JSON.stringify(data), { TTL: 60 });
}
