// Read queries shared by the HTTP API and the coach tools (src/tools.ts). Pure reads over D1; everything heavy is precomputed by the sync recompute.
import type { DB } from './worker/index.js'
import { addDays, diffDays, weekStart } from './metrics/dates.js'
import { sportOf } from './metrics/load.js'
import { BEST_LABELS, predictions } from './metrics/records.js'

export const q = async <T = Record<string, unknown>>(db: DB, sql: string, ...b: unknown[]) => (await db.prepare(sql).bind(...b).all<T>()).results
export type M = { date: string; key: string; value: number | null; json: string | null }
export const pj = (m: M) => (m.json ? JSON.parse(m.json) : m.value)
export const byKey = (rows: M[]) => Object.fromEntries(rows.map((r) => [r.key, pj(r)]))
export const int = (v: string | undefined, d: number, max: number) => Math.min(max, Math.max(1, Math.floor(Number(v)) || d))

// Same classes as sportOf(). Fixed strings only, never user input.
export const SPORT_SQL: Record<string, string> = { run: "type LIKE '%running%'", bike: "(type LIKE '%cycling%' OR type LIKE '%biking%')", ski: "type LIKE '%ski%'", strength: "type LIKE '%strength%'" }
export const sportWhere = (s: string | undefined) => (s && SPORT_SQL[s] ? ` AND ${SPORT_SQL[s]}` : '')
export const LIST_COLS = 'id, start_local, type, name, distance_m, duration_s, elev_gain_m, avg_hr, load, fit_status'
export const km1 = (m: number) => Math.round(m / 100) / 10

export async function today(db: DB, now: number) {
  const asOf = () => new Date(now).toISOString()
  const [l] = await q<any>(db, 'SELECT * FROM load_daily ORDER BY date DESC LIMIT 1')
  if (!l) return { as_of: asOf(), data_date: null }
  const rows = await q<M>(db, 'SELECT * FROM metric_daily WHERE date=?', l.date), m = byKey(rows)
  const [act] = await q(db, 'SELECT id, start_local, type, name, distance_m, duration_s, avg_hr, elev_gain_m, load, load_source, aero_te, rpe FROM activities ORDER BY start_local DESC LIMIT 1')
  const [sleep] = await q(db, 'SELECT date, total_s, deep_s, light_s, rem_s, awake_s, score, start_ts, end_ts FROM sleep ORDER BY date DESC LIMIT 1')
  const [day] = await q<any>(db, 'SELECT date, steps, step_goal, rhr, stress_avg, bb_max, bb_min FROM daily_summary ORDER BY date DESC LIMIT 1')
  const [hrv] = await q<any>(db, 'SELECT date, last_night_avg, status FROM hrv_daily WHERE last_night_avg IS NOT NULL ORDER BY date DESC LIMIT 1')
  const [wk] = await q(db, `SELECT COUNT(*) sessions, SUM(distance_m) distance_m, SUM(duration_s) duration_s, SUM(load) load,
    SUM(CASE WHEN type LIKE '%running%' THEN distance_m ELSE 0 END) run_distance_m FROM activities WHERE start_local >= ?`, weekStart(l.date))
  const ws = weekStart(l.date), byDay = Object.fromEntries((await q<any>(db, `SELECT substr(start_local,1,10) d, SUM(distance_m) m, SUM(duration_s) s FROM activities WHERE start_local >= ? GROUP BY d`, ws)).map((r) => [r.d, r]))
  const days = Array.from({ length: 7 }, (_, i) => { const d = addDays(ws, i), r = byDay[d]; return { date: d, km: r ? Math.round(r.m / 100) / 10 : 0, active_min: r ? Math.round(r.s / 60) : 0 } })
  return {
    as_of: asOf(), data_date: l.date,
    status: { label: l.status, reason: m.status?.reason ?? null, ctl: l.ctl, atl: l.atl, tsb: l.tsb, acwr: l.acwr, ramp7: l.ramp7, warming_up: !!l.warming_up },
    readiness: m.readiness == null ? null : { score: rows.find((r) => r.key === 'readiness')!.value, ...m.readiness },
    last_activity: act ?? null, sleep: sleep ?? null,
    tiles: { steps: day?.steps ?? null, step_goal: day?.step_goal ?? null, rhr: day?.rhr ?? null, stress_avg: day?.stress_avg ?? null, body_battery_max: day?.bb_max ?? null,
      hrv_last_night: hrv?.last_night_avg ?? null, hrv_garmin_status: hrv?.status ?? null, hrv: m.hrv ?? null, recovery: m.recovery ?? null, sleep_stats: m.sleep ?? null },
    this_week: { start: ws, ...wk, days }, goals: m.goals ?? null,
  }
}

export async function goalsView(db: DB, now: number) {
  const asOf = () => new Date(now).toISOString()
  const [g] = await q<M>(db, `SELECT * FROM metric_daily WHERE key='goals' ORDER BY date DESC LIMIT 1`)
  const defs = await q(db, `SELECT id, kind, title, target_value, target_max, unit, target_date, status FROM goals ORDER BY id`)
  return { as_of: asOf(), data_date: g?.date ?? null, goals: defs, progress: g ? pj(g) : null }
}

