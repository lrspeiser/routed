import jwt from 'jsonwebtoken';
import { ENV } from '../env';

export function requireAuth(req: any, reply: any, done: any) {
  try {
    const hdr = (req.headers.authorization as string) || '';
    const m = hdr.match(/^Bearer (.+)$/);
    if (!m) return reply.status(401).send({ error: 'missing bearer' });
    const payload = jwt.verify(m[1], ENV.JWT_SIGNING_KEY, { issuer: 'routed' }) as any;
    (req as any).auth = payload; // { sub, did, cnf? }
    done();
  } catch (e) {
    return reply.status(401).send({ error: 'invalid token' });
  }
}
