import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { zipSync } from 'fflate'
import { Garmin } from '../sync/garmin.js'
import { D1Store, LocalStore } from '../sync/store.js'
import { backfill, fitStage, steadyActivities, steadyWellness, zones } from '../sync/stages.js'
import { setSink, log, logError, mask } from '../sync/log.js'
import { syntheticFit } from './synthetic-fit.js'

// Synthetic API: invented ids, dates and values.
const fake = {
  async get(ep: string, path: string, q: any = {}) {
    if (ep === 'activities') return q.start >= 99 ? [] : [{ activityId: 1, startTimeLocal: '2030-01-01 07:00:00', startTimeGMT: '2030-01-01 05:00:00', activityType: { typeKey: 'running' }, distance: 5000, duration: 1500, averageHR: 150, ownerDisplayName: 'x' },
      { activityId: 2, startTimeLocal: '2029-12-20 07:00:00', startTimeGMT: '2029-12-20 05:00:00', activityType: { typeKey: 'road_biking' }, distance: 20000 }]
    if (ep === 'daily') return { data: [{ calendarDate: '2030-01-01', movement: { steps: { value: 9000, goal: 10000 } }, heartRate: { restingValue: 50 } }] }
    if (ep === 'hrv') return { hrvSummaries: [{ calendarDate: '2030-01-01', lastNightAvg: 60, baseline: { balancedLow: 50 } }] }
    if (ep === 'sleep') return [{ calendarDate: '2030-01-01', sleepTimeSeconds: 27000, sleepScores: { overall: { value: 80 } } }]
    if (ep === 'bodybattery') return [{ date: '2030-01-01', charged: 50, drained: 40, bodyBatteryValuesArray: [[1, 20], [2, 80]] }]
    if (ep === 'stress') return [{ calendarDate: '2030-01-01', values: { overallStressLevel: 25 } }]
    if (ep === 'steps') return [{ calendarDate: '2030-01-01', totalSteps: 9000, totalDistance: 7000, stepGoal: 10000 }]
    if (ep === 'zones') return [{ sport: 'RUNNING', lactateThresholdHeartRateUsed: 170, maxHeartRateUsed: 190, restingHeartRateUsed: 50, zone1Floor: 100 }]
    if (ep === 'fit') return zipSync({ 'x.fit': syntheticFit() })
    return null
  },
} as unknown as Garmin

const tables = ['activities', 'activity_steps', 'daily_summary', 'sleep', 'hrv_daily', 'body_battery', 'stress', 'steps', 'hr_zones', 'goals']
const snap = async (db: LocalStore) => JSON.stringify(await Promise.all(tables.map((t) => db.all(`SELECT * FROM ${t} ORDER BY 1,2`))))

describe('stages are idempotent', () => {
  it('steady, zones, fit and backfill twice give identical rows', async () => {
    setSink(() => {})
    const db = new LocalStore(':memory:'); db.migrate('migrations')
    const c = { g: fake, db, today: '2030-01-02', outDir: mkdtempSync(`${tmpdir()}/coachi-`) }
    const once = async () => { await steadyActivities(c); await steadyWellness(c); await zones(c); await fitStage(c); expect(await backfill(c)).toBe('done') }
    await once(); const a = await snap(db)
    db.db.exec(`UPDATE activities SET fit_status='none'`) // force the FIT stage to run again
    await once(); expect(await snap(db)).toBe(a)
    const n = (t: string) => db.db.prepare(`SELECT COUNT(*) n FROM ${t}`).get() as { n: number }
    expect(n('activities').n).toBe(2); expect(n('activity_steps').n).toBe(13); expect(n('hr_zones').n).toBe(1); expect(n('goals').n).toBe(3)
    expect(await db.all(`SELECT fit_status s FROM activities WHERE id=1`)).toEqual([{ s: 'ok' }])
  })
})

describe('D1 REST adapter (mocked fetch)', () => {
  it('batches 100 statements per request, parses results, errors carry status only', async () => {
    const bodies: any[] = []
    const mk = (status: number) => new D1Store({ accountId: 'acc', dbId: 'db', token: 'tok-fixture', fetch: (async (_u: string, i: any) => {
      bodies.push(JSON.parse(i.body)); return new Response(JSON.stringify({ success: true, result: [{ results: [{ v: 1 }] }] }), { status })
    }) as never })
    const d1 = mk(200)
    await d1.batch(Array.from({ length: 250 }, () => ['INSERT INTO t VALUES (?)', [undefined]] as [string, unknown[]]))
    expect(bodies.map((b) => b.batch.length)).toEqual([100, 100, 50])
    expect(bodies[0].batch[0].params).toEqual([null])
    expect(await d1.all('SELECT 1')).toEqual([{ v: 1 }])
    await expect(mk(500).all('SELECT secret')).rejects.toThrow(/^d1 500$/)
  })
})

describe('logger', () => {
  it('never prints secrets, ids or error messages', () => {
    const out: string[] = []; setSink((s) => out.push(s))
    const secret = 'fixture-secret-jwt-abc123' /* gitleaks:allow */, id = '99887766', url = 'https://x.test/activity/99887766?d=2030-01-01'
    mask(secret)
    log(`stage_${id}`, { rows: 3, status: secret, [id]: 5, note: url, id: Number(id) * 0 })
    log(secret)
    logError('fit', Object.assign(new Error(`failed ${url} ${secret}`), { endpoint: 'fit', status: 500 }))
    logError('fit', new Error(`failed ${secret} ${id}`))
    const all = out.join('\n')
    for (const bad of [secret, id, url, 'failed']) expect(all).not.toContain(bad)
    expect(out[2]).toBe('fit error=yes status=500 endpoint=fit')
  })
})
