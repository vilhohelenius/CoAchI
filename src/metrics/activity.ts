// Per-activity derived data: downsampled chart series, km splits, efficiency factor and decoupling.
// Pure functions over the 1 Hz streams from sync/fit.ts. The sync fit stage writes the result to R2 as detail/{id}.json.
type N = number | null | undefined
export type S = { t: N[]; hr: N[]; speed: N[]; alt: N[]; cad: N[]; pwr: N[]; lat: N[]; lon: N[]; dist: N[]; str?: N[]; vo?: N[]; vr?: N[]; gct?: N[]; bal?: N[] }
const fin = (v: N): v is number => typeof v === 'number' && Number.isFinite(v)
const r = (v: number, p = 1) => Math.round(v * 10 ** p) / 10 ** p

/** At most n points. Each bucket is averaged, a bucket with no values stays null. */
export function downsample(xs: N[], n: number, p = 1): (number | null)[] {
  if (xs.length <= n) return xs.map((v) => (fin(v) ? r(v, p) : null))
  return Array.from({ length: n }, (_, i) => {
    const a = Math.floor((i * xs.length) / n), b = Math.floor(((i + 1) * xs.length) / n)
    let s = 0, c = 0
    for (let j = a; j < b; j++) if (fin(xs[j])) { s += xs[j] as number; c++ }
    return c ? r(s / c, p) : null
  })
}

/** At most n [lat, lon] pairs, evenly picked from the samples that have a fix. */
export function route(lat: N[], lon: N[], n = 200): [number, number][] {
  const pts: [number, number][] = []
  lat.forEach((la, i) => { if (fin(la) && fin(lon[i])) pts.push([la, lon[i] as number]) })
  if (pts.length <= n) return pts
  return Array.from({ length: n }, (_, i) => pts[Math.round((i * (pts.length - 1)) / (n - 1))])
}

/** One row per full kilometre: seconds taken and mean heart rate. Needs the distance stream. */
export function splits(s: Pick<S, 't' | 'hr' | 'dist'>): { km: number; s: number; hr: number | null }[] {
  const out: { km: number; s: number; hr: number | null }[] = []
  let t0 = 0, a = 0
  for (let i = 0; i < s.t.length; i++) {
    const d = s.dist[i], t = s.t[i]
    if (!fin(d) || !fin(t)) continue
    if (d >= (out.length + 1) * 1000) {
      let h = 0, c = 0
      for (let j = a; j <= i; j++) if (fin(s.hr[j])) { h += s.hr[j] as number; c++ }
      out.push({ km: out.length + 1, s: Math.round(t - t0), hr: c ? Math.round(h / c) : null })
      t0 = t; a = i + 1
    }
  }
  return out
}

export type Eff = { ef: number | null; decoupling: number | null; why: 'ok' | 'no_hr' | 'short' | 'variable' }
const WARM = 600, STEADY = 1200, FULL = 2400

/**
 * Efficiency factor (metres per minute per beat) and Pa:HR decoupling in percent, see docs/metrics.md section 8.
 * Steady part = moving samples after a 10 min warm-up, at least 20 min, pace CV under 8% over 60 s blocks.
 * Decoupling also needs 40 min in total. ponytail: raw speed, no grade adjustment, add Minetti GAP for hilly runs.
 */
export function efficiency(s: Pick<S, 't' | 'hr' | 'speed'>): Eff {
  const none = (why: Eff['why']): Eff => ({ ef: null, decoupling: null, why })
  if (s.hr.filter(fin).length < 60) return none('no_hr')
  const end = s.t.filter(fin).at(-1) ?? 0
  const pts: { t: number; w: number; v: number; h: number }[] = []
  for (let i = 0; i < s.t.length - 1; i++) {
    const t = s.t[i], v = s.speed[i], h = s.hr[i]
    if (fin(t) && fin(v) && fin(h) && t >= WARM && v >= 0.8 && h >= 40) pts.push({ t, w: Math.min(10, (s.t[i + 1] as number) - t) || 1, v, h })
  }
  const wsum = (xs: typeof pts) => xs.reduce((a, x) => a + x.w, 0)
  if (wsum(pts) < STEADY) return none('short')
  const blocks = new Map<number, number[]>()
  for (const p of pts) { const k = Math.floor(p.t / 60), b = blocks.get(k) ?? []; b.push(p.v); blocks.set(k, b) }
  const m = [...blocks.values()].map((b) => b.reduce((a, x) => a + x, 0) / b.length), mu = m.reduce((a, x) => a + x, 0) / m.length
  const cv = Math.sqrt(m.reduce((a, x) => a + (x - mu) ** 2, 0) / m.length) / mu
  if (m.length < 3 || cv >= 0.08) return none('variable')
  const ef = (xs: typeof pts) => (xs.reduce((a, x) => a + x.w * x.v, 0) * 60) / xs.reduce((a, x) => a + x.w * x.h, 0)
  const mid = wsum(pts) / 2
  let acc = 0
  const first = pts.filter((p) => ((acc += p.w) - p.w) < mid), second = pts.slice(first.length)
  const [e1, e2] = [ef(first), ef(second)]
  return { ef: r(ef(pts), 3), decoupling: end >= FULL ? r(((e1 - e2) / e1) * 100) : null, why: end >= FULL ? 'ok' : 'short' }
}

export const MAXPTS = 300
/** The JSON stored in R2 and read by GET /api/activities/:id. */
export function buildDetail(s: S) {
  const t = s.t.filter(fin)
  // Running dynamics: only series with at least one value are written.
  const dyn = Object.fromEntries((['str', 'vo', 'vr', 'gct', 'bal'] as const).filter((k) => s[k]?.some(fin)).map((k) => [k, downsample(s[k]!, MAXPTS, k === 'str' ? 2 : k === 'vr' ? 2 : 1)]))
  return {
    ...dyn,
    ...(s.alt.some(fin) && { alt: downsample(s.alt, MAXPTS, 1) }),
    n: Math.min(MAXPTS, s.t.length), duration_s: t.at(-1) ?? 0,
    hr: downsample(s.hr, MAXPTS, 0), speed: downsample(s.speed, MAXPTS, 2), cad: downsample(s.cad, MAXPTS, 0), pwr: downsample(s.pwr, MAXPTS, 0),
    route: route(s.lat, s.lon), splits: splits(s), ...efficiency(s),
  }
}
export type Detail = ReturnType<typeof buildDetail>
