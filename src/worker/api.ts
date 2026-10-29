// Read-only metric endpoints. Everything heavy is precomputed by `sync/run.ts recompute`, so these only read and reshape.
import type { Context, Hono } from 'hono'
import type { DB, Env } from './index.js'
import { addDays, diffDays, weekStart } from '../metrics/dates.js'
import { sportOf } from '../metrics/load.js'
import { composition } from '../metrics/sleep.js'
import { callTool } from '../tools.js'
import { LIST_COLS, activityOf, SPORT_SQL, byKey, int, km1, pj, q, sportWhere, today, goalsView, steps, mileage, records, fitnessEstimates, shoes, type M } from '../queries.js'

type App = Hono<{ Bindings: Env }>

// Writes accept JSON only (a form post from another site cannot send this content type without a CORS preflight).
export const jsonBody = async (c: Context) => (c.req.header('content-type')?.includes('application/json') ? await c.req.json().catch(() => null) : null) as Record<string, unknown> | null
const invalid = (c: Context) => (error: string) => c.json({ error, code: 'INVALID' }, 400)

export function metricRoutes(app: App, now: () => number) {
  const asOf = () => new Date(now()).toISOString()

  app.get('/api/today', async (c) => c.json(await today(c.env.DB, now())))

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

  // The vetted correlation report, same output as the get_correlations tool.
  app.get('/api/correlations', async (c) => c.json(await callTool(c.env.DB, 'get_correlations', {}, now())))

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

  app.get('/api/goals', async (c) => c.json(await goalsView(c.env.DB, now())))

  // Dense daily steps ending at the latest day with data (null where Garmin sent nothing), plus the precomputed streak and averages.
  app.get('/api/steps', async (c) => c.json(await steps(c.env.DB, now(), c.req.query('days'))))

  // Edit the three seeded goals in one statement. Progress in /api/goals is recomputed by the next sync.
  const RANGE = { year_km: [500, 6000], band_lo: [10, 150], band_hi: [10, 150], steps: [2000, 30000] } as const
  app.put('/api/goals', async (c) => {
    const b = await jsonBody(c), bad = invalid(c)
    if (!b || typeof b !== 'object') return bad('JSON body expected')
    for (const [k, [lo, hi]] of Object.entries(RANGE)) { const v = b[k]; if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi) return bad(`${k} must be a number from ${lo} to ${hi}`) }
    if ((b.band_hi as number) <= (b.band_lo as number)) return bad('band_hi must be above band_lo')
    await c.env.DB.prepare(`UPDATE goals SET target_value = CASE kind WHEN 'distance' THEN ? WHEN 'weekly_km' THEN ? ELSE ? END, target_max = CASE kind WHEN 'weekly_km' THEN ? ELSE target_max END
      WHERE status='active' AND kind IN ('distance','weekly_km','steps')`).bind(b.year_km, b.band_lo, b.steps, b.band_hi).run()
    return c.json({ ok: true })
  })

  // ---- mileage: one GROUP BY each, no per-activity loops ----
  app.get('/api/mileage', async (c) => c.json(await mileage(c.env.DB, now(), c.req.query('by'), c.req.query('sport'))))

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
  app.get('/api/records', async (c) => c.json(await records(c.env.DB, now())))

  app.get('/api/fitness-estimates', async (c) => c.json(await fitnessEstimates(c.env.DB, now(), c.req.query('riegel'))))

  // routes/all.json is built by the sync `routes` stage. Streamed as is: parsing ~1 MB of JSON could exceed the free plan's CPU limit.
  app.get('/api/routes', async (c) => {
    const o = await c.env.FIT?.get('routes/all.json').catch(() => null)
    return o ? new Response(o.body, { headers: { 'content-type': 'application/json', 'cache-control': 'private, max-age=300' } }) : c.json({ v: 1, runs: [] })
  })

  // ---- shoes: entered by hand, Garmin sends no gear. Mileage is start_km + the assigned activities, computed here and never stored. ----
  const isDate = (v: unknown) => typeof v === 'string' && /^\d{4}-\d\d-\d\d$/.test(v) && !Number.isNaN(Date.parse(v))
  const within = (lo: number, hi: number) => (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi
  const text = (max: number) => (v: unknown) => v === null || (typeof v === 'string' && v.length <= max)
  const SHOE: Record<string, (v: unknown) => boolean> = { name: (v) => typeof v === 'string' && v.trim() !== '' && v.length <= 60, brand: text(60), notes: text(500),
    default_for: (v) => v === null || v === 'run', start_km: within(0, 20000), retire_km: within(100, 3000), retired_on: (v) => v === null || isDate(v), since: isDate }
  const SHOE_COLS = ['name', 'brand', 'default_for', 'start_km', 'retire_km', 'retired_on', 'notes', 'since']
  const shoeError = (b: Record<string, unknown>) => { const k = Object.keys(b).find((x) => !SHOE[x]?.(b[x])); return k ? `${k} is not valid` : null }
  // One default per sport: taking the role from the others keeps auto-assign unambiguous.
  const takeDefault = (db: DB, s: Record<string, any>, id: number) => (s.default_for ? db.prepare('UPDATE shoes SET default_for=NULL WHERE default_for=? AND id != ?').bind(s.default_for, id).run() : null)

  app.get('/api/shoes', async (c) => c.json(await shoes(c.env.DB, now())))

  app.post('/api/shoes', async (c) => {
    const b = await jsonBody(c), bad = invalid(c)
    if (!b || Array.isArray(b)) return bad('JSON body expected')
    const e = shoeError(b); if (e) return bad(e)
    if (typeof b.name !== 'string') return bad('name is required')
    const s: Record<string, any> = { brand: null, notes: null, default_for: null, start_km: 0, retire_km: 800, retired_on: null, since: asOf().slice(0, 10), ...b, name: b.name.trim() }
    if (s.retired_on && s.default_for) return bad('a retired shoe cannot be the default')
    await takeDefault(c.env.DB, s, 0)
    const [r] = await q<{ id: number }>(c.env.DB, `INSERT INTO shoes (${SHOE_COLS}) VALUES (${SHOE_COLS.map(() => '?')}) RETURNING id`, ...SHOE_COLS.map((k) => s[k]))
    return c.json({ ok: true, id: r.id }, 201)
  })

  app.patch('/api/shoes/:id', async (c) => {
    const id = Number(c.req.param('id')), b = await jsonBody(c), bad = invalid(c)
    const [cur] = Number.isInteger(id) ? await q<Record<string, any>>(c.env.DB, `SELECT ${SHOE_COLS} FROM shoes WHERE id=?`, id) : []
    if (!cur) return c.json({ error: 'not found', code: 'NOT_FOUND' }, 404)
    if (!b || Array.isArray(b) || !Object.keys(b).length) return bad('JSON body expected')
    const e = shoeError(b); if (e) return bad(e)
    const s = { ...cur, ...b }
    if (typeof b.name === 'string') s.name = b.name.trim()
    if (s.retired_on) { if (b.default_for) return bad('a retired shoe cannot be the default'); s.default_for = null }
    await takeDefault(c.env.DB, s, id)
    await c.env.DB.prepare(`UPDATE shoes SET ${SHOE_COLS.map((k) => `${k}=?`)} WHERE id=?`).bind(...SHOE_COLS.map((k) => s[k]), id).run()
    return c.json({ ok: true })
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
    const [a, laps] = await activityOf(db, id)
    if (!a) return c.json({ error: 'not found', code: 'NOT_FOUND' }, 404)
    // Charts, route, splits, EF and decoupling are precomputed by the sync fit stage into detail/{id}.json
    const detail = a.fit_status === 'ok' ? await c.env.FIT?.get(`detail/${id}.json`).then((o) => o?.json() ?? null).catch(() => null) ?? null : null
    return c.json({ as_of: asOf(), activity: { ...a, sport: sportOf(a.type ?? '') }, laps, detail })
  })

  // Only the shoe can be changed here. A run left without a shoe gets the default again at the next sync.
  app.patch('/api/activities/:id', async (c) => {
    const id = Number(c.req.param('id')), b = await jsonBody(c), bad = invalid(c), sid = b?.shoe_id
    if (!b || Object.keys(b).join() !== 'shoe_id' || (sid !== null && !Number.isInteger(sid))) return bad('JSON body {"shoe_id": id or null} expected')
    if (!Number.isInteger(id) || !(await q(c.env.DB, 'SELECT 1 FROM activities WHERE id=?', id)).length) return c.json({ error: 'not found', code: 'NOT_FOUND' }, 404)
    if (sid !== null && !(await q(c.env.DB, 'SELECT 1 FROM shoes WHERE id=?', sid)).length) return bad('unknown shoe')
    await c.env.DB.prepare('UPDATE activities SET shoe_id=? WHERE id=?').bind(sid, id).run()
    return c.json({ ok: true })
  })
}
