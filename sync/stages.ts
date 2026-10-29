import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { Garmin, GarminError, WINDOW, addDays, windows } from './garmin.js'
import { log } from './log.js'
import { Store, Stmt, getState, setState, upsert } from './store.js'
import { parseFit, unzipFit, type Parsed } from './fit.js'
import { buildDetail } from '../src/metrics/activity.js'
import { effortStmts } from './records.js'

export type Ctx = { g: Garmin; db: Store; today: string; outDir: string; deadline?: number; put?: (key: string, body: Uint8Array) => Promise<void> }
const rows = (r: any): any[] => (Array.isArray(r) ? r : []) // 204 / null / {nulls} all mean "no data"
const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const js = (o: unknown) => JSON.stringify(o)

// ---- mappers: API shape to table row ----
export function mapActivity(a: any) {
  const raw = Object.fromEntries(Object.entries(a).filter(([k]) => !/^owner|^(start|end)(Latitude|Longitude)$/.test(k)))
  return {
    id: a.activityId, start_local: a.startTimeLocal, start_gmt: a.startTimeGMT, type: a.activityType?.typeKey, name: a.activityName,
    distance_m: n(a.distance), duration_s: n(a.duration), moving_s: n(a.movingDuration), elev_gain_m: n(a.elevationGain),
    avg_hr: n(a.averageHR), max_hr: n(a.maxHR), avg_cadence: n(a.averageRunningCadenceInStepsPerMinute), avg_power: n(a.avgPower),
    norm_power: n(a.normPower), aero_te: n(a.aerobicTrainingEffect), anaero_te: n(a.anaerobicTrainingEffect), garmin_load: n(a.activityTrainingLoad),
    hr_z1_s: n(a.hrTimeInZone_1), hr_z2_s: n(a.hrTimeInZone_2), hr_z3_s: n(a.hrTimeInZone_3), hr_z4_s: n(a.hrTimeInZone_4), hr_z5_s: n(a.hrTimeInZone_5),
    temp_c: n(a.maxTemperature), raw_json: js(raw),
  }
}
export const mapDaily = (d: any) => ({
  date: d.calendarDate, steps: n(d.movement?.steps?.value), step_goal: n(d.movement?.steps?.goal), distance_m: n(d.movement?.steps?.distanceInMeters),
  rhr: n(d.heartRate?.restingValue), hr_min: n(d.heartRate?.minValue), hr_max: n(d.heartRate?.maxValue), stress_avg: n(d.stress?.avgLevel),
  bb_min: n(d.bodyBattery?.minValue), bb_max: n(d.bodyBattery?.maxValue), bb_charged: n(d.bodyBattery?.chargedValue), bb_drained: n(d.bodyBattery?.drainedValue),
  resp_avg: n(d.respiration?.avgValue), spo2_avg: n(d.pulseOx?.avgValue), intensity_mod: n(d.intensityMinutes?.moderate), intensity_vig: n(d.intensityMinutes?.vigorous),
  kcal_active: n(d.calories?.burnedActive), kcal_total: n(d.calories?.burnedTotal), raw_json: js(d),
})
export const mapSleep = (s: any) => ({
  date: s.calendarDate, start_ts: n(s.sleepStartTimestampGMT), end_ts: n(s.sleepEndTimestampGMT), total_s: n(s.sleepTimeSeconds),
  deep_s: n(s.deepSleepSeconds), light_s: n(s.lightSleepSeconds), rem_s: n(s.remSleepSeconds), awake_s: n(s.awakeSleepSeconds),
  score: n(s.sleepScores?.overall?.value), avg_hr: n(s.avgHeartRate), avg_stress: n(s.avgSleepStress), spo2_avg: n(s.averageSpO2Value),
  resp_avg: n(s.averageRespirationValue), raw_json: js(s),
})
export const mapHrv = (h: any) => ({
  date: h.calendarDate, last_night_avg: n(h.lastNightAvg), weekly_avg: n(h.weeklyAvg), high_5min: n(h.lastNight5MinHigh),
  base_low: n(h.baseline?.lowUpper), base_balanced_low: n(h.baseline?.balancedLow), base_balanced_upper: n(h.baseline?.balancedUpper), status: h.status ?? null,
})
export function mapBodyBattery(b: any) {
  const lv = (b.bodyBatteryValuesArray ?? []).map((x: any) => x?.[1]).filter((x: unknown) => typeof x === 'number')
  return { date: b.date, charged: n(b.charged), drained: n(b.drained), min_level: lv.length ? Math.min(...lv) : null, max_level: lv.length ? Math.max(...lv) : null }
}
export const mapStress = (s: any) => ({
  date: s.calendarDate, avg_level: n(s.values?.overallStressLevel), rest_s: n(s.values?.restStressDuration),
  low_s: n(s.values?.lowStressDuration), medium_s: n(s.values?.mediumStressDuration), high_s: n(s.values?.highStressDuration),
})
export const mapSteps = (s: any) => ({ date: s.calendarDate, steps: n(s.totalSteps), distance_m: n(s.totalDistance), goal: n(s.stepGoal) })

