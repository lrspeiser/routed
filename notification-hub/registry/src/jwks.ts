import { ENV } from './env';
import { generateKeyPair, exportJWK, importJWK, SignJWT, KeyLike, JWK } from 'jose';

let signingKey: KeyLike | null = null;
let publicJwk: JWK | null = null;

export async function initKeys() {
  if (ENV.REGISTRY_PRIVATE_JWK) {
    const jwk = JSON.parse(ENV.REGISTRY_PRIVATE_JWK);
    signingKey = (await importJWK(jwk, 'RS256')) as KeyLike;
    publicJwk = { ...jwk } as JWK;
    delete (publicJwk as any).d;
    delete (publicJwk as any).p;
    delete (publicJwk as any).q;
    delete (publicJwk as any).dp;
    delete (publicJwk as any).dq;
    delete (publicJwk as any).qi;
  } else {
    const { privateKey, publicKey } = await generateKeyPair('RS256');
    signingKey = privateKey as KeyLike;
    publicJwk = (await exportJWK(publicKey)) as JWK;
  }
  (publicJwk as any).kid = ENV.REGISTRY_KEY_ID;
}

export function getJWKS() {
  return { keys: [publicJwk] };
}

export async function signHostStatement(payload: Record<string, any>): Promise<string> {
  if (!signingKey) throw new Error('signing key not initialized');
  const jwt = await new SignJWT(payload)
    .setProtectedHeader({ alg: 'RS256', kid: ENV.REGISTRY_KEY_ID })
    .setIssuedAt()
    .setExpirationTime('10m')
    .setIssuer('notification-registry')
    .sign(signingKey);
  return jwt;
}
