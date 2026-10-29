// The one tool registry (the contract for the coach, and later the MCP server): name, description, JSON-schema input, handler.
// Reads reuse src/queries.ts. Writes: notes, planned load, RPE, goals. Every result carries as_of plus n or confidence so the model can hedge.
import type { DB } from './worker/index.js'
import { addDays, diffDays, weekStart } from './metrics/dates.js'
import { project, sportOf } from './metrics/load.js'
import { LIST_COLS, SPORT_SQL, activityOf, fitnessEstimates, goalsView, q, shoes, sportWhere, steps, today } from './queries.js'

type Args = Record<string, any>
export type Tool = { name: string; description: string; input_schema: object; write?: boolean; handler: (db: DB, a: Args, now: number) => Promise<object> }

const iso = (now: number) => new Date(now).toISOString().slice(0, 10)
const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d\d-\d\d$/.test(v) && !Number.isNaN(Date.parse(v))
const num = (v: unknown, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : null)
const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() !== '' && v.length <= max ? v.trim() : null)
const run = (db: DB, sql: string, ...b: unknown[]) => db.prepare(sql).bind(...b).run()
const bad = (error: string) => ({ error })
const obj = (properties: object, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false })
const D = { type: 'string', description: 'YYYY-MM-DD' }

export const NOTE_KINDS = ['injury', 'illness', 'schedule', 'preference', 'other']
const GOAL_KINDS = ['race', 'distance', 'weekly_km', 'steps', 'ctl', 'weight', 'custom']

/** Active notes that have not expired. Injury first. Shared with the briefing and the notes API. */
export const activeNotes = (db: DB, now: number) =>
  q<{ id: number; kind: string; text: string; expires_on: string | null }>(db, `SELECT id, kind, text, expires_on FROM coach_notes WHERE active=1 AND (expires_on IS NULL OR expires_on >= ?) ORDER BY kind='injury' DESC, id`, iso(now))
export async function addNote(db: DB, now: number, kind: unknown, text: unknown, expires_on: unknown, source = 'coach') {
  const k = typeof kind === 'string' && NOTE_KINDS.includes(kind) ? kind : 'other', t = str(text, 300)
  if (!t) return null
  if (expires_on != null && !isDate(expires_on)) return null
  const [r] = await q<{ id: number }>(db, 'INSERT INTO coach_notes (created_at, kind, text, expires_on, source) VALUES (?, ?, ?, ?, ?) RETURNING id', now, k, t, expires_on ?? null, source)
  return r.id
}
export const plannedFrom = (db: DB, from: string, days: number) => q<{ date: string; load: number; label: string | null }>(db, 'SELECT date, load, label FROM planned_load WHERE date >= ? AND date <= ? ORDER BY date', from, addDays(from, days - 1))

// get_series: scalar daily series. [sql with ? ? = from, to, aggregate for weeks]
const col = (t: string, c: string, d = 'date') => `SELECT ${d} date, ${c} v FROM ${t} WHERE ${d} >= ? AND ${d} <= ?`
const SERIES: Record<string, [string, 'avg' | 'sum']> = {
  load: [col('load_daily', 'load'), 'sum'], ctl: [col('load_daily', 'ctl'), 'avg'], atl: [col('load_daily', 'atl'), 'avg'], tsb: [col('load_daily', 'tsb'), 'avg'], acwr: [col('load_daily', 'acwr'), 'avg'], ramp7: [col('load_daily', 'ramp7'), 'avg'],
  steps: [col('daily_summary', 'steps'), 'sum'], rhr: [col('daily_summary', 'rhr'), 'avg'], stress_avg: [col('daily_summary', 'stress_avg'), 'avg'], body_battery_max: [col('daily_summary', 'bb_max'), 'avg'],
  sleep_total_s: [col('sleep', 'total_s'), 'avg'], sleep_score: [col('sleep', 'score'), 'avg'], hrv: [col('hrv_daily', 'last_night_avg'), 'avg'],
  readiness: [`SELECT date, value v FROM metric_daily WHERE key='readiness' AND date >= ? AND date <= ?`, 'avg'],
  run_km: [`SELECT substr(start_local,1,10) date, SUM(distance_m) / 1000.0 v FROM activities WHERE ${SPORT_SQL.run} AND substr(start_local,1,10) >= ? AND substr(start_local,1,10) <= ? GROUP BY date`, 'sum'],
}
const r2 = (x: number) => Math.round(x * 100) / 100

