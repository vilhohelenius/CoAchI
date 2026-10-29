const BASE = 'https://personal.connectapi.garmin.com'
const MINT = `${BASE}/personalapitoken-service/personal-api/personal-api-key/token`

// Max days per request, tested in docs/garmin-api-findings.md.
export const WINDOW = { daily: 365, hrv: 365, sleep: 32, bodybattery: 31, stress: 28, steps: 28 } as const

export class GarminError extends Error {
  constructor(public endpoint: string, public status: number) { super(`${endpoint} ${status}`) }
}

export const addDays = (d: string, n: number) => new Date(Date.parse(d) + n * 864e5).toISOString().slice(0, 10)
export const localToday = () => new Date().toLocaleDateString('sv-SE')

// Windows of at most `days` days covering [floor, end], newest first.
export function windows(floor: string, end: string, days: number): [string, string][] {
  const out: [string, string][] = []
  for (let to = end; to >= floor; ) {
    const from = addDays(to, -(days - 1))
    out.push([from < floor ? floor : from, to])
    to = addDays(from, -1)
  }
  return out
}

function jwtExp(jwt: string): number {
  try { return JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString()).exp * 1000 } catch { return 0 }
}

type Opts = {
  apiKey: string
  fetch?: typeof fetch
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  gapMs?: number                       // polite gap between requests, doubles on 429
  onSecret?: (s: string) => void       // logger masking hook
}

export class Garmin {
  gapMs: number
  rateLimited = 0
  mints = 0
  private jwt = ''
  private exp = 0
  private last = 0
  constructor(private o: Opts) { this.gapMs = o.gapMs ?? 1000 }
  private now = () => (this.o.now ?? Date.now)()
  private sleep = (ms: number) => (this.o.sleep ?? ((m) => new Promise<void>((r) => setTimeout(r, m))))(ms)

  private async raw(endpoint: string, url: string, init: RequestInit): Promise<Response> {
    const wait = this.last + this.gapMs - this.now()
    if (wait > 0) await this.sleep(wait)
    this.last = this.now()
    try { return await (this.o.fetch ?? fetch)(url, init) } catch { throw new GarminError(endpoint, 0) } // never keep the cause (it holds the URL)
  }

  private async token(force = false): Promise<string> {
    if (!force && this.jwt && this.now() < this.exp - 3600e3) return this.jwt
    const r = await this.raw('token', MINT, { method: 'POST', headers: { authorization: `ApiKey ${this.o.apiKey}` } })
    if (!r.ok) throw new GarminError('token', r.status)
    this.jwt = (await r.text()).trim()
    this.exp = jwtExp(this.jwt)
    this.mints++
    this.o.onSecret?.(this.jwt)
    return this.jwt
  }

  /** GET with JWT, 401 re-mint, 429/5xx backoff (1,2,4 s). Returns null for 204, bytes for binary. */
  async get(endpoint: string, path: string, query: Record<string, string | number> = {}, binary = false): Promise<any> {
    const qs = new URLSearchParams(Object.entries(query).map(([k, v]) => [k, String(v)])).toString()
    const url = `${BASE}${path}${qs ? `?${qs}` : ''}`
    let reminted = false
    for (let attempt = 0; ; attempt++) {
      const r = await this.raw(endpoint, url, { headers: { authorization: `Bearer ${await this.token()}` } })
      if (r.status === 401 && !reminted) { reminted = true; await this.token(true); continue }
      if (r.status === 429 || r.status >= 500 || r.status === 0) {
        if (r.status === 429) { this.rateLimited++; this.gapMs = Math.min(this.gapMs * 2, 8000) }
        if (attempt < 3) { await this.sleep(1000 * 2 ** attempt); continue }
      }
      if (r.status === 204) return null
      if (!r.ok) throw new GarminError(endpoint, r.status)
      if (binary) return new Uint8Array(await r.arrayBuffer())
      const t = await r.text()
      try { return t ? JSON.parse(t) : null } catch { throw new GarminError(endpoint, -1) } // SyntaxError text would quote the body
    }
  }
}
