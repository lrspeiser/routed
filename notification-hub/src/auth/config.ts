import { ENV } from '../env';

export const cfg = {
  jwtAccessTTL: 10 * 60, // 10 minutes
  jwtIssuer: 'routed',
  refreshTTLDaysIdle: 14,
  refreshTTLDaysAbsolute: 90,
  jwtSigningKey: ENV.JWT_SIGNING_KEY, // HS256 for now; can upgrade to RS256/EdDSA
  encKey: Buffer.from(ENV.SECRET_ENC_KEY, 'base64'), // 32 bytes for AES-256-GCM
  defaultOpenAIKey: ENV.DEFAULT_OPENAI_KEY || '',
};
