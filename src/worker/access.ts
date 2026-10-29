// Verifies the Cloudflare Access JWT (RS256) against the team JWKS with WebCrypto.
export type Fetch = typeof fetch
let cache: { at: number; keys: Record<string, JsonWebKey> } | undefined

const b64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))
const json = (s: string) => JSON.parse(new TextDecoder().decode(b64(s)))

async function jwks(team: string, f: Fetch, now: number, refresh: boolean) {
  if (!refresh && cache && now - cache.at < 3600e3) return cache.keys
  const r = await f(`https://${team}/cdn-cgi/access/certs`)
  if (!r.ok) throw new Error('jwks')
  const { keys } = (await r.json()) as { keys: (JsonWebKey & { kid: string })[] }
  cache = { at: now, keys: Object.fromEntries(keys.map((k) => [k.kid, k])) }
  return cache.keys
}
export const resetJwksCache = () => { cache = undefined }

export async function verifyAccess(token: string | undefined, o: { team: string; aud: string; fetch: Fetch; now: number }) {
  try {
    const [h, p, s] = (token ?? '').split('.')
    if (!s) return false
    const head = json(h), claims = json(p)
    if (head.alg !== 'RS256') return false
    let jwk = (await jwks(o.team, o.fetch, o.now, false))[head.kid]
    jwk ??= (await jwks(o.team, o.fetch, o.now, true))[head.kid] // key rotation
    if (!jwk) return false
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'])
    if (!(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64(s), new TextEncoder().encode(`${h}.${p}`)))) return false
    const t = o.now / 1000
    const aud = [].concat(claims.aud ?? [])
    return aud.includes(o.aud as never) && claims.exp > t && !(claims.nbf > t) && claims.iss === `https://${o.team}`
  } catch { return false }
}
