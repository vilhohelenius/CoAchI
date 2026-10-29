// Test-only RS256 helpers (WebCrypto), so no jose dependency is needed.
const enc = (o: unknown) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url')
export const generateKeyPair = () => crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']) as Promise<CryptoKeyPair>
export const exportJWK = (k: CryptoKey) => crypto.subtle.exportKey('jwk', k)
export async function SignJWT(claims: object, key: CryptoKey, kid: string) {
  const data = `${enc({ alg: 'RS256', kid })}.${enc(claims)}`
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(data))
  return `${data}.${Buffer.from(sig).toString('base64url')}`
}
