import Fastify from 'fastify';
import { ENV } from './env';
import { initKeys, getJWKS } from './jwks';
import { pool } from './db';
import hosts from './routes/hosts';

async function main() {
  await initKeys();
  const app = Fastify({ logger: { level: 'info' } });

  app.get('/healthz', async () => ({ ok: true }));
  app.get('/.well-known/jwks.json', async () => getJWKS());

  await app.register(hosts);

  app.listen({ port: ENV.PORT, host: '0.0.0.0' }, (err, addr) => {
    if (err) {
      console.error('[REG][BOOT] Server failed to start:', err);
      process.exit(1);
    }
    console.log(`[REG][BOOT] Registry listening at ${addr}`);
  });
}

main().catch((e) => {
  console.error('[REG][BOOT] Fatal:', e);
  process.exit(1);
});