export async function steps(db: DB, now: number, days: string | undefined) {
  const asOf = () => new Date(now).toISOString()
  const n = int(days, 28, 365)
  const to = (await q<any>(db, 'SELECT MAX(date) d FROM daily_summary WHERE steps IS NOT NULL'))[0]?.d
  const [g] = await q<any>(db, `SELECT target_value v FROM goals WHERE kind='steps' AND status='active' ORDER BY id LIMIT 1`)
  if (!to) return { as_of: asOf(), goal: g?.v ?? null, days: [], summary: null }
  const from = addDays(to, 1 - n), m = Object.fromEntries((await q<any>(db, 'SELECT date, steps FROM daily_summary WHERE date >= ? AND date <= ?', from, to)).map((r) => [r.date, r.steps]))
  const [gm] = await q<M>(db, `SELECT * FROM metric_daily WHERE key='goals' ORDER BY date DESC LIMIT 1`)
  return { as_of: asOf(), goal: g?.v ?? null, days: Array.from({ length: n }, (_, i) => { const d = addDays(from, i); return { date: d, steps: m[d] ?? null } }), summary: gm ? pj(gm).steps ?? null : null }
}

export async function mileage(db: DB, now: number, byq: string | undefined, sp: string | undefined) {
  const asOf = () => new Date(now).toISOString()
  const by = byq === 'month' ? 'month' : byq === 'year' ? 'year' : 'week'
  const today = asOf().slice(0, 10), n = by === 'week' ? 52 : by === 'month' ? 24 : 0
  const key = by === 'week' ? "date(substr(start_local,1,10),'weekday 0','-6 days')" : by === 'month' ? 'substr(start_local,1,7)' : 'substr(start_local,1,4)'
  const cur = by === 'week' ? weekStart(today) : by === 'month' ? today.slice(0, 7) : today.slice(0, 4)
  const step = (k: string, i: number) => (by === 'week' ? addDays(k, 7 * i) : by === 'month' ? new Date(Date.UTC(+k.slice(0, 4), +k.slice(5) - 1 + i, 1)).toISOString().slice(0, 7) : String(+k + i))
  let first = n ? step(cur, -(n - 1)) : ''
  if (!n) first = (await q<any>(db, `SELECT MIN(substr(start_local,1,4)) y FROM activities WHERE 1=1${sportWhere(sp)}`))[0]?.y ?? cur
  const lo = by === 'week' ? first : by === 'month' ? `${first}-01` : `${first}-01-01`
  const rows = await q<any>(db, `SELECT ${key} k, SUM(distance_m) m, SUM(duration_s) s, SUM(elev_gain_m) e, COUNT(*) n, MAX(distance_m) mx FROM activities WHERE start_local >= ?${sportWhere(sp)} GROUP BY k`, lo)
  const m = Object.fromEntries(rows.map((r) => [r.k, r]))
  const count = n || +cur - +first + 1
  const periods = Array.from({ length: count }, (_, i) => { const k = step(first, i), r = m[k]; return { key: k, km: r ? km1(r.m ?? 0) : 0, hours: r ? Math.round((r.s ?? 0) / 360) / 10 : 0, elev_m: r ? Math.round(r.e ?? 0) : 0, sessions: r?.n ?? 0, longest_km: r ? km1(r.mx ?? 0) : 0 } })
  return { as_of: asOf(), by, sport: sp ?? 'all', periods }
}

