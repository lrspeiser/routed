import { generateKeyPair, exportJWK, importJWK, JWK, SignJWT, jwtVerify } from 'jose';

let signingKey: any | null = null;
let publicJwk: JWK | null = null;

const KEY_ID = process.env.PLAYGROUND_KEY_ID || 'playground-key-1';
const PRIVATE_JWK = process.env.PLAYGROUND_PRIVATE_JWK || '';

export async function initKeys() {
  if (signingKey && publicJwk) return;
  if (PRIVATE_JWK) {
    const jwk = JSON.parse(PRIVATE_JWK);
    signingKey = await importJWK(jwk, 'RS256');
    publicJwk = { ...jwk } as JWK;
    delete (publicJwk as any).d;
    delete (publicJwk as any).p;
    delete (publicJwk as any).q;
    delete (publicJwk as any).dp;
    delete (publicJwk as any).dq;
    delete (publicJwk as any).qi;
  } else {
    const { privateKey, publicKey } = await generateKeyPair('RS256');
    signingKey = privateKey as any;
    publicJwk = (await exportJWK(publicKey)) as JWK;
  }
  (publicJwk as any).kid = KEY_ID;
}

export function getJWKS() {
  if (!publicJwk) throw new Error('keys not initialized');
  return { keys: [publicJwk] };
}

export async function createChannelCode(descriptor: Record<string, any>) {
  await initKeys();
  if (!signingKey) throw new Error('signing key missing');
  const jwt = await new SignJWT(descriptor)
    .setProtectedHeader({ alg: 'RS256', kid: KEY_ID })
    .setIssuedAt()
    .setExpirationTime('7d')
    .setIssuer('notification-playground')
    .sign(signingKey);
  return jwt;
}

export async function resolveChannelCode(code: string) {
  await initKeys();
  if (!publicJwk) throw new Error('public key missing');
  // Self-verify (local signer). For rotation or multi-region, store codes or use KV/JWT with audience.
  const { payload } = await jwtVerify(code, await importJWK(publicJwk as JWK, 'RS256'), {
    issuer: 'notification-playground',
  });
  return payload as any;
}
