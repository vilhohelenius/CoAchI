import { describe, expect, it } from 'vitest'
import { LocalStore } from '../sync/store.js'
import { recompute } from '../sync/recompute.js'
import { acwr, activityLoad, loadSeries, project, ramp, sportOf, type Zones } from '../src/metrics/load.js'
import { divergence, hrvDay, streaks } from '../src/metrics/hrv.js'
import { composition, consistency, debt, type Night } from '../src/metrics/sleep.js'
import { readiness } from '../src/metrics/readiness.js'
import { trainingStatus } from '../src/metrics/status.js'
import { goals } from '../src/metrics/goals.js'
import { addDays } from '../src/metrics/dates.js'

const Z: Zones = { lthr: 170, max_hr: 190, rest_hr: 50, floors: [100, 120, 140, 160, 175] }

describe('load', () => {
  it('one hour at LTHR is 100, easier is less, RPE and strength fall back', () => {
    const a = { type: 'running', duration_s: 3600, avg_hr: 170, zone_s: [null, null, null, null, null], rpe: null }
    expect(activityLoad(a, Z)).toEqual({ load: expect.closeTo(100, 6), source: 'avg_hr' })
    expect(activityLoad({ ...a, avg_hr: 120 }, Z).load).toBeCloseTo(29.4, 0)
    expect(activityLoad({ ...a, avg_hr: null }, Z)).toMatchObject({ source: 'rpe', load: expect.closeTo(44.4, 1) }) // default RPE 5: (5/7.5)^2 * 100
    expect(activityLoad({ type: 'strength_training', duration_s: 1800, avg_hr: 150, zone_s: [], rpe: 50 }, Z)).toMatchObject({ source: 'rpe', load: expect.closeTo(22.2, 1) })
    expect(activityLoad({ ...a, zone_s: [0, 0, 3600, 0, 0] }, Z).source).toBe('zones')
    expect(sportOf('treadmill_running')).toBe('run')
  })
  it('CTL, ATL and TSB follow the 42 and 7 day recursion', () => {
    const [d0, d1] = loadSeries([100, 0])
    expect(d0.ctl).toBeCloseTo(2.35, 2); expect(d0.atl).toBeCloseTo(13.31, 2); expect(d0.tsb).toBe(0)
    expect(d1.tsb).toBeCloseTo(-10.96, 2); expect(d1.ctl).toBeCloseTo(2.3, 1); expect(d1.atl).toBeCloseTo(11.54, 2)
  })
  it('ACWR is acute 7d over the prior 28d and needs 35 days', () => {
    const l = [...Array(28).fill(10), ...Array(7).fill(20)]
    expect(acwr(l, 34)).toBeCloseTo(2, 6)
    expect(acwr(l, 33)).toBeNull()
    expect(acwr(Array(35).fill(0), 34)).toBeNull()
    expect(ramp([1, 2, 3, 4, 5, 6, 7, 9], 7)).toBe(8)
  })
  it('projection at rest decays and matches the recursion', () => {
    const [p] = project(40, 50, [0])
    expect(p.tsb).toBe(-10); expect(p.ctl).toBeCloseTo(40 * Math.exp(-1 / 42), 6)
  })
})

describe('hrv', () => {
  const ln = [...Array(23).keys()].map((i) => (i % 2 ? 4.1 : 3.9)).concat(Array(7).fill(3.6)) // 30 days, base of 29 before the last
  const hrv = ln.map((x) => Math.exp(x))
  it('baseline, band and status', () => {
    const h = hrvDay(hrv, hrv.map(() => null), 29)
    expect(h.n_base).toBe(29)
    expect(h.base_mean).toBeCloseTo(50.09, 1); expect(h.low).toBeCloseTo(41.56, 1); expect(h.high).toBeCloseTo(60.36, 1)
    expect(h.z_hrv).toBeCloseTo(-1.68, 2); expect(h.status).toBe('below'); expect(h.range_ok).toBe(false)
    expect(h.divergence).toBeNull()
  })
  it('needs 21 baseline nights', () => { expect(hrvDay(hrv, hrv.map(() => null), 15).z_hrv).toBeNull() })
  it('divergence table and strain from a real series', () => {
    expect(divergence(-1.2, 1.1)).toBe('strain'); expect(divergence(-1.2, 0)).toBe('hrv_dip'); expect(divergence(0, 1.5)).toBe('rhr_rise')
    expect(divergence(1.3, -1.2)).toBe('recovered'); expect(divergence(1.3, 0)).toBe('hrv_high'); expect(divergence(0.2, 0.1)).toBe('normal'); expect(divergence(null, 1)).toBeNull()
    const rhr = [...Array(23).keys()].map((i) => (i % 2 ? 52 : 50)).concat(Array(7).fill(60))
    expect(hrvDay(hrv, rhr, 29).divergence).toBe('strain')
  })
  it('streak counts consecutive balanced days', () => { expect(streaks([true, true, null, true, false, true, true, true])).toEqual([1, 2, 0, 1, 0, 1, 2, 3]) })
})