export async function records(db: DB, now: number) {
  const asOf = () => new Date(now).toISOString()
  try {
    const rows = await q<{ label: string; activity_id: number; value: number; date: string; rank: number | null; is_pb: number }>(db, 'SELECT label, activity_id, value, date, rank, is_pb FROM best_efforts ORDER BY date, activity_id')
    const [n] = await q<{ n: number }>(db, `SELECT COUNT(*) n FROM activity_efforts WHERE label='done'`)
    const records = BEST_LABELS.filter((l) => !l.startsWith('p') || rows.some((r) => r.label === l)).map((label) => {
      const mine = rows.filter((r) => r.label === label), lo = !label.startsWith('p')
      return { label, unit: lo ? 's' : 'W',
        best: mine.filter((r) => r.rank).sort((a, b) => a.rank! - b.rank!).map((r) => ({ rank: r.rank, value: r.value, date: r.date, activity_id: r.activity_id })),
        timeline: mine.filter((r) => r.is_pb).map((r) => ({ date: r.date, value: r.value, activity_id: r.activity_id })) }
    })
    // Best per label within a date window, from the per-run efforts (the stored top 3 cannot answer "this year").
    const today = asOf().slice(0, 10), since = { yr: today.slice(0, 4) + '-01-01', l12: addDays(today, -365) }
    const eff = await q<{ label: string; activity_id: number; value: number; date: string }>(db, `SELECT e.label, e.activity_id, e.value, substr(a.start_local,1,10) date FROM activity_efforts e JOIN activities a ON a.id=e.activity_id WHERE e.label <> 'done' AND substr(a.start_local,1,10) >= ?`, since.l12 < since.yr ? since.l12 : since.yr)
    const ranges = Object.fromEntries(Object.entries(since).map(([k, from]) => [k, Object.fromEntries(BEST_LABELS.flatMap((label) => {
      const mine = eff.filter((r) => r.label === label && r.date >= from).sort((a, b) => (label.startsWith('p') ? b.value - a.value : a.value - b.value))
      return mine.length ? [[label, { value: mine[0].value, date: mine[0].date, activity_id: mine[0].activity_id }]] : []
    }))]))
    const top = async (sp: string, by: string) => (await q<{ id: number; date: string; distance_m: number | null; duration_s: number | null; elev_gain_m: number | null }>(db, `SELECT id, substr(start_local,1,10) date, distance_m, duration_s, elev_gain_m FROM activities WHERE ${SPORT_SQL[sp]} AND ${by} IS NOT NULL ORDER BY ${by} DESC LIMIT 1`))[0] ?? null
    const [nr] = await q<{ n: number }>(db, `SELECT COUNT(*) n FROM activities WHERE ${SPORT_SQL.bike}`)
    const rides = nr.n ? { n: nr.n, fastest: await top('bike', 'CASE WHEN distance_m >= 5000 AND duration_s > 0 THEN distance_m / duration_s END'), longest: await top('bike', 'distance_m'), climb: await top('bike', 'elev_gain_m') } : null
    return { as_of: asOf(), available: n.n > 0, n_runs: n.n, records, ranges, longest: await top('run', 'distance_m'), climb: await top('run', 'elev_gain_m'), rides }
  } catch { return { as_of: asOf(), available: false, n_runs: 0, records: [] } }
}

export async function fitnessEstimates(db: DB, now: number, riegel: string | undefined) {
  const asOf = () => new Date(now).toISOString()
  const k = Math.min(1.12, Math.max(1.02, Number(riegel) || 1.06)), today = asOf().slice(0, 10)
  try {
    const [m] = await q<M>(db, `SELECT * FROM metric_daily WHERE key='fitness' ORDER BY date DESC LIMIT 1`)
    if (!m) return { as_of: asOf(), available: false, riegel: k }
    const f = pj(m), cs = f.cs.ok ? f.cs : null
    return { as_of: asOf(), available: true, data_date: m.date, riegel: k, spread: 0.03, vo2: f.vo2, cs: f.cs,
      predictions: predictions(f.sources, today, k, cs), sources: f.sources }
  } catch { return { as_of: asOf(), available: false, riegel: k } }
}

export async function shoes(db: DB, now: number) {
  const asOf = () => new Date(now).toISOString()
  const rows = await q<any>(db, `SELECT s.*, COUNT(a.id) runs, MAX(substr(a.start_local,1,10)) last_run, ROUND(s.start_km + COALESCE(SUM(a.distance_m),0) / 1000.0, 1) km
    FROM shoes s LEFT JOIN activities a ON a.shoe_id = s.id GROUP BY s.id ORDER BY s.retired_on IS NOT NULL, s.id`)
  return { as_of: asOf(), shoes: rows.map((r) => ({ ...r, alert: r.retired_on ? null : r.km >= r.retire_km ? 'over' : r.km >= 0.9 * r.retire_km ? 'soon' : null })) }
}

/** One activity row with its interval steps, or [undefined, []]. */
export async function activityOf(db: DB, id: number) {
  const [a] = Number.isInteger(id) ? await q<any>(db, `SELECT ${LIST_COLS}, moving_s, max_hr, avg_cadence, avg_power, norm_power, aero_te, anaero_te, load_source, rpe, feel, hr_z1_s, hr_z2_s, hr_z3_s, hr_z4_s, hr_z5_s, temp_c, avg_stride_m, avg_vert_osc_mm, avg_vert_ratio, avg_gct_ms, avg_gct_balance, shoe_id FROM activities WHERE id=?`, id) : []
  return [a, a ? await q(db, 'SELECT lap_idx, step_type, set_no, rep_no, duration_s, distance_m, avg_speed_mps, avg_hr, max_hr, avg_power, avg_cadence, ascent_m, avg_stride_m, avg_vert_osc_mm, avg_vert_ratio, avg_gct_ms, avg_gct_balance FROM activity_steps WHERE activity_id=? ORDER BY lap_idx', id) : []] as const
}

const BANNER_DAYS = 30
export function daysLeft(date: string | undefined, now: number) {
  const t = date ? Date.parse(date) : NaN
  const expires_on = Number.isNaN(t) ? null : date!
  const days_left = expires_on ? Math.ceil((t - now) / 864e5) : null
  return { expires_on, days_left, banner: days_left !== null && days_left <= BANNER_DAYS }
}
