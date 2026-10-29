import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { LocalStore } from '../sync/store.js'
import { setSink } from '../sync/log.js'
import { routesStage } from '../sync/routes.js'
import { groupRoutes, type RouteRun } from '../src/metrics/routes.js'

describe('routes stage', () => {
  it('writes one compact file: rounded, downsampled, start point, every sport with a route, tagged', async () => {
    setSink(() => {})
    const db = new LocalStore(':memory:'); db.migrate('migrations')
    const dir = mkdtempSync(`${tmpdir()}/coachi-`); mkdirSync(`${dir}/detail`)
    const ins = (id: number, type: string, fit: string) => db.batch([['INSERT INTO activities (id,start_local,type,distance_m,duration_s,fit_status) VALUES (?,?,?,?,?,?)', [id, `2030-05-0${id} 07:00:00`, type, 5000.4, 1500.6, fit]]])
    await ins(1, 'running', 'ok'); await ins(2, 'running', 'ok'); await ins(3, 'cycling', 'ok'); await ins(4, 'running', 'none'); await ins(5, 'running', 'ok')
    const line = Array.from({ length: 200 }, (_, i) => [12.3456789 + i * 1e-4, 56.7891234 + i * 1e-4])
    writeFileSync(`${dir}/detail/1.json`, JSON.stringify({ route: line })); writeFileSync(`${dir}/detail/2.json`, JSON.stringify({ route: [[1, 1]] })); writeFileSync(`${dir}/detail/3.json`, JSON.stringify({ route: line }))
    await routesStage(db, dir) // 5 has no detail file, 2 has a single point, 4 has no fit; 3 is a ride
    const f = JSON.parse(readFileSync(`${dir}/routes/all.json`, 'utf8'))
    expect(f.v).toBe(1); expect(f.runs.map((r: unknown[]) => [r[0], r[6]])).toEqual([[1, 'run'], [3, 'bike']])
    const [id, date, dist, dur, start, pts] = f.runs[0]
    expect([id, date, dist, dur, start]).toEqual([1, '2030-05-01', 5000, 1501, [12.3457, 56.7891]])
    expect(pts.length).toBe(160); expect(pts.slice(0, 2)).toEqual([12.3457, 56.7891]); expect(pts.at(-2)).toBe(12.3656)
    expect(pts.every((x: number) => Math.round(x * 1e4) / 1e4 === x)).toBe(true)
  })

  it('with R2 it keeps the existing file and adds only the new activities, detail from R2', async () => {
    setSink(() => {})
    const db = new LocalStore(':memory:'); db.migrate('migrations')
    const dir = mkdtempSync(`${tmpdir()}/coachi-`)
    for (const id of [1, 2]) await db.batch([['INSERT INTO activities (id,start_local,type,distance_m,duration_s,fit_status) VALUES (?,?,?,?,?,?)', [id, `2030-05-0${id} 07:00:00`, 'running', 5000, 1500, 'ok']]])
    const old = [1, '2030-05-01', 1, 1, [1, 1], [1, 1, 2, 2], 'run']
    const store: Record<string, string> = { 'routes/all.json': JSON.stringify({ v: 1, runs: [old] }), 'detail/2.json': JSON.stringify({ route: [[3, 3], [3.001, 3.001]] }) }
    const r2 = { get: async (k: string) => (store[k] ? Buffer.from(store[k]) : null), put: async (k: string, b: Uint8Array) => { store[k] = Buffer.from(b).toString() } }
    await routesStage(db, dir, r2 as never)
    const f = JSON.parse(store['routes/all.json'])
    expect(f.runs.map((r: unknown[]) => r[0])).toEqual([1, 2]); expect(f.runs[0]).toEqual(old)
  })
})

describe('route groups', () => {
  const run = (id: number, date: string, d: number, t: number, lat = 12.34, lon = 56.78): RouteRun => [id, date, d, t, [lat, lon], []]
  it('groups by start within 150 m and distance within 5%, oldest first, repeated routes only', () => {
    const rs = [run(4, '2030-04-04', 5100, 1400), run(1, '2030-04-01', 5000, 1500), run(2, '2030-04-02', 5200, 1450), // 5200 is 4% over the first run, joins
      run(3, '2030-04-03', 5300, 1450), // 6% over, own group
      run(5, '2030-04-05', 5000, 1490, 12.3413, 56.78), // 144 m north: joins
      run(6, '2030-04-06', 5000, 1490, 12.3415, 56.78), // 167 m north: own start
      run(7, '2030-04-07', 800, 300), run(8, '2030-04-08', 800, 290), // under 1 km never grouped
      run(9, '2030-04-09', 10000, 3000, 12.4, 56.9), run(10, '2030-04-10', 10100, 2900, 12.4, 56.9)]
    const g = groupRoutes(rs)
    expect(g.map((x) => [x.n, x.med_m, x.best[0], x.last[0]])).toEqual([[4, 5100, 4, 5], [2, 10100, 10, 10]])
    expect(groupRoutes(rs)).toEqual(g); expect(groupRoutes([...rs].reverse())).toEqual(g) // input order does not matter
    expect(groupRoutes([run(1, '2030-04-01', 5000, 1500)])).toEqual([])
  })
})
