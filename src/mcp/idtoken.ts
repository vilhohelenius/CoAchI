// Verifies the Access OIDC id token (RS256) against the app's JWKS. Returns the claims or null.
const b64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))
const json = (s: string) => JSON.parse(new TextDecoder().decode(b64(s)))

export async function verifyIdToken(token: string | undefined, o: { jwksUrl: string; aud: string; fetch: typeof fetch; now: number }): Promise<{ email?: string } | null> {
  try {
    const [h, p, s] = (token ?? '').split('.')
    if (!s) return null
    const head = json(h), claims = json(p)
    if (head.alg !== 'RS256') return null
    const { keys } = (await (await o.fetch(o.jwksUrl)).json()) as { keys: (JsonWebKey & { kid: string })[] }
    const jwk = keys.find((k) => k.kid === head.kid)
    if (!jwk) return null
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'])
    if (!(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64(s), new TextEncoder().encode(`${h}.${p}`)))) return null
    const t = o.now / 1000
    const aud = ([] as string[]).concat(claims.aud ?? [])
    const iss = String(claims.iss ?? '')
    return aud.includes(o.aud) && claims.exp > t && !(claims.nbf > t) && iss.startsWith(new URL(o.jwksUrl).origin + '/') ? claims : null
  } catch { return null }
}
