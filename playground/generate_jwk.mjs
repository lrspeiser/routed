import { generateKeyPair, exportJWK } from 'jose';
const { privateKey } = await generateKeyPair('RS256', { extractable: true });
const jwk = await exportJWK(privateKey);
jwk.kid = 'playground-key-1';
console.log(JSON.stringify(jwk));