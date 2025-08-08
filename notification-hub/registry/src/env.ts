import 'dotenv/config';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`[REG] Missing env var ${name}. Exiting.`);
    process.exit(1);
  }
  return value;
}

export const ENV = {
  NODE_ENV: process.env.NODE_ENV ?? 'development',
  PORT: Number(process.env.PORT ?? 8090),
  DATABASE_URL: requireEnv('DATABASE_URL'),
  REGISTRY_ADMIN_TOKEN: requireEnv('REGISTRY_ADMIN_TOKEN'),
  REGISTRY_PRIVATE_JWK: process.env.REGISTRY_PRIVATE_JWK ?? '',
  REGISTRY_KEY_ID: process.env.REGISTRY_KEY_ID ?? 'registry-key-1',
};
