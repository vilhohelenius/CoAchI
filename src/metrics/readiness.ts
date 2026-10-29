import { clamp } from './dates.js'

export type ReadinessInput = {
  hrv: { z7: number; z_last: number | null; n: number } | null
  rhr: { z: number; n: number } | null
  sleep: { total_s: number; score: number | null; need_h: number } | null
  debt: { debt_h: number; n: number } | null
  load: { tsb: number; acwr: number | null; days: number } | null
  bb_max: number | null
  injury?: boolean
}
export type Component = { key: string; label: string; weight: number; available: boolean; n: number; score: number | null; value: string | null }

/** Readiness v1: weighted sum of available components, weights renormalised. See docs/metrics.md section 6. */
export function readiness(x: ReadinessInput) {
  const f = (v: number) => v.toFixed(1)
  const hrvZ = x.hrv ? 0.6 * x.hrv.z7 + 0.4 * (x.hrv.z_last ?? x.hrv.z7) : 0
  const sl = x.sleep, dur = sl ? Math.min(100, (sl.total_s / 3600 / sl.need_h) * 100) : 0
  const loadOk = !!x.load && x.load.days >= 28
  const cs: Component[] = [
    { key: 'hrv', label: 'HRV vs your normal', weight: 30, available: !!x.hrv, n: x.hrv?.n ?? 0, score: x.hrv ? clamp(70 + 20 * hrvZ) : null, value: x.hrv ? `z ${f(hrvZ)}` : null },
    { key: 'rhr', label: 'Resting heart rate', weight: 15, available: !!x.rhr, n: x.rhr?.n ?? 0, score: x.rhr ? clamp(70 - 20 * x.rhr.z) : null, value: x.rhr ? `z ${f(x.rhr.z)}` : null },
    { key: 'sleep', label: 'Last night sleep', weight: 20, available: !!sl, n: sl ? 1 : 0,
      score: sl ? (sl.score == null ? dur : 0.5 * dur + 0.5 * sl.score) : null, value: sl ? `${f(sl.total_s / 3600)} h${sl.score == null ? '' : `, score ${sl.score}`}` : null },
    { key: 'sleep_debt', label: 'Sleep debt, 14 days', weight: 10, available: !!x.debt, n: x.debt?.n ?? 0, score: x.debt ? clamp(100 - 12 * x.debt.debt_h) : null, value: x.debt ? `${f(x.debt.debt_h)} h` : null },
    { key: 'load', label: 'Training form', weight: 20, available: loadOk, n: x.load?.days ?? 0,
      score: loadOk ? clamp(clamp(70 + 2.5 * x.load!.tsb) - ((x.load!.acwr ?? 0) > 1.5 ? 10 : 0)) : null, value: loadOk ? `TSB ${f(x.load!.tsb)}` : null },
    { key: 'body_battery', label: 'Body battery', weight: 5, available: x.bb_max != null, n: x.bb_max != null ? 1 : 0, score: x.bb_max, value: x.bb_max != null ? String(x.bb_max) : null },
  ]
  const av = cs.filter((c) => c.available)
  const tw = av.reduce((s, c) => s + c.weight, 0)
  let score = tw ? av.reduce((s, c) => s + c.weight * c.score!, 0) / tw : null
  const capped = !!x.injury && score != null && score > 50
  if (capped) score = 50
  const drivers = [...av].sort((a, b) => b.weight * Math.abs(b.score! - 70) - a.weight * Math.abs(a.score! - 70)).slice(0, 2).map((c) => c.key)
  const label = score == null ? null : score >= 80 ? 'high' : score >= 60 ? 'moderate' : score >= 40 ? 'low' : 'poor'
  return { score, label, confidence: av.length === 0 ? 'none' : av.length < 3 ? 'low' : 'ok', capped, n_components: av.length, drivers, components: cs }
}
