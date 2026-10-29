// Best efforts, critical speed, Riegel and a VO2 estimate. Pure functions, no I/O. Docs: metrics.md "Records and fitness estimates".
import { addDays, diffDays, weekStart } from './dates.js'

type N = number | null
export type S = { t: N[]; dist: N[]; pwr: N[]; hr: N[]; alt: N[] }

export const DISTANCES = [['1k', 1000], ['1mi', 1609.344], ['5k', 5000], ['10k', 10000], ['hm', 21097.5]] as const
export const DURATIONS = [180, 360, 720, 1200]   // seconds, for critical speed
export const POWERS = [60, 300, 1200]            // seconds
const MAX_GAP = 10     // s between records before a window is cut (pause, lost signal)
const MAX_STEP = 12    // m/s between two records, faster is a GPS jump
const MAX_SPEED = 9    // m/s over a whole effort, faster is not a runner
const SKIP_S = 480     // steady blocks start after the first 8 minutes (HR lag)
const BLOCK = 300

/** Index ranges [a, b] where time and distance are present, rising, gap-free and without jumps. */
export function segments(t: N[], d: N[]): [number, number][] {
  const out: [number, number][] = []
  let a = -1
  for (let i = 0; i < t.length; i++) {
    const ok = t[i] != null && d[i] != null
    const cut = !ok || (i > 0 && a >= 0 && (t[i - 1] == null || d[i - 1] == null || t[i]! - t[i - 1]! <= 0 || t[i]! - t[i - 1]! > MAX_GAP || d[i]! < d[i - 1]! || (d[i]! - d[i - 1]!) / (t[i]! - t[i - 1]!) > MAX_STEP))
    if (cut && a >= 0) { out.push([a, i - 1]); a = -1 }
    if (ok && a < 0) a = i
  }
  if (a >= 0) out.push([a, t.length - 1])
  return out.filter(([x, y]) => y > x)
}

/** Fastest time over exactly `D` metres, interpolated between records. Null when no continuous stretch is long enough. */
export function bestTime(t: N[], d: N[], D: number): number | null {
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
  return Number.isFinite(best) ? best : null
}

/** Furthest distance covered in exactly `T` seconds. */
export function bestDistance(t: N[], d: N[], T: number): number | null {
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

/** Best mean power over `T` seconds. Needs gap-free 1 Hz power samples. */
export function bestPower(t: N[], p: N[], T: number): number | null {
  const n = p.length, c = [0], bad = [0]
  for (let i = 0; i < n; i++) { c.push(c[i] + (p[i] ?? 0)); bad.push(bad[i] + (p[i] == null || t[i] == null || p[i]! > 2500 ? 1 : 0)) }
  let best = 0
  for (let i = 0; i + T <= n; i++)
    if (bad[i + T] === bad[i] && t[i + T - 1]! - t[i]! === T - 1) best = Math.max(best, (c[i + T] - c[i]) / T)
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
  for (const T of POWERS) { const v = bestPower(s.t, s.pwr, T); if (v != null) o[`p${T}`] = [v, null] }
  const b = steadyBlocks(s)
  if (b.length) { o.ss_hr = [med(b.map((x) => x.hr))!, b.length]; o.ss_v = [med(b.map((x) => x.v))!, b.length] }
  return o
}

// ---- aggregation over runs ----
export type Row = { id: number; label: string; value: number; n: number | null; date: string }
export type Prof = { rest: number; max: number }
const lowerIsBetter = (l: string) => !l.startsWith('p') && !l.startsWith('t') // time labels
export const BEST_LABELS = [...DISTANCES.map((d) => d[0]), ...POWERS.map((p) => `p${p}`)] as string[]

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
  return TARGETS.map(([label, D]) => {
    const src = [...sources].sort((a, b) => Math.abs(Math.log(D / a.dist_m)) - Math.abs(Math.log(D / b.dist_m)))[0]
    if (!src) return { label, dist_m: D, point_s: null, lo_s: null, hi_s: null, cs_s: null, source: null, flags: [] as string[] }
    const age = diffDays(src.date, today), flags = [...(age > 56 ? ['old'] : []), ...(D / src.dist_m > 4 ? ['short'] : [])]
    return { label, dist_m: D, point_s: riegel(src.time_s, src.dist_m, D, k), lo_s: riegel(src.time_s, src.dist_m, D, k - spread), hi_s: riegel(src.time_s, src.dist_m, D, k + spread),
      // CS holds for efforts of about 2 to 40 minutes, so it cross-checks 5 km and 10 km only
      cs_s: cs && D <= 10000 && D > cs.dprime ? (D - cs.dprime) / cs.cs : null, source: { ...src, age_days: age }, flags }
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
