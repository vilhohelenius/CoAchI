// Best efforts, critical speed, Riegel and a VO2 estimate. Pure functions, no I/O. Docs: metrics.md "Records and fitness estimates".
import { addDays, diffDays, weekStart } from './dates.js'

type N = number | null
export type S = { t: N[]; dist: N[]; pwr: N[]; hr: N[]; alt: N[] }

export const DISTANCES = [['1k', 1000], ['1mi', 1609.344], ['5k', 5000], ['10k', 10000], ['hm', 21097.5]] as const
export const DURATIONS = [180, 360, 720, 1200]   // seconds, for critical speed
const MAX_GAP = 60     // s between records before a window is cut, unless the gap is a stand-still (a stop stays in the time, as on Strava). Older files use smart recording, so 10 to 30 s steps are normal
const TOL_M = 10      // m a distance effort may fall short of its label
const MAX_STEP = 25    // m/s between two records, faster is a GPS jump (a 13 m blip in one second is normal noise)
const MAX_SPEED = 9    // m/s over a whole effort, faster is not a runner
const SKIP_S = 480     // steady blocks start after the first 8 minutes (HR lag)
const BLOCK = 300

/** Index ranges [a, b] where time and distance are present, rising, gap-free and without jumps. */
export function segments(t: N[], d: N[]): [number, number][] {
  const out: [number, number][] = []
  let a = -1
  for (let i = 0; i < t.length; i++) {
    const ok = t[i] != null && d[i] != null
    const cut = !ok || (i > 0 && a >= 0 && (t[i - 1] == null || d[i - 1] == null || t[i]! - t[i - 1]! <= 0 || (t[i]! - t[i - 1]! > MAX_GAP && d[i]! - d[i - 1]! >= t[i]! - t[i - 1]!) || d[i]! < d[i - 1]! || (d[i]! - d[i - 1]!) / (t[i]! - t[i - 1]!) > MAX_STEP))
    if (cut && a >= 0) { out.push([a, i - 1]); a = -1 }
    if (ok && a < 0) a = i
  }
  if (a >= 0) out.push([a, t.length - 1])
  return out.filter(([x, y]) => y > x)
}

/** Fastest time over exactly `D` metres, interpolated between records. Null when no continuous stretch is long enough. */
export function bestTime(t0: N[], d: N[], D0: number): number | null {
  const t = t0, D = D0 - TOL_M // a watch that logged 9999 m for a 10 km race still counts, time scaled to the full distance
  let best = Infinity
  for (const [a, b] of segments(t, d)) {
    let i = a
    for (let j = a; j <= b; j++) {
      while (i + 1 <= j && d[j]! - d[i + 1]! >= D) i++
      if (d[j]! - d[i]! < D) continue
      const x = d[j]! - D, ts = i < j && d[i]! < x ? t[i]! + ((x - d[i]!) / (d[i + 1]! - d[i]!)) * (t[i + 1]! - t[i]!) : t[i]!
      const dt = t[j]! - ts
      if (dt > 0 && D / dt <= MAX_SPEED) best = Math.min(best, dt)
    }
  }
  return Number.isFinite(best) ? (best * D0) / D : null
}

/** Furthest distance covered in exactly `T` seconds. */
export function bestDistance(t0: N[], d: N[], T: number): number | null {
  const t = t0
  let best = 0
  for (const [a, b] of segments(t, d)) {
    let i = a
    for (let j = a; j <= b; j++) {
      const x = t[j]! - T
      while (i + 1 <= j && t[i + 1]! <= x) i++
      if (t[i]! > x) continue
      const ds = i < j && t[i]! < x ? d[i]! + ((x - t[i]!) / (t[i + 1]! - t[i]!)) * (d[i + 1]! - d[i]!) : d[i]!
      if ((d[j]! - ds) / T <= MAX_SPEED) best = Math.max(best, d[j]! - ds)
    }
  }
  return best > 0 ? best : null
}