describe('sleep', () => {
  const night = (date: string, h: number, startH = 22): Night => ({ date, start_ts: Date.parse(`${addDays(date, -1)}T${String(startH).padStart(2, '0')}:00:00Z`), end_ts: Date.parse(`${addDays(date, -1)}T${String(startH).padStart(2, '0')}:00:00Z`) + h * 3.6e6,
    total_s: h * 3600, deep_s: h * 600, light_s: h * 1800, rem_s: h * 900, awake_s: h * 300, score: null })
  const ns = Array.from({ length: 14 }, (_, i) => night(addDays('2030-03-01', i), i % 2 ? 7 : 9))
  it('debt counts shortfall fully and surplus at half', () => {
    // 7 nights of 7 h (-1 each) and 7 nights of 9 h (+1 each at 50%): 7 - 3.5
    expect(debt(ns, '2030-03-14').debt_h).toBeCloseTo(3.5, 6)
    expect(debt(ns.slice(0, 5), '2030-03-14').debt_h).toBeNull()
  })
  it('consistency is the SD of midpoints and handles midnight wrap', () => {
    const w = [19, 20, 21, 22].map((h, i) => night(addDays('2030-03-10', i), 8, h)) // midpoints 23:00, 00:00, 01:00, 02:00 cross midnight
    expect(consistency(w, '2030-03-13').sd_min).toBeCloseTo(Math.sqrt((1.5 ** 2 * 2 + 0.5 ** 2 * 2) / 3) * 60, 4)
    expect(consistency(w.slice(0, 2), '2030-03-13').sd_min).toBeNull()
  })
  it('composition shares sum to 1', () => {
    const c = composition(ns, '2030-03-14')
    expect(Object.values(c.share!).reduce((s, x) => s + x, 0)).toBeCloseTo(1, 9); expect(c.share!.deep).toBeCloseTo(600 / 3600, 6)
  })
})

describe('readiness', () => {
  const none = { hrv: null, rhr: null, sleep: null, debt: null, load: null, bb_max: null }
  it('weights renormalise over what exists', () => {
    const r = readiness({ ...none, hrv: { z7: 0, z_last: 0, n: 40 }, sleep: { total_s: 7.2 * 3600, score: 80, need_h: 8 } })
    expect(r.score).toBeCloseTo(76, 6) // (30*70 + 20*85) / 50
    expect(r.confidence).toBe('low'); expect(r.n_components).toBe(2)
  })
  it('old sleep without a score uses duration only, nothing at all gives null', () => {
    expect(readiness({ ...none, sleep: { total_s: 8 * 3600, score: null, need_h: 8 } }).score).toBe(100)
    const r = readiness(none)
    expect(r.score).toBeNull(); expect(r.confidence).toBe('none'); expect(r.components.every((c) => !c.available && c.n === 0)).toBe(true)
  })
  it('load needs 28 days, injury caps at 50, high ACWR subtracts 10', () => {
    expect(readiness({ ...none, load: { tsb: 0, acwr: 1, days: 10 } }).components.find((c) => c.key === 'load')!.available).toBe(false)
    expect(readiness({ ...none, load: { tsb: 0, acwr: 1.6, days: 60 } }).score).toBe(60)
    const r = readiness({ ...none, bb_max: 90, injury: true })
    expect(r.score).toBe(50); expect(r.capped).toBe(true)
  })
})

