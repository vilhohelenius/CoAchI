// Read-only metric endpoints. Everything heavy is precomputed by `sync/run.ts recompute`, so these only read and reshape.
import type { Hono } from 'hono'
import type { DB, Env } from './index.js'
import { addDays, diffDays, weekStart } from '../metrics/dates.js'
import { sportOf } from '../metrics/load.js'
import { composition } from '../metrics/sleep.js'
import { BEST_LABELS, predictions } from '../metrics/records.js'

type App = Hono<{ Bindings: Env }>
const q = async <T = Record<string, unknown>>(db: DB, sql: string, ...b: unknown[]) => (await db.prepare(sql).bind(...b).all<T>()).results
type M = { date: string; key: string; value: number | null; json: string | null }
const pj = (m: M) => (m.json ? JSON.parse(m.json) : m.value)
const byKey = (rows: M[]) => Object.fromEntries(rows.map((r) => [r.key, pj(r)]))
const int = (v: string | undefined, d: number, max: number) => Math.min(max, Math.max(1, Math.floor(Number(v)) || d))

// Same classes as sportOf(). Fixed strings only, never user input.
const SPORT_SQL: Record<string, string> = { run: "type LIKE '%running%'", bike: "(type LIKE '%cycling%' OR type LIKE '%biking%')", ski: "type LIKE '%ski%'", strength: "type LIKE '%strength%'" }
const sportWhere = (s: string | undefined) => (s && SPORT_SQL[s] ? ` AND ${SPORT_SQL[s]}` : '')
const LIST_COLS = 'id, start_local, type, name, distance_m, duration_s, elev_gain_m, avg_hr, load, fit_status'
const km1 = (m: number) => Math.round(m / 100) / 10

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
    const ws = weekStart(l.date), byDay = Object.fromEntries((await q<any>(db, `SELECT substr(start_local,1,10) d, SUM(distance_m) m, SUM(duration_s) s FROM activities WHERE start_local >= ? GROUP BY d`, ws)).map((r) => [r.d, r]))
    const days = Array.from({ length: 7 }, (_, i) => { const d = addDays(ws, i), r = byDay[d]; return { date: d, km: r ? Math.round(r.m / 100) / 10 : 0, active_min: r ? Math.round(r.s / 60) : 0 } })
    return c.json({
      as_of: asOf(), data_date: l.date,
      status: { label: l.status, reason: m.status?.reason ?? null, ctl: l.ctl, atl: l.atl, tsb: l.tsb, acwr: l.acwr, ramp7: l.ramp7, warming_up: !!l.warming_up },
      readiness: m.readiness == null ? null : { score: rows.find((r) => r.key === 'readiness')!.value, ...m.readiness },
      last_activity: act ?? null, sleep: sleep ?? null,
      tiles: { steps: day?.steps ?? null, step_goal: day?.step_goal ?? null, rhr: day?.rhr ?? null, stress_avg: day?.stress_avg ?? null, body_battery_max: day?.bb_max ?? null,
        hrv_last_night: hrv?.last_night_avg ?? null, hrv_garmin_status: hrv?.status ?? null, hrv: m.hrv ?? null, recovery: m.recovery ?? null, sleep_stats: m.sleep ?? null },
      this_week: { start: ws, ...wk, days }, goals: m.goals ?? null,
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

  // Weekly mean of each per-run average, runs that have the metric only, with how many runs (n) fed it. One GROUP BY.
  const DYN: [string, string][] = [['stride_m', 'avg_stride_m'], ['vert_osc_mm', 'avg_vert_osc_mm'], ['vert_ratio', 'avg_vert_ratio'], ['gct_ms', 'avg_gct_ms'], ['gct_balance', 'avg_gct_balance'], ['cadence', 'avg_cadence'], ['power', 'avg_power']]
  app.get('/api/dynamics', async (c) => {
    const weeks = int(c.req.query('weeks'), 26, 260), first = addDays(weekStart(asOf().slice(0, 10)), -7 * (weeks - 1))
    const cols = DYN.map(([k, col]) => `AVG(NULLIF(${col},0)) ${k}, COUNT(NULLIF(${col},0)) n_${k}`).join(', ')
    const rows = await q<any>(c.env.DB, `SELECT date(substr(start_local,1,10),'weekday 0','-6 days') w, ${cols} FROM activities WHERE type LIKE '%running%' AND start_local >= ? GROUP BY w`, first)
    const m = Object.fromEntries(rows.map((r) => [r.w, r]))
    const out = Array.from({ length: weeks }, (_, i) => {
      const w = addDays(first, 7 * i), r = m[w]
      return { week_start: w, ...Object.fromEntries(DYN.map(([k]) => [k, r?.[`n_${k}`] ? { avg: Math.round(r[k] * 100) / 100, n: r[`n_${k}`] } : null])) }
    })
    return c.json({ as_of: asOf(), weeks: out })
  })

  app.get('/api/goals', async (c) => {
    const [g] = await q<M>(c.env.DB, `SELECT * FROM metric_daily WHERE key='goals' ORDER BY date DESC LIMIT 1`)
    const defs = await q(c.env.DB, `SELECT id, kind, title, target_value, target_max, unit, target_date, status FROM goals ORDER BY id`)
    return c.json({ as_of: asOf(), data_date: g?.date ?? null, goals: defs, progress: g ? pj(g) : null })
  })

  // ---- mileage: one GROUP BY each, no per-activity loops ----
  app.get('/api/mileage', async (c) => {
    const by = c.req.query('by') === 'month' ? 'month' : c.req.query('by') === 'year' ? 'year' : 'week', sp = c.req.query('sport')
    const today = asOf().slice(0, 10), n = by === 'week' ? 52 : by === 'month' ? 24 : 0
    const key = by === 'week' ? "date(substr(start_local,1,10),'weekday 0','-6 days')" : by === 'month' ? 'substr(start_local,1,7)' : 'substr(start_local,1,4)'
    const cur = by === 'week' ? weekStart(today) : by === 'month' ? today.slice(0, 7) : today.slice(0, 4)
    const step = (k: string, i: number) => (by === 'week' ? addDays(k, 7 * i) : by === 'month' ? new Date(Date.UTC(+k.slice(0, 4), +k.slice(5) - 1 + i, 1)).toISOString().slice(0, 7) : String(+k + i))
    let first = n ? step(cur, -(n - 1)) : ''
    if (!n) first = (await q<any>(c.env.DB, `SELECT MIN(substr(start_local,1,4)) y FROM activities WHERE 1=1${sportWhere(sp)}`))[0]?.y ?? cur
    const lo = by === 'week' ? first : by === 'month' ? `${first}-01` : `${first}-01-01`
    const rows = await q<any>(c.env.DB, `SELECT ${key} k, SUM(distance_m) m, SUM(duration_s) s, SUM(elev_gain_m) e, COUNT(*) n FROM activities WHERE start_local >= ?${sportWhere(sp)} GROUP BY k`, lo)
    const m = Object.fromEntries(rows.map((r) => [r.k, r]))
    const count = n || +cur - +first + 1
    const periods = Array.from({ length: count }, (_, i) => { const k = step(first, i), r = m[k]; return { key: k, km: r ? km1(r.m ?? 0) : 0, hours: r ? Math.round((r.s ?? 0) / 360) / 10 : 0, elev_m: r ? Math.round(r.e ?? 0) : 0, sessions: r?.n ?? 0 } })
    return c.json({ as_of: asOf(), by, sport: sp ?? 'all', periods })
  })

  app.get('/api/mileage/compare', async (c) => {
    const sp = c.req.query('sport'), today = asOf().slice(0, 10)
    const days = await q<{ d: string; m: number }>(c.env.DB, `SELECT substr(start_local,1,10) d, SUM(distance_m) m FROM activities WHERE distance_m > 0${sportWhere(sp)} GROUP BY d ORDER BY d`)
    const [g] = sp === 'run' ? await q<any>(c.env.DB, `SELECT target_value v FROM goals WHERE kind='distance' AND status='active' LIMIT 1`) : []
    if (!days.length) return c.json({ as_of: asOf(), sport: sp ?? 'all', today, goal_km: g?.v ?? null, years: [], rolling: { dates: [], km30: [], km365: [] } })
    const years: Record<string, { year: number; total_km: number; points: [number, number][] }> = {}, origin = days[0].d
    const total = diffDays(origin, today) + 1, pre = new Float64Array(total + 1) // pre[i] = metres before day i
    let cum = 0, y = ''
    for (const { d, m } of days) {
      if (d.slice(0, 4) !== y) { y = d.slice(0, 4); cum = 0; years[y] = { year: +y, total_km: 0, points: [] } }
      cum += m
      years[y].total_km = km1(cum); years[y].points.push([diffDays(`${y}-01-01`, d) + 1, km1(cum)])
      pre[Math.min(total, diffDays(origin, d) + 1)] += m
    }
    for (let i = 1; i <= total; i++) pre[i] += pre[i - 1]
    const rolling = { dates: [] as string[], km30: [] as (number | null)[], km365: [] as (number | null)[] }
    const win = (end: number, w: number) => (end - w + 1 < 0 ? null : km1(pre[end + 1] - pre[end + 1 - w]))
    for (let i = (total - 1) % 7; i < total; i += 7) { rolling.dates.push(addDays(origin, i)); rolling.km30.push(win(i, 30)); rolling.km365.push(win(i, 365)) }
    return c.json({ as_of: asOf(), sport: sp ?? 'all', today, goal_km: g?.v ?? null, years: Object.values(years), rolling })
  })

  // ---- records and fitness estimates: stored by the sync `records` stage. Empty with available:false until migration 0004 and the stage have run. ----
  app.get('/api/records', async (c) => {
    try {
      const rows = await q<{ label: string; activity_id: number; value: number; date: string; rank: number | null; is_pb: number }>(c.env.DB, 'SELECT label, activity_id, value, date, rank, is_pb FROM best_efforts ORDER BY date, activity_id')
      const [n] = await q<{ n: number }>(c.env.DB, `SELECT COUNT(*) n FROM activity_efforts WHERE label='done'`)
      const records = BEST_LABELS.filter((l) => !l.startsWith('p') || rows.some((r) => r.label === l)).map((label) => {
        const mine = rows.filter((r) => r.label === label), lo = !label.startsWith('p')
        return { label, unit: lo ? 's' : 'W',
          best: mine.filter((r) => r.rank).sort((a, b) => a.rank! - b.rank!).map((r) => ({ rank: r.rank, value: r.value, date: r.date, activity_id: r.activity_id })),
          timeline: mine.filter((r) => r.is_pb).map((r) => ({ date: r.date, value: r.value, activity_id: r.activity_id })) }
      })
      return c.json({ as_of: asOf(), available: n.n > 0, n_runs: n.n, records })
    } catch { return c.json({ as_of: asOf(), available: false, n_runs: 0, records: [] }) }
  })

  app.get('/api/fitness-estimates', async (c) => {
    const k = Math.min(1.12, Math.max(1.02, Number(c.req.query('riegel')) || 1.06)), today = asOf().slice(0, 10)
    try {
      const [m] = await q<M>(c.env.DB, `SELECT * FROM metric_daily WHERE key='fitness' ORDER BY date DESC LIMIT 1`)
      if (!m) return c.json({ as_of: asOf(), available: false, riegel: k })
      const f = pj(m), cs = f.cs.ok ? f.cs : null
      return c.json({ as_of: asOf(), available: true, data_date: m.date, riegel: k, spread: 0.03, vo2: f.vo2, cs: f.cs,
        predictions: predictions(f.sources, today, k, cs), sources: f.sources })
    } catch { return c.json({ as_of: asOf(), available: false, riegel: k }) }
  })

  // ---- activities ----
  app.get('/api/activities', async (c) => {
    const limit = int(c.req.query('limit'), 30, 100), before = c.req.query('before'), sp = c.req.query('sport')
    const rows = await q<any>(c.env.DB, `SELECT ${LIST_COLS} FROM activities WHERE start_local < ?${sportWhere(sp)} ORDER BY start_local DESC LIMIT ?`, before ?? '9999', limit + 1)
    const page = rows.slice(0, limit).map((r) => ({ ...r, sport: sportOf(r.type ?? '') }))
    return c.json({ as_of: asOf(), activities: page, next_before: rows.length > limit ? page[limit - 1].start_local : null })
  })

  app.get('/api/activities/:id', async (c) => {
    const id = Number(c.req.param('id')), db = c.env.DB
    const [a] = Number.isInteger(id) ? await q<any>(db, `SELECT ${LIST_COLS}, moving_s, max_hr, avg_cadence, avg_power, norm_power, aero_te, anaero_te, load_source, rpe, feel, hr_z1_s, hr_z2_s, hr_z3_s, hr_z4_s, hr_z5_s, temp_c, avg_stride_m, avg_vert_osc_mm, avg_vert_ratio, avg_gct_ms, avg_gct_balance FROM activities WHERE id=?`, id) : []
    if (!a) return c.json({ error: 'not found', code: 'NOT_FOUND' }, 404)
    const laps = await q(db, 'SELECT lap_idx, step_type, set_no, rep_no, duration_s, distance_m, avg_speed_mps, avg_hr, max_hr, avg_power, avg_cadence, ascent_m, avg_stride_m, avg_vert_osc_mm, avg_vert_ratio, avg_gct_ms, avg_gct_balance FROM activity_steps WHERE activity_id=? ORDER BY lap_idx', id)
    // Charts, route, splits, EF and decoupling are precomputed by the sync fit stage into detail/{id}.json
    const detail = a.fit_status === 'ok' ? await c.env.FIT?.get(`detail/${id}.json`).then((o) => o?.json() ?? null).catch(() => null) ?? null : null
    return c.json({ as_of: asOf(), activity: { ...a, sport: sportOf(a.type ?? '') }, laps, detail })
  })
}