const med = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : null }

/** Steady 5-minute blocks after warm-up: even pace over five 1-minute parts, HR within 8 bpm, flat. Returns one (hr, speed) pair per block. */
export function steadyBlocks(s: S): { hr: number; v: number }[] {
  const n = s.t.length, bad = [0]
  for (let i = 0; i < n; i++) {
    const dt = i && s.t[i] != null && s.t[i - 1] != null ? s.t[i]! - s.t[i - 1]! : 0
    const dd = i && s.dist[i] != null && s.dist[i - 1] != null ? s.dist[i]! - s.dist[i - 1]! : -1
    bad.push(bad[i] + (i && (dt !== 1 || dd < 0 || dd > MAX_STEP || s.hr[i] == null) ? 1 : 0))
  }
  const out: { hr: number; v: number }[] = []
  for (let i = 0; i + BLOCK <= n;) {
    const ok = s.t[i]! >= SKIP_S && s.t[i + BLOCK - 1]! - s.t[i]! === BLOCK - 1 && s.hr[i] != null && bad[i + BLOCK] - bad[i + 1] === 0
    if (!ok) { i += s.t[i]! >= SKIP_S ? 30 : 60; continue }
    const part = (k: number) => { const a = i + k * 60, b = a + 59; return { v: (s.dist[b]! - s.dist[a]!) / 59, hr: s.hr.slice(a, b + 1).reduce((x: number, y) => x + y!, 0) / 60 } }
    const ps = [0, 1, 2, 3, 4].map(part), v = (s.dist[i + BLOCK - 1]! - s.dist[i]!) / (BLOCK - 1), hr = ps.reduce((x, p) => x + p.hr, 0) / 5
    const vs = ps.map((p) => p.v), hs = ps.map((p) => p.hr)
    const dz = s.alt[i] != null && s.alt[i + BLOCK - 1] != null ? Math.abs(s.alt[i + BLOCK - 1]! - s.alt[i]!) / ((v * (BLOCK - 1)) || 1) : 0
    if (v >= 2.2 && v <= 5.5 && (Math.max(...vs) - Math.min(...vs)) / v < 0.1 && Math.max(...hs) - Math.min(...hs) <= 8 && dz < 0.02) out.push({ hr, v })
    i += BLOCK
  }
  return out
}

/** Everything the records stage stores for one run: label -> [value, n]. */
export function runEfforts(s: S): Record<string, [number, number | null]> {
  const o: Record<string, [number, number | null]> = {}
  for (const [l, D] of DISTANCES) { const v = bestTime(s.t, s.dist, D); if (v != null) o[l] = [v, null] }
  for (const T of DURATIONS) { const v = bestDistance(s.t, s.dist, T); if (v != null) o[`t${T}`] = [v, null] }
  const b = steadyBlocks(s)
  if (b.length) { o.ss_hr = [med(b.map((x) => x.hr))!, b.length]; o.ss_v = [med(b.map((x) => x.v))!, b.length] }
  return o
}

// ---- aggregation over runs ----
export type Row = { id: number; label: string; value: number; n: number | null; date: string }
export type Prof = { rest: number; max: number }
const lowerIsBetter = (l: string) => !l.startsWith('p') && !l.startsWith('t') // time labels
export const BEST_LABELS = DISTANCES.map((d) => d[0]) as string[]

