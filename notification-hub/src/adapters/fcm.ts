export type FcmToken = string;

export async function sendFcm(_token: FcmToken, _payload: any): Promise<void> {
  // TODO: integrate firebase-admin
  console.log('[FCM] (stub) FCM send simulated.');
}
