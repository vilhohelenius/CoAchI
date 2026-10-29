import { describe, expect, it } from 'vitest'
import { Garmin, GarminError, windows, WINDOW } from '../sync/garmin.js'

const jwt = (exp: number) => `h.${Buffer.from(JSON.stringify({ exp })).toString('base64url')}.s`
const res = (status: number, body = '') => new Response(body, { status })

function setup(handler: (url: string, n: number) => Response) {
  let t = 1_000_000_000_000
  const calls: string[] = []
  const g = new Garmin({
    apiKey: 'fixture-key', now: () => t, sleep: async (ms) => { t += ms },
    fetch: (async (u: string) => { calls.push(u); return handler(u, calls.length) }) as never,
  })
  return { g, calls, advance: (ms: number) => (t += ms), now: () => t }
}

describe('windows', () => {
  it('covers the range with no overlap and respects the limit', () => {
    const w = windows('2024-01-01', '2025-03-10', 28)
    expect(w[0][1]).toBe('2025-03-10')
    expect(w.at(-1)![0]).toBe('2024-01-01')
    for (const [a, b] of w) expect((Date.parse(b) - Date.parse(a)) / 864e5 + 1).toBeLessThanOrEqual(28)
    for (let i = 1; i < w.length; i++) expect(Date.parse(w[i - 1][0]) - Date.parse(w[i][1])).toBe(864e5)
    expect(windows('2025-01-01', '2024-01-01', 28)).toEqual([])
    expect(WINDOW.sleep).toBe(32)
  })
})

describe('token', () => {
  it('mints once, reuses, re-mints 1h before expiry', async () => {
    const s = setup((u) => (u.includes('/token') ? res(200, jwt(1_000_000_000 + 86400)) : res(200, '{"a":1}')))
    await s.g.get('x', '/a'); await s.g.get('x', '/b')
    expect(s.g.mints).toBe(1)
    s.advance(23 * 3600e3 + 1) // less than 1h left
    await s.g.get('x', '/c')
    expect(s.g.mints).toBe(2)
  })
  it('re-mints once on 401 then succeeds', async () => {
    let first = true
    const s = setup((u) => (u.includes('/token') ? res(200, jwt(2_000_000_000)) : first ? ((first = false), res(401)) : res(200, '[]')))
    expect(await s.g.get('x', '/a')).toEqual([])
    expect(s.g.mints).toBe(2)
  })
  it('retries 5xx with backoff, 429 widens the gap, errors carry only endpoint and status', async () => {
    const s = setup((u, n) => (u.includes('/token') ? res(200, jwt(2_000_000_000)) : n < 4 ? res(429) : res(200, '{}')))
    await s.g.get('x', '/a')
    expect(s.g.rateLimited).toBeGreaterThan(0)
    expect(s.g.gapMs).toBeGreaterThan(1000)
    const bad = setup((u) => (u.includes('/token') ? res(200, jwt(2_000_000_000)) : res(500, 'secret-body')))
    const e = await bad.g.get('daily', '/secret-path/12345', { d: '2025-01-01' }).catch((x) => x)
    expect(e).toBeInstanceOf(GarminError)
    expect(e.message).toBe('daily 500')
  })
})
