import 'dotenv/config';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`[BOOT] Missing env var ${name}. Exiting.`);
    process.exit(1);
  }
  return value;
}

export const ENV = {
  NODE_ENV: process.env.NODE_ENV ?? 'development',
  PORT: Number(process.env.PORT ?? 8080),
  DATABASE_URL: requireEnv('DATABASE_URL'),
  REDIS_URL: requireEnv('REDIS_URL'),
  API_HMAC_SECRET: process.env.API_HMAC_SECRET ?? '',
  VAPID_PUBLIC: process.env.VAPID_PUBLIC ?? '',
  VAPID_PRIVATE: process.env.VAPID_PRIVATE ?? '',
  VAPID_SUBJECT: process.env.VAPID_SUBJECT ?? 'mailto:admin@example.com',
  DEFAULT_TTL_SEC: Number(process.env.DEFAULT_TTL_SEC ?? 86400),
  // Auth/crypto
  JWT_SIGNING_KEY: process.env.JWT_SIGNING_KEY || 'dev-insecure-jwt-key',
  SECRET_ENC_KEY: process.env.SECRET_ENC_KEY || Buffer.alloc(32).toString('base64'),
  DEFAULT_OPENAI_KEY: process.env.DEFAULT_OPENAI_KEY || '',
};
