import { addDays, dow, diffDays, mean, weekStart } from './dates.js'

export type GoalInput = {
  today: string
  year_km: number; band_lo: number; band_hi: number; steps_goal: number
  run_m: Record<string, number>   // running-only distance per date
  steps: Record<string, number>   // steps per date
}
export type Pace = 'ahead' | 'on_pace' | 'behind'
const pace = (actual: number, expected: number, tol: number): Pace => (actual > expected + tol ? 'ahead' : actual < expected - tol ? 'behind' : 'on_pace')
const km = (m: Record<string, number>, a: string, b: string) => { let s = 0; for (let d = a; d <= b; d = addDays(d, 1)) s += m[d] ?? 0; return s / 1000 }
const r1 = (x: number) => Math.round(x * 10) / 10

/** Soft progress on the three goals. Statuses are pace words, never pass or fail. */
export function goals(g: GoalInput) {
  const { today } = g, y = today.slice(0, 4)
  // yearly distance
  const doy = diffDays(`${y}-01-01`, today) + 1, diy = diffDays(`${y}-01-01`, `${+y + 1}-01-01`)
  const ytd = km(g.run_m, `${y}-01-01`, today), expected = (g.year_km * doy) / diy
  const wk8 = km(g.run_m, addDays(today, -55), today) / 8
  const year = { target_km: g.year_km, ytd_km: r1(ytd), expected_km: r1(expected), diff_km: r1(ytd - expected), status: pace(ytd, expected, g.year_km * 0.02),
    projected_km: r1(ytd + (wk8 * (diy - doy)) / 7), avg_week_km_8w: r1(wk8) }
  // slightly behind the straight line but on course at the recent weekly average still counts as on pace
  if (year.status === 'behind' && year.projected_km >= g.year_km && ytd >= expected * 0.95) year.status = 'on_pace'
  // weekly running band, Monday start
  const ws = weekStart(today), frac = (dow(today) + 1) / 7, cur = km(g.run_m, ws, today)
  const weeks = [1, 2, 3, 4].map((i) => {
    const s = addDays(ws, -7 * i), v = km(g.run_m, s, addDays(s, 6))
    return { week_start: s, km: r1(v), status: v < g.band_lo ? 'below_band' : v > g.band_hi ? 'above_band' : 'in_band' }
  })
  const week = { band_lo: g.band_lo, band_hi: g.band_hi, week_start: ws, km: r1(cur),
    status: cur > g.band_hi * frac ? 'ahead' : cur < g.band_lo * frac ? 'behind' : 'on_pace', previous: weeks }
  // steps: calendar-day streak. Today still counts as pending until it reaches the goal.
  const hit = (d: string) => (g.steps[d] ?? 0) >= g.steps_goal
  let s = 0
  for (let d = hit(today) ? today : addDays(today, -1); hit(d); d = addDays(d, -1)) s++
  const last = (n: number) => Array.from({ length: n }, (_, i) => g.steps[addDays(today, -i)]).filter((v): v is number => v != null)
  const a7 = last(7), a30 = last(30)
  const avg7 = a7.length ? mean(a7) : null
  const steps = { goal: g.steps_goal, today: g.steps[today] ?? null, streak_days: s, today_pending: !hit(today),
    hit_30d: Array.from({ length: 30 }, (_, i) => addDays(today, -i)).filter(hit).length, avg_7d: avg7 && Math.round(avg7), avg_30d: a30.length ? Math.round(mean(a30)) : null,
    status: avg7 == null ? null : avg7 >= g.steps_goal ? 'ahead' : avg7 >= g.steps_goal * 0.8 ? 'on_pace' : 'behind' }
  return { year, week, steps }
}
