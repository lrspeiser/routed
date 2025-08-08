export type ApnsToken = string;

export async function sendApns(_token: ApnsToken, _payload: any): Promise<void> {
  // TODO: integrate node-apn or @parse/node-apn
  console.log('[APNS] (stub) APNs send simulated.');
}
