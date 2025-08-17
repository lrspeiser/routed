import jwt from 'jsonwebtoken';
import { cfg } from './config';

export function signAccessToken({ userId, deviceId, dpopJkt }: { userId: string; deviceId: string; dpopJkt?: string }) {
  const now = Math.floor(Date.now() / 1000);
  const payload: any = { sub: userId, did: deviceId, iat: now };
  if (dpopJkt) payload.cnf = { jkt: dpopJkt };
  return jwt.sign(payload, cfg.jwtSigningKey, {
    algorithm: 'HS256',
    issuer: cfg.jwtIssuer,
    expiresIn: cfg.jwtAccessTTL,
  });
}