// ---- wellness series: one table fed by one windowed endpoint ----
type Series = { name: keyof typeof WINDOW; table: string; fetch: (g: Garmin, from: string, to: string) => Promise<any[]>; map: (x: any) => any }
const q2 = (a: string, b: string) => ({ startDate: a, endDate: b })
export const SERIES: Series[] = [
  { name: 'daily', table: 'daily_summary', map: mapDaily, fetch: async (g, a, b) => (await g.get('daily', '/usersummary-service/v2/dailysummaries', q2(a, b)))?.data ?? [] },
  { name: 'hrv', table: 'hrv_daily', map: mapHrv, fetch: async (g, a, b) => (await g.get('hrv', `/hrv-service/hrv/daily/${a}/${b}`))?.hrvSummaries ?? [] },
  { name: 'sleep', table: 'sleep', map: mapSleep, fetch: async (g, a, b) => rows(await g.get('sleep', '/sleep-service/sleep/dailySleepSummariesByDate', q2(a, b))).filter((s) => s.sleepTimeSeconds) },
  { name: 'bodybattery', table: 'body_battery', map: mapBodyBattery, fetch: async (g, a, b) => rows(await g.get('bodybattery', '/wellness-service/wellness/bodyBattery/reports/daily', q2(a, b))) },
  { name: 'stress', table: 'stress', map: mapStress, fetch: async (g, a, b) => rows(await g.get('stress', `/usersummary-service/stats/stress/daily/${a}/${b}`)) },
  { name: 'steps', table: 'steps', map: mapSteps, fetch: async (g, a, b) => rows(await g.get('steps', `/usersummary-service/stats/steps/daily/${a}/${b}`)) },
]

async function loadSeries(c: Ctx, s: Series, from: string, to: string) {
  const got = (await s.fetch(c.g, from, to)).map(s.map).filter((r) => r.date)
  return upsert(c.db, s.table, ['date'], got)
}

export async function steadyWellness(c: Ctx, days = 3) {
  for (const s of SERIES) log(`steady.${s.name}`, { rows: await loadSeries(c, s, addDays(c.today, -(days - 1)), c.today) })
}

export async function activitiesPage(c: Ctx, start: number, limit: number) {
  const list = rows(await c.g.get('activities', '/activitylist-service/activities/search/activities', { start, limit }))
  await upsert(c.db, 'activities', ['id'], list.map(mapActivity))
  return list.length
}

export async function steadyActivities(c: Ctx, limit = 20) {
  log('steady.activities', { rows: await activitiesPage(c, 0, limit) })
}

const ZKEY = ['sport', 'lthr', 'max_hr', 'rest_hr', 'method', 'z1', 'z2', 'z3', 'z4', 'z5'] as const
export async function zones(c: Ctx) {
  let added = 0
  for (const z of rows(await c.g.get('zones', '/biometric-service/heartRateZones/v2'))) {
    const row = { sport: z.sport, lthr: n(z.lactateThresholdHeartRateUsed), max_hr: n(z.maxHeartRateUsed), rest_hr: n(z.restingHeartRateUsed), method: z.trainingMethod ?? null,
      z1: n(z.zone1Floor), z2: n(z.zone2Floor), z3: n(z.zone3Floor), z4: n(z.zone4Floor), z5: n(z.zone5Floor) }
    const last = (await c.db.all<any>('SELECT * FROM hr_zones WHERE sport=? ORDER BY effective_date DESC LIMIT 1', [row.sport]))[0]
    if (last && ZKEY.every((k) => last[k] === row[k])) continue
    await upsert(c.db, 'hr_zones', ['effective_date', 'sport'], [{ effective_date: c.today, ...row }])
    added++
  }
  log('zones', { added })
}

/** Gives runs without a shoe the default running shoe, from the day it was added (shoes.since) on. Never touches a shoe set by hand. */
export async function assignShoes(db: Store) {
  await db.batch([[`UPDATE activities SET shoe_id = (SELECT s.id FROM shoes s WHERE s.default_for='run' AND s.retired_on IS NULL AND substr(activities.start_local,1,10) >= s.since ORDER BY s.id LIMIT 1)
    WHERE shoe_id IS NULL AND type LIKE '%running%'`]])
}