/** Rows to keep in best_efforts: all-time top 3 and every personal best when it was set. */
export function bestRows(rows: Row[]) {
  const out: { label: string; id: number; value: number; date: string; rank: number | null; is_pb: number }[] = []
  for (const l of BEST_LABELS) {
    const rs = rows.filter((r) => r.label === l).sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id), sign = lowerIsBetter(l) ? 1 : -1
    const keep = new Map<number, { rank: number | null; is_pb: number }>()
    let cur = Infinity
    for (const r of rs) if (sign * r.value < cur) { cur = sign * r.value; keep.set(r.id, { rank: null, is_pb: 1 }) }
    ;[...rs].sort((a, b) => sign * (a.value - b.value) || a.date.localeCompare(b.date)).slice(0, 3).forEach((r, i) => keep.set(r.id, { rank: i + 1, is_pb: keep.get(r.id)?.is_pb ?? 0 }))
    for (const r of rs) if (keep.has(r.id)) out.push({ label: l, id: r.id, value: r.value, date: r.date, ...keep.get(r.id)! })
  }
  return out
}

/** ACSM flat running equation with %HRR standing in for %VO2 reserve: VO2max = 3.5 + 0.2 * (m/min) / %HRR. Null outside 50 to 92 %HRR or 25 to 85. */
/** Oxygen cost of running at `v` m/min (Daniels and Gilbert). */
export const danielsCost = (v: number) => -4.6 + 0.182258 * v + 0.000104 * v * v
/** Fraction of VO2max a runner can hold for `t` minutes. */
const danielsFraction = (t: number) => 0.8 + 0.1894393 * Math.exp(-0.012778 * t) + 0.2989558 * Math.exp(-0.1932605 * t)
/** Race time in seconds for a given VO2max (VDOT), found by bisection. */
export function vdotTime(vdot: number, D: number): number {
  let lo = D / 600 / 60 * 60, hi = D / 60 * 60 // seconds: 10 m/s down to 1 m/s
  for (let i = 0; i < 60; i++) {
    const t = (lo + hi) / 2, m = t / 60
    if (danielsCost(D / m) > vdot * danielsFraction(m)) lo = t; else hi = t
  }
  return (lo + hi) / 2
}
/** VDOT (Daniels) that fits a race of distance D run in t seconds. */
export function vdotOf(t: number, D: number): number {
  const m = t / 60
  return (danielsCost(D / m) / danielsFraction(m))
}
export function vo2From(hr: number, v: number, p: Prof): number | null {
  const f = (hr - p.rest) / (p.max - p.rest)
  if (!(f >= 0.5 && f <= 0.92)) return null
  const x = 3.5 + (0.2 * v * 60) / f
  return x >= 25 && x <= 85 ? x : null
}

/** Least squares D = CS * T + D'. */
export function criticalSpeed(pts: [number, number][]) {
  const n = pts.length
  if (n < 3) return { ok: false as const, reason: 'few', n }
  const mt = pts.reduce((a, p) => a + p[0], 0) / n, md = pts.reduce((a, p) => a + p[1], 0) / n
  const sxx = pts.reduce((a, p) => a + (p[0] - mt) ** 2, 0), sxy = pts.reduce((a, p) => a + (p[0] - mt) * (p[1] - md), 0), syy = pts.reduce((a, p) => a + (p[1] - md) ** 2, 0)
  const cs = sxy / sxx, dp = md - cs * mt, r2 = syy ? (sxy * sxy) / (sxx * syy) : 0
  const ok = r2 >= 0.98 && cs >= 1.5 && cs <= 7 && dp >= 0 && dp <= 1000
  return { ok: ok as boolean, reason: ok ? null : 'poor', n, cs, dprime: dp, r2 }
}

export const riegel = (t1: number, d1: number, d2: number, k = 1.06) => t1 * (d2 / d1) ** k
export const TARGETS = [['5k', 5000], ['10k', 10000], ['hm', 21097.5], ['marathon', 42195]] as const

