// Vetted correlation report (docs/metrics.md section 18, reduced): a fixed list of pairs, never searched. Pearson r with a Fisher-z 95% CI on an
// effective n that shrinks for autocorrelated series, and a minimum of 30 paired days. ponytail: no 28-day detrending, no Spearman, no FDR, no
// split-half check; with 5 pre-set pairs the multiple-testing risk is small and stated in the output. Add them when the pair list grows.
import { addDays, r2 } from './dates.js'

export type Pt = { date: string; v: number }
export const MIN_N = 30
/** x on day d against y on day d+lag. Keys are series names from get_series. */
export const PAIRS: { x: string; y: string; lag: number; label: string }[] = [
  { x: 'sleep_total_s', y: 'hrv', lag: 0, label: 'Sleep duration vs the same night\'s HRV' },
  { x: 'sleep_total_s', y: 'rhr', lag: 0, label: 'Sleep duration vs resting HR the same day' },
  { x: 'load', y: 'hrv', lag: 1, label: 'Training load vs next day\'s HRV' },
  { x: 'load', y: 'rhr', lag: 1, label: 'Training load vs next day\'s resting HR' },
  { x: 'hrv', y: 'readiness', lag: 1, label: 'HRV vs next day\'s readiness score' },
]

export function pearson(a: number[], b: number[]) {
  const n = a.length, ma = a.reduce((s, x) => s + x, 0) / n, mb = b.reduce((s, x) => s + x, 0) / n
  let sab = 0, saa = 0, sbb = 0
  for (let i = 0; i < n; i++) { sab += (a[i] - ma) * (b[i] - mb); saa += (a[i] - ma) ** 2; sbb += (b[i] - mb) ** 2 }
  return saa > 0 && sbb > 0 ? sab / Math.sqrt(saa * sbb) : NaN
}

export function correlate(x: Pt[], y: Pt[], lag: number) {
  const ym = new Map(y.map((p) => [p.date, p.v])), xs: number[] = [], ys: number[] = []
  for (const p of x) { const v = ym.get(addDays(p.date, lag)); if (v != null) { xs.push(p.v); ys.push(v) } }
  const n = xs.length
  if (n < MIN_N) return { n, status: 'not_enough_data' as const, need: MIN_N }
  const r = pearson(xs, ys)
  if (!Number.isFinite(r)) return { n, status: 'not_enough_data' as const, need: MIN_N }
  const rx = pearson(xs.slice(0, -1), xs.slice(1)), ry = pearson(ys.slice(0, -1), ys.slice(1)), p = (Number.isFinite(rx) ? rx : 0) * (Number.isFinite(ry) ? ry : 0)
  const n_eff = Math.max(4, Math.min(n, (n * (1 - p)) / (1 + p))), z = Math.atanh(Math.min(0.9999, Math.abs(r))) * Math.sign(r), h = 1.96 / Math.sqrt(n_eff - 3)
  const ci: [number, number] = [Math.tanh(z - h), Math.tanh(z + h)], a = Math.abs(r)
  const status = ci[0] <= 0 && ci[1] >= 0 ? 'no_clear_link' : a < 0.2 ? 'no_clear_link' : a < 0.4 ? 'weak' : a < 0.6 ? 'moderate' : 'strong_double_check'
  return { n, n_eff: r2(n_eff, 1), r: r2(r), ci: ci.map((c) => r2(c)) as [number, number], status }
}

/** The whole report from already-loaded series. `only` narrows to pairs that involve the given keys. */
export function report(series: Record<string, Pt[]>, only: string[] = []) {
  const pairs = PAIRS.filter((p) => !only.length || only.every((k) => k === p.x || k === p.y)).map((p) => ({ ...p, ...correlate(series[p.x] ?? [], series[p.y] ?? [], p.lag) }))
  return { pairs, min_n: MIN_N, tested: PAIRS.length, caveat: 'Association, not proof of cause. Fixed pairs, no detrending; a CI that includes 0 means no clear link.' }
}