export const TOOLS: Tool[] = [
  { name: 'get_overview', description: "Today's snapshot: training status label, CTL/ATL/TSB/ACWR/ramp, readiness with components and confidence, HRV and sleep stats, last night's sleep, last activity, this week's totals. Start here.",
    input_schema: obj({}),
    async handler(db, _a, now) {
      const t: any = await today(db, now)
      if (!t.data_date) return { n: 0, confidence: 'none', note: 'no data synced yet' }
      const { goals: _g, this_week: w, ...rest } = t
      return { ...rest, this_week: { ...w, days: undefined }, data_age_days: diffDays(t.data_date, iso(now)), confidence: t.readiness?.confidence ?? 'unknown', n: 1 }
    } },
  { name: 'get_activities', description: 'Activity summaries (distance, duration, avg HR, load, RPE), newest first.',
    input_schema: obj({ from: D, to: D, type: { type: 'string', enum: ['run', 'bike', 'ski', 'strength'] }, limit: { type: 'integer', minimum: 1, maximum: 30 } }),
    async handler(db, a, now) {
      const to = isDate(a.to) ? a.to : iso(now), from = isDate(a.from) ? a.from : addDays(to, -13), limit = num(a.limit, 1, 30) ?? 10
      const rows = await q<any>(db, `SELECT ${LIST_COLS}, rpe FROM activities WHERE substr(start_local,1,10) >= ? AND substr(start_local,1,10) <= ?${sportWhere(a.type)} ORDER BY start_local DESC LIMIT ?`, from, to, limit)
      return { from, to, n: rows.length, activities: rows.map((r) => ({ ...r, sport: sportOf(r.type ?? '') })) }
    } },
  { name: 'get_activity', description: 'One activity: summary, heart-rate zone seconds, shoe and interval steps (no raw streams).',
    input_schema: obj({ id: { type: 'integer' } }, ['id']),
    async handler(db, a) {
      const [act, laps] = await activityOf(db, Number(a.id))
      return act ? { activity: { ...act, sport: sportOf(act.type ?? '') }, laps: laps.slice(0, 40), n: laps.length } : bad('activity not found')
    } },
  { name: 'get_series', description: `Daily or weekly series for up to 6 of: ${Object.keys(SERIES).join(', ')}. Default last 28 days. Weekly agg: mean (sum for load, steps, run_km).`,
    input_schema: obj({ keys: { type: 'array', items: { type: 'string', enum: Object.keys(SERIES) }, minItems: 1, maxItems: 6 }, from: D, to: D, agg: { type: 'string', enum: ['day', 'week'] } }, ['keys']),
    async handler(db, a, now) {
      const keys = (Array.isArray(a.keys) ? a.keys : []).filter((k: string) => SERIES[k]).slice(0, 6)
      if (!keys.length) return bad('keys must name known series')
      const to = isDate(a.to) ? a.to : iso(now), from = isDate(a.from) ? a.from : addDays(to, -27)
      if (diffDays(from, to) > 400 || from > to) return bad('range must be 0 to 400 days')
      const out: Record<string, { date: string; v: number }[]> = {}
      for (const k of keys) {
        const rows = (await q<{ date: string; v: number | null }>(db, SERIES[k][0], from, to)).filter((r): r is { date: string; v: number } => r.v != null)
        if (a.agg !== 'week') { out[k] = rows.map((r) => ({ date: r.date, v: r2(r.v) })); continue }
        const g: Record<string, number[]> = {}
        for (const r of rows) (g[weekStart(r.date)] ??= []).push(r.v)
        out[k] = Object.entries(g).map(([date, vs]) => ({ date, v: r2(vs.reduce((s, x) => s + x, 0) / (SERIES[k][1] === 'avg' ? vs.length : 1)) }))
      }
      return { from, to, agg: a.agg === 'week' ? 'week' : 'day', n: Object.fromEntries(keys.map((k: string) => [k, out[k].length])), series: out }
    } },
  { name: 'project_load', description: 'Forecast CTL/ATL/TSB from the latest day. Daily loads: planned[] overrides, then saved planned loads, then daily_load (default 0).',
    input_schema: obj({ days: { type: 'integer', minimum: 1, maximum: 42 }, daily_load: { type: 'number', minimum: 0, maximum: 500 }, planned: { type: 'array', items: obj({ date: D, load: { type: 'number', minimum: 0, maximum: 500 } }, ['date', 'load']) } }),
    async handler(db, a) {
      const [l] = await q<any>(db, 'SELECT date, ctl, atl FROM load_daily ORDER BY date DESC LIMIT 1')
      if (!l) return { n: 0, confidence: 'none' }
      const days = num(a.days, 1, 42) ?? 14, dflt = num(a.daily_load, 0, 500) ?? 0, dates = Array.from({ length: days }, (_, i) => addDays(l.date, i + 1))
      const given = new Map<string, number>((await plannedFrom(db, dates[0], days)).map((p) => [p.date, p.load]))
      for (const p of Array.isArray(a.planned) ? a.planned : []) if (isDate(p?.date) && num(p.load, 0, 500) !== null) given.set(p.date, p.load)
      const loads = dates.map((d) => given.get(d) ?? dflt)
      return { from_date: l.date, default_daily_load: dflt, n: days, confidence: 'model', days: project(l.ctl, l.atl, loads).map((p, i) => ({ date: dates[i], load: loads[i], ctl: r2(p.ctl), atl: r2(p.atl), tsb: r2(p.tsb), tsb_end: r2(p.tsb_end) })) }
    } },
  { name: 'get_race_predictions', description: 'Race time predictions (5k, 10k, half, marathon) with low/high range and source effort, from recent best efforts.',
    input_schema: obj({}),
    async handler(db, _a, now) { const f: any = await fitnessEstimates(db, now, undefined); return f.available ? { data_date: f.data_date, predictions: f.predictions, n: f.sources.length, confidence: f.sources.length >= 3 ? 'ok' : 'low' } : { n: 0, confidence: 'none' } } },
  { name: 'get_vo2_estimate', description: 'Running VO2 estimate (n steady runs, weekly history) and critical speed.',
    input_schema: obj({}),
    async handler(db, _a, now) { const f: any = await fitnessEstimates(db, now, undefined); return f.available ? { data_date: f.data_date, vo2: f.vo2, critical_speed: f.cs, n: f.vo2?.n ?? 0, confidence: (f.vo2?.n ?? 0) >= 3 ? 'ok' : 'low' } : { n: 0, confidence: 'none' } } },
  { name: 'get_correlations', description: 'The vetted correlation report. Not built yet, so this returns available:false.',
    input_schema: obj({ x: { type: 'string' }, y: { type: 'string' } }),
    async handler() { return { available: false, n: 0, confidence: 'none' } } },
  { name: 'get_shoes', description: 'Shoes with mileage and retire alerts.', input_schema: obj({}),
    async handler(db, _a, now) { const s: any = await shoes(db, now); return { shoes: s.shoes, n: s.shoes.length } } },
  { name: 'get_notes', description: 'Active coach notes (injury, illness, schedule, preference). Expired notes are left out.', input_schema: obj({}),
    async handler(db, _a, now) { const notes = await activeNotes(db, now); return { notes, n: notes.length } } },
  { name: 'add_note', description: 'Save a durable fact the user stated (e.g. a sore knee). Tell the user what you saved.', write: true,
    input_schema: obj({ kind: { type: 'string', enum: NOTE_KINDS }, text: { type: 'string', maxLength: 300 }, expires_on: D }, ['kind', 'text']),
    async handler(db, a, now) { const id = await addNote(db, now, a.kind, a.text, a.expires_on); return id ? { ok: true, id, n: 1 } : bad('text (1-300 chars) and a valid expires_on date are required') } },
  { name: 'resolve_note', description: 'Mark a note as resolved (no longer active).', write: true,
    input_schema: obj({ id: { type: 'integer' } }, ['id']),
    async handler(db, a) {
      const [r] = await q(db, 'UPDATE coach_notes SET active=0 WHERE id=? RETURNING id', Number(a.id))
      return r ? { ok: true, id: Number(a.id), n: 1 } : bad('note not found')
    } },
  { name: 'get_planned', description: 'Planned daily loads for the next 14 days (load 0 = rest day).', input_schema: obj({}),
    async handler(db, _a, now) { const p = await plannedFrom(db, iso(now), 14); return { planned: p, n: p.length } } },
  { name: 'set_planned', description: 'Plan a load for a date (today to 60 days ahead). Rest day = load 0.', write: true,
    input_schema: obj({ date: D, load: { type: 'number', minimum: 0, maximum: 500 }, label: { type: 'string', maxLength: 60 } }, ['date', 'load']),
    async handler(db, a, now) {
      const load = num(a.load, 0, 500)
      if (!isDate(a.date) || a.date < iso(now) || a.date > addDays(iso(now), 60) || load === null) return bad('date must be today to 60 days ahead and load 0 to 500')
      await run(db, 'INSERT INTO planned_load (date, load, label) VALUES (?, ?, ?) ON CONFLICT(date) DO UPDATE SET load=excluded.load, label=excluded.label', a.date, load, str(a.label, 60))
      return { ok: true, date: a.date, load, n: 1 }
    } },
  { name: 'set_rpe', description: 'Record perceived effort 1-10 on an activity, by activity_id or by date plus type (the latest of that type that day). Says which activity it updated. The load is recalculated by the next sync, and only where the activity has no heart-rate zones.', write: true,
    input_schema: obj({ activity_id: { type: 'integer' }, date: D, type: { type: 'string', enum: ['run', 'bike', 'ski', 'strength'] }, rpe: { type: 'number', minimum: 1, maximum: 10 } }, ['rpe']),
    async handler(db, a) {
      const rpe = num(a.rpe, 1, 10)
      if (rpe === null) return bad('rpe must be 1 to 10')
      const rows = Number.isInteger(a.activity_id) ? await q<any>(db, 'SELECT id, name, start_local FROM activities WHERE id=?', a.activity_id)
        : isDate(a.date) && a.type ? await q<any>(db, `SELECT id, name, start_local FROM activities WHERE substr(start_local,1,10)=?${sportWhere(a.type)} ORDER BY start_local DESC LIMIT 1`, a.date)
        : null
      if (!rows) return bad('give activity_id, or date and type')
      if (!rows[0]) return bad('no matching activity')
      await run(db, 'UPDATE activities SET rpe=? WHERE id=?', rpe, rows[0].id)
      return { ok: true, updated: { id: rows[0].id, name: rows[0].name, start_local: rows[0].start_local, rpe }, n: 1 }
    } },
  { name: 'get_steps', description: 'Daily steps for the last N days with the goal and streak summary.', input_schema: obj({ days: { type: 'integer', minimum: 1, maximum: 90 } }),
    async handler(db, a, now) { const s: any = await steps(db, now, String(num(a.days, 1, 90) ?? 14)); return { goal: s.goal, summary: s.summary, days: s.days, n: s.days.length } } },
  { name: 'get_goals', description: 'Goals (soft guidance, not obligations) with progress. With none, ask the user to set one.', input_schema: obj({}),
    async handler(db, _a, now) { const g: any = await goalsView(db, now); return { goals: g.goals, progress: g.progress, data_date: g.data_date, n: g.goals.length } } },
  { name: 'set_goal', description: 'Create a goal. Only when the user asks for one.', write: true,
    input_schema: obj({ kind: { type: 'string', enum: GOAL_KINDS }, title: { type: 'string', maxLength: 80 }, target_value: { type: 'number' }, target_max: { type: 'number' }, unit: { type: 'string', maxLength: 12 }, target_date: D }, ['kind', 'title']),
    async handler(db, a, now) {
      const title = str(a.title, 80)
      if (!GOAL_KINDS.includes(a.kind) || !title || (a.target_date != null && !isDate(a.target_date))) return bad('valid kind, title and optional target_date required')
      const [r] = await q<{ id: number }>(db, 'INSERT INTO goals (created_at, kind, title, target_value, target_max, unit, target_date) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id', now, a.kind, title, num(a.target_value, -1e9, 1e9), num(a.target_max, -1e9, 1e9), str(a.unit, 12), a.target_date ?? null)
      return { ok: true, id: r.id, n: 1 }
    } },
  { name: 'update_goal', description: 'Change a goal: status active|done|dropped, title, targets or date.', write: true,
    input_schema: obj({ id: { type: 'integer' }, status: { type: 'string', enum: ['active', 'done', 'dropped'] }, title: { type: 'string', maxLength: 80 }, target_value: { type: 'number' }, target_max: { type: 'number' }, target_date: D }, ['id']),
    async handler(db, a) {
      const [g] = await q<any>(db, 'SELECT * FROM goals WHERE id=?', Number(a.id))
      if (!g) return bad('goal not found')
      const status = ['active', 'done', 'dropped'].includes(a.status) ? a.status : g.status
      await run(db, 'UPDATE goals SET status=?, title=?, target_value=?, target_max=?, target_date=? WHERE id=?', status, str(a.title, 80) ?? g.title, num(a.target_value, -1e9, 1e9) ?? g.target_value, num(a.target_max, -1e9, 1e9) ?? g.target_max, isDate(a.target_date) ? a.target_date : g.target_date, g.id)
      return { ok: true, id: g.id, status, n: 1 }
    } },
]

/** Runs one tool. Unknown names and thrown errors come back as {error} so the model can recover; details stay out of the answer. */
export async function callTool(db: DB, name: string, args: unknown, now: number) {
  const t = TOOLS.find((x) => x.name === name)
  if (!t) return bad(`unknown tool ${name}`)
  try { return { as_of: new Date(now).toISOString(), ...(await t.handler(db, args && typeof args === 'object' ? (args as Args) : {}, now)) } }
  catch { return bad('tool failed') }
}
