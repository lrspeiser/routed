import crypto from 'crypto';

export function hashToken(token: string): Buffer {
  return crypto.createHash('sha256').update(token, 'utf8').digest();
}

export function randomToken(bytes = 48): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function encryptSecret(plain: string, key: Buffer): Buffer {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]);
}

export function decryptSecret(buf: Buffer, key: Buffer): string {
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(data), decipher.final()]);
  return dec.toString('utf8');
}

export function computeJkt(jwk: any): string {
  // RFC 7638 JWK thumbprint (basic support for EC/RSA pubkeys)
  const subset: any = {};
  for (const k of ['crv', 'kty', 'x', 'y', 'e', 'n']) {
    if (jwk[k] !== undefined) subset[k] = jwk[k];
  }
  const canon = JSON.stringify(subset, Object.keys(subset).sort());
  return crypto.createHash('sha256').update(canon).digest('base64url');
}
