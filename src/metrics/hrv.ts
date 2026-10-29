import { mean, sd } from './dates.js'

export type Series = (number | null)[]
const win = (xs: Series, a: number, b: number) => xs.slice(Math.max(0, a), Math.max(0, b + 1)).filter((x): x is number => x != null)
const Z = (v: number, xs: number[]) => (xs.length ? (v - mean(xs)) / sd(xs) : NaN)

export type Divergence = 'strain' | 'hrv_dip' | 'rhr_rise' | 'recovered' | 'hrv_high' | 'normal'
export function divergence(zh: number | null, zr: number | null): Divergence | null {
  if (zh == null || zr == null) return null
  if (zh <= -1 && zr >= 1) return 'strain'
  if (zh <= -1) return 'hrv_dip'
  if (zr >= 1 && Math.abs(zh) < 1) return 'rhr_rise'
  if (zh >= 1 && zr <= -1) return 'recovered'
  if (zh >= 1 && Math.abs(zr) < 1) return 'hrv_high'
  return 'normal'
}

const pos = (m7: number, xs30: number[]): 'low' | 'in' | 'high' => { const m = mean(xs30), s = sd(xs30); return m7 < m - s ? 'low' : m7 > m + s ? 'high' : 'in' }

/**
 * HRV and resting-HR state for day i. hrv is raw nightly ms, rhr is bpm, both aligned by day.
 * Baseline = previous 60 days excluding day i (needs 21), 7-day mean needs 4, normal range display needs 30.
 */
export function hrvDay(hrv: Series, rhr: Series, i: number) {
  const ln = hrv.map((x) => (x && x > 0 ? Math.log(x) : null))
  const base = win(ln, i - 60, i - 1), l7 = win(ln, i - 6, i), l30 = win(ln, i - 29, i)
  const hOk = base.length >= 21 && l7.length >= 4
  const m = mean(base), s = sd(base)
  const z_hrv = hOk ? (mean(l7) - m) / s : null
  const lastv = ln[i]
  const z_last = base.length >= 21 && lastv != null ? (lastv - m) / s : null
  const r7 = win(rhr, i - 6, i), rb = win(rhr, i - 60, i - 1), r30 = win(rhr, i - 29, i)
  const z_rhr = rb.length >= 21 && r7.length >= 4 ? Z(mean(r7), rb) : null
  const hv = l7.length >= 4 && l30.length >= 15 ? pos(mean(l7), l30) : null
  const rv = r7.length >= 4 && r30.length >= 15 ? pos(mean(r7), r30) : null
  const bal = hv || rv ? (hv ?? 'in') === 'in' && (rv ?? 'in') === 'in' : null
  return {
    n_base: base.length, n7: l7.length, range_ok: base.length >= 30,
    last: hrv[i] ?? null, h7: l7.length >= 4 ? Math.exp(mean(l7)) : null,
    base_mean: base.length >= 21 ? Math.exp(m) : null, low: base.length >= 21 ? Math.exp(m - s) : null, high: base.length >= 21 ? Math.exp(m + s) : null,
    z_hrv, z_last, status: z_hrv == null ? null : z_hrv < -1 ? 'below' : z_hrv > 1 ? 'above' : 'in_range',
    rhr7: r7.length >= 4 ? mean(r7) : null, z_rhr, n_rhr7: r7.length,
    divergence: divergence(z_hrv, z_rhr),
    balance: { hrv: hv, rhr: rv, balanced: bal },
  }
}

/** Consecutive balanced days ending at each index. Unknown or unbalanced days reset to 0. */
export function streaks(flags: (boolean | null)[]) {
  let n = 0
  return flags.map((f) => (n = f ? n + 1 : 0))
}