export type Source = { label: string; dist_m: number; time_s: number; date: string }
/** Point and range from the source closest in distance. Range is the exponent plus and minus `spread`. */
export function predictions(sources: Source[], today: string, k: number, cs: { cs: number; dprime: number } | null, spread = 0.03) {
  // fitness from the best 5 km, 10 km or half marathon effort; 1 km and mile efforts are too anaerobic for it
  const vs = sources.filter((x) => ['5k', '10k', 'hm'].includes(x.label)).map((x) => vdotOf(x.time_s, x.dist_m)), vdot = vs.length ? Math.max(...vs) : null
  return TARGETS.map(([label, D]) => {
    // best projection among recent efforts, from 0.4x to 4.5x the target distance. A recent easy long run must not drag the prediction down
    const src = sources.filter((x) => D / x.dist_m <= 4.5 && D / x.dist_m >= 0.4).sort((x, y) => riegel(x.time_s, x.dist_m, D, k) - riegel(y.time_s, y.dist_m, D, k))[0]
    const ends = src ? [k - spread, k + spread].map((e) => riegel(src.time_s, src.dist_m, D, e)) : [] // below the source distance a lower exponent is the slower end
    const vt = vdot ? vdotTime(vdot, D) : null, rt = src ? riegel(src.time_s, src.dist_m, D, k) : null
    // fitness model first (a hard effort is rarely run on the day), but never slower than what a real effort already shows
    const useV = vt != null && (rt == null || vt <= rt), cs_s = cs && D <= 10000 && D > cs.dprime ? (D - cs.dprime) / cs.cs : null
    if (useV) return { label, dist_m: D, point_s: vt, lo_s: vt! * (1 - spread), hi_s: vt! * (1 + spread), cs_s, model: 'vdot' as const, vdot, source: null, flags: [] as string[] }
    if (!src) return { label, dist_m: D, point_s: null, lo_s: null, hi_s: null, cs_s: null, model: null, vdot: null, source: null, flags: [] as string[] }
    const age = diffDays(src.date, today), flags = [...(age > 56 ? ['old'] : []), ...(D / src.dist_m > 3 ? ['short'] : [])]
    return { label, dist_m: D, point_s: rt, lo_s: Math.min(...ends), hi_s: Math.max(...ends), cs_s, model: 'riegel' as const, vdot: null, source: { ...src, age_days: age }, flags }
  })
}

/** The stored fitness blob: VO2 estimate with weekly history, CS fit and the best recent distance efforts. */
export function fitness(rows: Row[], prof: (date: string) => Prof | null, today: string) {
  const byId = new Map<number, Row[]>()
  for (const r of rows) (byId.get(r.id) ?? byId.set(r.id, []).get(r.id)!).push(r)
  const est: { date: string; v: number }[] = []
  for (const rs of byId.values()) {
    const hr = rs.find((r) => r.label === 'ss_hr'), v = rs.find((r) => r.label === 'ss_v'), p = hr && prof(hr.date)
    const x = hr && v && p && vo2From(hr.value, v.value, p)
    if (x) est.push({ date: hr.date, v: x })
  }
  const win = (to: string) => { const e = est.filter((x) => x.date <= to && x.date >= addDays(to, -27)); return { value: e.length >= 3 ? med(e.map((x) => x.v)) : null, n: e.length } }
  const cur = win(today), first = weekStart(today)
  const history = Array.from({ length: 26 }, (_, i) => { const w = addDays(first, -7 * (25 - i)), x = win(addDays(w, 6) > today ? today : addDays(w, 6)); return { week_start: w, ...x } })
  const best = (l: string, since: string) => rows.filter((r) => r.label === l && r.date >= since).sort((a, b) => (lowerIsBetter(l) ? a.value - b.value : b.value - a.value))[0]
  const pts = DURATIONS.flatMap((T) => { const b = best(`t${T}`, addDays(today, -89)); return b ? [[T, b.value] as [number, number]] : [] })
  const sources = DISTANCES.flatMap(([l, D]) => { const b = best(l, addDays(today, -179)); return b ? [{ label: l, dist_m: D, time_s: b.value, date: b.date }] : [] })
  return { today, vo2: { ...cur, from: addDays(today, -27), to: today, history }, cs: { ...criticalSpeed(pts), from: addDays(today, -89), to: today, points: pts }, sources }
}