/** Laps and running dynamics averages of one parsed FIT. Shared by the fit stage and the offline rebuild. */
const parsedStmts = (id: number, p: Parsed): Stmt[] => [
  ['DELETE FROM activity_steps WHERE activity_id=?', [id]],
  ...p.steps.map((s): Stmt => ['INSERT INTO activity_steps (activity_id,' + Object.keys(s) + ') VALUES (?,' + Object.keys(s).map(() => '?') + ')', [id, ...Object.values(s)]]),
  ['UPDATE activities SET avg_stride_m=?, avg_vert_osc_mm=?, avg_vert_ratio=?, avg_gct_ms=?, avg_gct_balance=? WHERE id=?',
    [p.dyn.avg_stride_m, p.dyn.avg_vert_osc_mm, p.dyn.avg_vert_ratio, p.dyn.avg_gct_ms, p.dyn.avg_gct_balance, id]],
]

/** Rebuild detail/{id}.json from the zips already in exports/fit (no network), and refresh laps and dynamics averages in c.db. Use after changing buildDetail or fit.ts. */
export async function detailStage(c: Ctx) {
  let n = 0
  for (const f of existsSync(`${c.outDir}/fit`) ? readdirSync(`${c.outDir}/fit`) : []) {
    const id = f.replace('.zip', '')
    const p = parseFit(unzipFit(readFileSync(`${c.outDir}/fit/${f}`)))
    mkdirSync(`${c.outDir}/detail`, { recursive: true }); writeFileSync(`${c.outDir}/detail/${id}.json`, Buffer.from(js(buildDetail(p.streams)))); n++
    await c.db.batch(parsedStmts(Number(id), p))
  }
  log('detail', { rebuilt: n })
}

// ---- FIT: runs only. Zip and streams go to local exports/ for now (R2 keys are the same relative paths). ----
export async function fitStage(c: Ctx, max = Infinity) {
  const todo = await c.db.all<{ id: number }>(
    `SELECT id FROM activities WHERE fit_status='none' AND type LIKE '%running%' ORDER BY start_gmt DESC LIMIT ?`, [Number.isFinite(max) ? max : 1e9])
  let ok = 0, failed = 0
  const put = c.put ?? (async (k: string, b: Uint8Array) => { mkdirSync(`${c.outDir}/${k.split('/')[0]}`, { recursive: true }); writeFileSync(`${c.outDir}/${k}`, b) })
  for (const { id } of todo) {
    if (c.deadline && Date.now() > c.deadline) break
    try {
      const zip: Uint8Array = await c.g.get('fit', `/download-service/files/activity/${id}`, {}, true)
      if (!zip) throw new GarminError('fit', 204)
      await put(`fit/${id}.zip`, zip)
      const p = parseFit(unzipFit(zip))
      await put(`streams/${id}.json.gz`, gzipSync(js(p.streams)))
      await put(`detail/${id}.json`, Buffer.from(js(buildDetail(p.streams)))) // small, downsampled, read by the Worker
      await c.db.batch([
        ...parsedStmts(id, p), ...effortStmts(id, p.streams),
        [`UPDATE activities SET fit_status='ok', fit_r2_key=?, rpe=COALESCE(?,rpe), feel=COALESCE(?,feel) WHERE id=?`, [`fit/${id}.zip`, p.rpe, p.feel, id]],
      ])
      ok++
    } catch (e) {
      if (e instanceof GarminError && e.status !== 404 && e.status !== 204 && e.status !== 400) throw e // transient: leave 'none', retry next run
      await c.db.batch([[`UPDATE activities SET fit_status='error' WHERE id=?`, [id]]])
      failed++
    }
  }
  log('fit', { ok, failed, pending: todo.length - ok - failed })
}

// ---- backfill (resumable via sync_state) ----
export async function backfill(c: Ctx): Promise<'done' | 'paused'> {
  const out = () => !!c.deadline && Date.now() > c.deadline
  // 1. activities, 99 per page from newest to first
  if ((await getState(c.db, 'bf.activities')) !== 'done') {
    for (;;) {
      const start = Number((await getState(c.db, 'bf.activities')) ?? 0)
      const got = await activitiesPage(c, start, 99)
      log('backfill.activities', { page: start / 99, rows: got })
      if (got < 99) { await setState(c.db, 'bf.activities', 'done'); break }
      await setState(c.db, 'bf.activities', String(start + 99))
      if (out()) return 'paused'
    }
  }
  const floor = (await c.db.all<{ d: string }>('SELECT MIN(substr(start_local,1,10)) d FROM activities'))[0]?.d
  if (!floor) return 'done'
  // 2. wellness series from the first activity date, newest window first
  for (const s of SERIES) {
    const key = `bf.${s.name}`
    const saved = await getState(c.db, key)
    let total = 0
    for (const [from, to] of windows(floor, saved ? addDays(saved, -1) : c.today, WINDOW[s.name])) {
      total += await loadSeries(c, s, from, to)
      await setState(c.db, key, from)
      if (out()) { log(`backfill.${s.name}`, { rows: total, paused: 'yes' }); return 'paused' }
    }
    log(`backfill.${s.name}`, { rows: total })
  }
  return 'done'
}
