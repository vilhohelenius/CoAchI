import { addDays, dow, mean, sd } from './dates.js'

export type Night = { date: string; start_ts: number | null; end_ts: number | null; total_s: number | null; deep_s: number | null; light_s: number | null; rem_s: number | null; awake_s: number | null; score: number | null }
const within = (ns: Night[], end: string, days: number) => ns.filter((n) => n.date <= end && n.date > addDays(end, -days))

// Midpoint as minutes of the UTC clock day, unwrapped to stay within 12 h of the first value so midnight does not split a night.
// ponytail: UTC clock, so a timezone change shows up as one big jump. Fine for one home timezone.
function mids(ns: Night[]) {
  const m = ns.filter((n) => n.start_ts && n.end_ts).map((n) => ({ date: n.date, m: (((n.start_ts! + n.end_ts!) / 2) / 6e4) % 1440 }))
  m.forEach((x) => { while (x.m - m[0].m > 720) x.m -= 1440; while (m[0].m - x.m > 720) x.m += 1440 })
  return m
}

/** Bedtime regularity over the last 7 nights (needs 4) and weekday vs weekend gap over 28 nights (needs 2 each). */
export function consistency(ns: Night[], end: string) {
  const w = mids(within(ns, end, 7)), long = mids(within(ns, end, 28))
  const we = long.filter((x) => dow(x.date) >= 5).map((x) => x.m), wd = long.filter((x) => dow(x.date) < 5).map((x) => x.m)
  return {
    sd_min: w.length >= 4 ? sd(w.map((x) => x.m)) : null, n: w.length,
    social_jetlag_min: we.length >= 2 && wd.length >= 2 ? mean(we) - mean(wd) : null,
  }
}

/** Hours short of need over 14 days. Surplus nights repay at 50%. Needs 7 recorded nights. */
export function debt(ns: Night[], end: string, needH = 8) {
  const w = within(ns, end, 14).filter((n) => n.total_s)
  if (w.length < 7) return { debt_h: null, n: w.length, need_h: needH }
  const d = w.reduce((s, n) => { const x = needH - n.total_s! / 3600; return s + (x > 0 ? x : x * 0.5) }, 0)
  return { debt_h: Math.max(0, d), n: w.length, need_h: needH }
}

/** Average minutes and shares of each stage over the last 30 nights that have stage data. */
export function composition(ns: Night[], end: string) {
  const w = within(ns, end, 30).filter((n) => n.deep_s != null && n.rem_s != null && n.light_s != null)
  if (!w.length) return { n: 0, min: null, share: null }
  const a = (k: 'deep_s' | 'rem_s' | 'light_s' | 'awake_s') => mean(w.map((n) => (n[k] ?? 0) / 60))
  const min = { deep: a('deep_s'), rem: a('rem_s'), light: a('light_s'), awake: a('awake_s') }
  const t = min.deep + min.rem + min.light + min.awake
  return { n: w.length, min, share: { deep: min.deep / t, rem: min.rem / t, light: min.light / t, awake: min.awake / t } }
}
