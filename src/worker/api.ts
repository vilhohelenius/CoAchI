// Read-only metric endpoints. Everything heavy is precomputed by `sync/run.ts recompute`, so these only read and reshape.
import type { Hono } from 'hono'
import type { DB, Env } from './index.js'
import { addDays, weekStart } from '../metrics/dates.js'
import { composition } from '../metrics/sleep.js'

type App = Hono<{ Bindings: Env }>
const q = async <T = Record<string, unknown>>(db: DB, sql: string, ...b: unknown[]) => (await db.prepare(sql).bind(...b).all<T>()).results
type M = { date: string; key: string; value: number | null; json: string | null }
const pj = (m: M) => (m.json ? JSON.parse(m.json) : m.value)
const byKey = (rows: M[]) => Object.fromEntries(rows.map((r) => [r.key, pj(r)]))
const int = (v: string | undefined, d: number, max: number) => Math.min(max, Math.max(1, Math.floor(Number(v)) || d))

export function metricRoutes(app: App, now: () => number) {
  const asOf = () => new Date(now()).toISOString()

  app.get('/api/today', async (c) => {
    const db = c.env.DB
    const [l] = await q<any>(db, 'SELECT * FROM load_daily ORDER BY date DESC LIMIT 1')
    if (!l) return c.json({ as_of: asOf(), data_date: null })
    const rows = await q<M>(db, 'SELECT * FROM metric_daily WHERE date=?', l.date), m = byKey(rows)
    const [act] = await q(db, 'SELECT id, start_local, type, name, distance_m, duration_s, avg_hr, elev_gain_m, load, load_source, aero_te, rpe FROM activities ORDER BY start_local DESC LIMIT 1')
    const [sleep] = await q(db, 'SELECT date, total_s, deep_s, light_s, rem_s, awake_s, score, start_ts, end_ts FROM sleep ORDER BY date DESC LIMIT 1')
    const [day] = await q<any>(db, 'SELECT date, steps, step_goal, rhr, stress_avg, bb_max, bb_min FROM daily_summary ORDER BY date DESC LIMIT 1')
    const [hrv] = await q<any>(db, 'SELECT date, last_night_avg, status FROM hrv_daily WHERE last_night_avg IS NOT NULL ORDER BY date DESC LIMIT 1')
    const [wk] = await q(db, `SELECT COUNT(*) sessions, SUM(distance_m) distance_m, SUM(duration_s) duration_s, SUM(load) load,
      SUM(CASE WHEN type LIKE '%running%' THEN distance_m ELSE 0 END) run_distance_m FROM activities WHERE start_local >= ?`, weekStart(l.date))
    return c.json({
      as_of: asOf(), data_date: l.date,
      status: { label: l.status, ctl: l.ctl, atl: l.atl, tsb: l.tsb, acwr: l.acwr, ramp7: l.ramp7, warming_up: !!l.warming_up },
      readiness: m.readiness == null ? null : { score: rows.find((r) => r.key === 'readiness')!.value, ...m.readiness },
      last_activity: act ?? null, sleep: sleep ?? null,
      tiles: { steps: day?.steps ?? null, step_goal: day?.step_goal ?? null, rhr: day?.rhr ?? null, stress_avg: day?.stress_avg ?? null, body_battery_max: day?.bb_max ?? null,
        hrv_last_night: hrv?.last_night_avg ?? null, hrv_garmin_status: hrv?.status ?? null, hrv: m.hrv ?? null, recovery: m.recovery ?? null, sleep_stats: m.sleep ?? null },
      this_week: { start: weekStart(l.date), ...wk }, goals: m.goals ?? null,
    })
  })

  app.get('/api/load', async (c) => {
    const to = (await q<any>(c.env.DB, 'SELECT MAX(date) d FROM load_daily'))[0]?.d
    if (!to) return c.json({ as_of: asOf(), days: [] })
    const from = c.req.query('from') ?? addDays(to, 1 - int(c.req.query('days'), 180, 3000))
    const days = await q(c.env.DB, 'SELECT date, load, ctl, atl, tsb, tsb_end, acwr, ramp7, status, warming_up FROM load_daily WHERE date >= ? ORDER BY date', from)
    const sp = await q<M>(c.env.DB, `SELECT * FROM metric_daily WHERE key LIKE 'load.%' AND date >= ? ORDER BY date`, from)
    const per_sport: Record<string, unknown[]> = {}
    for (const r of sp) (per_sport[r.key.slice(5)] ??= []).push({ date: r.date, ...pj(r) })
    const [p] = await q<M>(c.env.DB, `SELECT * FROM metric_daily WHERE key='projection' ORDER BY date DESC LIMIT 1`)
    return c.json({ as_of: asOf(), days, per_sport, projection: p ? { date: p.date, ...pj(p) } : null, acwr_band: [0.8, 1.3] })
  })

  app.get('/api/recovery', async (c) => {
    const n = int(c.req.query('days'), 90, 400), db = c.env.DB
    const to = (await q<any>(db, 'SELECT MAX(date) d FROM load_daily'))[0]?.d
    if (!to) return c.json({ as_of: asOf(), days: [] })
    const from = addDays(to, -n + 1)
    const rows = await q<M>(db, `SELECT * FROM metric_daily WHERE key IN ('hrv','recovery','sleep','readiness') AND date >= ? ORDER BY date`, from)
    const days: Record<string, any> = {}
    for (const r of rows) (days[r.date] ??= { date: r.date })[r.key] = r.key === 'readiness' ? { score: r.value, ...pj({ ...r, value: null }) } : pj(r)
    const nights = await q<any>(db, 'SELECT date, start_ts, end_ts, total_s, deep_s, light_s, rem_s, awake_s, score FROM sleep WHERE date >= ? ORDER BY date', addDays(to, -29))
    const bb = await q(db, 'SELECT date, charged, drained, min_level, max_level FROM body_battery WHERE date >= ? ORDER BY date', from)
    const rhr = await q(db, 'SELECT date, rhr FROM daily_summary WHERE date >= ? AND rhr IS NOT NULL ORDER BY date', from)
    return c.json({ as_of: asOf(), days: Object.values(days), rhr, body_battery: bb, sleep_nights: nights, sleep_composition: composition(nights, to) })
  })

  app.get('/api/intensity', async (c) => {
    const weeks = int(c.req.query('weeks'), 8, 52), db = c.env.DB
    const to = (await q<any>(db, 'SELECT MAX(date) d FROM load_daily'))[0]?.d
    if (!to) return c.json({ as_of: asOf(), weeks: [] })
    const first = addDays(weekStart(to), -7 * (weeks - 1))
    const rows = await q<M>(db, `SELECT * FROM metric_daily WHERE key LIKE 'zsec.%' AND date >= ? ORDER BY date`, first)
    const wk: Record<string, Record<string, number[]>> = {}, w28: Record<string, number[]> = {}, since = addDays(to, -27)
    for (const r of rows) {
      const sport = r.key.slice(5), z: number[] = pj(r), w = weekStart(r.date)
      const a = ((wk[w] ??= {})[sport] ??= [0, 0, 0, 0, 0]); z.forEach((s, i) => { a[i] += s })
      if (r.date >= since) { const b = (w28[sport] ??= [0, 0, 0, 0, 0]); z.forEach((s, i) => { b[i] += s }) }
    }
    const share = (z: number[]) => { const t = z.reduce((s, x) => s + x, 0); return t ? { easy: (z[0] + z[1]) / t, mid: z[2] / t, hard: (z[3] + z[4]) / t, minutes: t / 60 } : null }
    const all = Object.values(w28).reduce((a, z) => a.map((x, i) => x + z[i]), [0, 0, 0, 0, 0])
    const outW = Array.from({ length: weeks }, (_, i) => { const w = addDays(first, 7 * i); return { week_start: w, minutes: Object.fromEntries(Object.entries(wk[w] ?? {}).map(([s, z]) => [s, z.map((x) => x / 60)])) } })
    return c.json({ as_of: asOf(), weeks: outW, share_28d: { all: share(all), by_sport: Object.fromEntries(Object.entries(w28).map(([s, z]) => [s, share(z)])), easy_target: [0.75, 0.85] } })
  })

  app.get('/api/goals', async (c) => {
    const [g] = await q<M>(c.env.DB, `SELECT * FROM metric_daily WHERE key='goals' ORDER BY date DESC LIMIT 1`)
    const defs = await q(c.env.DB, `SELECT id, kind, title, target_value, target_max, unit, target_date, status FROM goals ORDER BY id`)
    return c.json({ as_of: asOf(), data_date: g?.date ?? null, goals: defs, progress: g ? pj(g) : null })
  })
}