describe('status', () => {
  const base = { days: 100, ctl: 40, ctl7: 38, atl: 45, atl7: 44, tsb: -5, acwr: 1.1, hard_share: 0.2 }
  it('labels', () => {
    expect(trainingStatus(base).label).toBe('Productive')
    expect(trainingStatus({ ...base, ctl7: 39.5, ctl28: 39 }).label).toBe('Maintaining')
    expect(trainingStatus({ ...base, ctl28: 36 }).label).toBe('Productive')
    expect(trainingStatus({ ...base, acwr: 1.7 }).label).toBe('Productive')
    expect(trainingStatus({ ...base, tsb: -35 }).label).toBe('Overreaching')
    expect(trainingStatus({ ...base, tsb: -22, hard_share: 0.4 }).label).toBe('Overreaching')
    expect(trainingStatus({ ...base, ctl7: 44, atl: 20, atl7: 50 }).label).toBe('Recovery')
    expect(trainingStatus({ ...base, ctl: 30, ctl7: 40, atl: 20, atl7: 25 }).label).toBe('Detraining')
    expect(trainingStatus({ ...base, days: 10 }).label).toBe('Not enough data')
  })
})

describe('goals', () => {
  const run_m = { '2030-01-10': 5000, '2030-02-26': 5000, '2030-03-05': 12000, '2030-03-12': 8000 }
  const g = { today: '2030-03-14', year_km: 100, band_lo: 10, band_hi: 20, steps_goal: 1000, run_m, steps: { '2030-03-14': 500, '2030-03-13': 1000, '2030-03-12': 1200, '2030-03-11': 900 } }
  it('yearly pace, projection and weekly band', () => {
    const r = goals(g)
    expect(r.year).toMatchObject({ ytd_km: 30, expected_km: 20, status: 'ahead', projected_km: 160.4 })
    expect(goals({ ...g, year_km: 300 }).year.status).toBe('behind')
    expect(goals({ ...g, year_km: 150 }).year.status).toBe('on_pace')
    expect(r.week).toMatchObject({ km: 8, status: 'on_pace', week_start: '2030-03-11' })
    expect(r.week.previous.map((w) => w.status)).toEqual(['in_band', 'below_band', 'below_band', 'below_band'])
  })
  it('steps streak is calendar days and today stays pending until reached', () => {
    expect(goals(g).steps).toMatchObject({ streak_days: 2, today_pending: true })
    expect(goals({ ...g, steps: { ...g.steps, '2030-03-14': 1000 } }).steps).toMatchObject({ streak_days: 3, today_pending: false })
    expect(goals({ ...g, steps: { ...g.steps, '2030-03-12': 0 } }).steps.streak_days).toBe(1)
  })
})

describe('recompute', () => {
  const today = '2030-06-30'
  function seed() {
    const db = new LocalStore(':memory:'); db.migrate('migrations')
    const st = [["INSERT INTO hr_zones (effective_date,sport,lthr,max_hr,rest_hr,z1,z2,z3,z4,z5) VALUES ('2030-01-01','RUNNING',170,190,50,100,120,140,160,175)"]] as [string, unknown[]?][]
    for (let i = 0; i < 120; i++) {
      const d = addDays(today, -i)
      if (i % 2 === 0) st.push(['INSERT INTO activities (id,start_local,type,distance_m,duration_s,avg_hr) VALUES (?,?,?,?,?,?)', [i + 1, `${d} 07:00:00`, 'running', 8000, 2700, 150]])
      st.push(['INSERT INTO daily_summary (date,steps,rhr) VALUES (?,?,?)', [d, 9000 + i, 50 + (i % 3)]])
      if (i < 90) st.push(['INSERT INTO hrv_daily (date,last_night_avg) VALUES (?,?)', [d, 55 + (i % 5)]])
    }
    return db.batch(st).then(() => db)
  }
  const snap = async (db: LocalStore) => JSON.stringify([await db.all('SELECT * FROM load_daily ORDER BY date'), await db.all('SELECT * FROM metric_daily ORDER BY date,key'), await db.all('SELECT id,load,load_source FROM activities ORDER BY id')])
  it('is idempotent, and incremental equals full', async () => {
    const db = await seed()
    await recompute(db, today, true)
    const a = await snap(db)
    await recompute(db, today, true); expect(await snap(db)).toBe(a)
    await recompute(db, today); expect(await snap(db)).toBe(a)
    const [l] = await db.all<any>('SELECT * FROM load_daily WHERE date=?', [today])
    expect(l.ctl).toBeGreaterThan(0); expect(l.status).toBeTruthy()
    const r = await db.all<any>(`SELECT value FROM metric_daily WHERE key='readiness' AND date=?`, [today])
    expect(r[0].value).toBeGreaterThan(0)
  })
})
