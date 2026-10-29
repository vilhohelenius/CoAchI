import { describe, expect, it } from 'vitest'
import { bestDistance, bestPower, bestRows, bestTime, criticalSpeed, fitness, predictions, riegel, runEfforts, vo2From, type S } from '../src/metrics/records.js'

const run = (secs: number, speed: (i: number) => number, hr = (_: number) => 150): S => {
  const t = Array.from({ length: secs }, (_, i) => i); let d = 0
  const dist = t.map((i) => (i ? (d += speed(i)) : 0))
  return { t, dist, pwr: t.map(() => 250), hr: t.map(hr), alt: t.map(() => 100) }
}

describe('best efforts', () => {
  it('constant speed gives the exact time', () => {
    const s = run(3000, () => 4)
    expect(bestTime(s.t, s.dist, 1000)).toBeCloseTo(250, 6)
    expect(bestDistance(s.t, s.dist, 360)).toBeCloseTo(1440, 6)
    expect(bestPower(s.t, s.pwr, 300)).toBe(250)
  })
  it('finds the fast stretch inside a slower run', () => {
    const s = run(2400, (i) => (i > 900 && i <= 1200 ? 5 : 3))
    expect(bestTime(s.t, s.dist, 1000)).toBeCloseTo(200, 6)
  })
  it('ignores a GPS jump', () => {
    const s = run(1200, () => 3)
    for (let i = 600; i < 1200; i++) s.dist[i]! += 800 // 800 m teleport at 600 s
    expect(bestTime(s.t, s.dist, 1000)).toBeCloseTo(333.3333, 3) // the jump does not shorten any window
  })
  it('does not bridge a pause', () => {
    const s = run(800, () => 4), t = s.t.map((x) => (x! >= 400 ? x! + 120 : x)) // 2 minute recording gap at 400 s
    expect(bestTime(t, s.dist, 1700)).toBeNull() // each half holds about 1600 m
    expect(bestTime(t, s.dist, 1500)).toBeCloseTo(375, 6)
  })
  it('too-short data yields nothing', () => {
    const s = run(100, () => 4); s.pwr = s.pwr.map(() => null)
    expect(runEfforts(s)).toEqual({})
    expect(runEfforts(run(100, () => 4)).p60).toBeDefined() // 100 s is enough for 1 minute of power only
  })
  it('rejects impossible speeds', () => {
    const s = run(300, () => 11)
    expect(bestTime(s.t, s.dist, 1000)).toBeNull()
  })
  it('power needs gap-free samples', () => {
    const s = run(600, () => 3); s.pwr[300] = null
    expect(bestPower(s.t, s.pwr, 600)).toBeNull()
    expect(bestPower(s.t, s.pwr, 200)).toBe(250)
  })
  it('keeps top 3 and the PB history', () => {
    const rows = [[1, '2030-01-01', 300], [2, '2030-02-01', 310], [3, '2030-03-01', 290], [4, '2030-04-01', 295], [5, '2030-05-01', 280], [6, '2030-06-01', 305]]
      .map(([id, date, value]) => ({ id: id as number, date: date as string, value: value as number, label: '5k', n: null }))
    const b = bestRows(rows)
    expect(b.filter((x) => x.rank).map((x) => [x.rank, x.id])).toEqual(expect.arrayContaining([[1, 5], [2, 3], [3, 4]]))
    expect(b.filter((x) => x.is_pb).map((x) => x.id)).toEqual([1, 3, 5])
    expect(b.some((x) => x.id === 6)).toBe(false)
  })
})

describe('critical speed', () => {
  it('recovers CS and D from an exact hyperbola', () => {
    const f = criticalSpeed([180, 360, 720, 1200].map((T) => [T, 3.8 * T + 210] as [number, number]))
    expect(f).toMatchObject({ ok: true, n: 4 }); if (f.ok) { expect(f.cs).toBeCloseTo(3.8, 9); expect(f.dprime).toBeCloseTo(210, 6); expect(f.r2).toBeCloseTo(1, 9) }
  })
  it('hides with fewer than 3 points or a poor fit', () => {
    expect(criticalSpeed([[180, 800], [360, 1500]])).toMatchObject({ ok: false, reason: 'few' })
    expect(criticalSpeed([[180, 900], [360, 1000], [720, 2900], [1200, 3000]])).toMatchObject({ ok: false, reason: 'poor' })
  })
})

describe('riegel and prediction', () => {
  it('known values', () => {
    expect(riegel(1200, 5000, 10000, 1)).toBeCloseTo(2400, 9)
    expect(riegel(1200, 5000, 10000)).toBeCloseTo(1200 * 2 ** 1.06, 6)
  })
  it('range, flags and CS cross-check', () => {
    const src = [{ label: '5k', dist_m: 5000, time_s: 1200, date: '2030-01-01' }]
    const p = predictions(src, '2030-06-01', 1.06, { cs: 4, dprime: 200 })
    const by = Object.fromEntries(p.map((x) => [x.label, x]))
    expect(by['10k'].lo_s!).toBeLessThan(by['10k'].point_s!); expect(by['10k'].hi_s!).toBeGreaterThan(by['10k'].point_s!)
    expect(by.marathon.point_s!).toBeGreaterThan(by.hm.point_s!)
    expect(by['10k'].flags).toEqual(['old']); expect(by.marathon.flags).toEqual(['old', 'short'])
    expect(by['10k'].cs_s).toBeCloseTo(2450, 6); expect(by.hm.cs_s).toBeNull()
    expect(predictions([], '2030-06-01', 1.06, null)[0].point_s).toBeNull()
  })
})

describe('vo2 estimate', () => {
  it('ACSM over %HRR', () => {
    expect(vo2From(150, 3, { rest: 50, max: 190 })).toBeCloseTo(3.5 + (0.2 * 180) / (100 / 140), 9)
    expect(vo2From(60, 3, { rest: 50, max: 190 })).toBeNull() // too easy to extrapolate
  })
  it('steady synthetic runs give a stable median, none when too few', () => {
    const s = run(1800, () => 3, () => 150), e = runEfforts(s)
    expect(e.ss_hr[1]).toBeGreaterThan(0); expect(e.ss_v[0]).toBeCloseTo(3, 6)
    const rows = (ids: number[]) => ids.flatMap((id) => [{ id, label: 'ss_hr', value: 150, n: 4, date: `2030-05-${10 + id}` }, { id, label: 'ss_v', value: 3, n: 4, date: `2030-05-${10 + id}` }])
    const f = fitness(rows([1, 2, 3, 4]), () => ({ rest: 50, max: 190 }), '2030-06-01')
    expect(f.vo2.n).toBe(4); expect(f.vo2.value).toBeCloseTo(3.5 + 36 / (100 / 140), 6); expect(f.vo2.history).toHaveLength(26)
    expect(fitness(rows([1, 2]), () => ({ rest: 50, max: 190 }), '2030-06-01').vo2.value).toBeNull()
    expect(fitness(rows([1, 2, 3]), () => null, '2030-06-01').vo2.n).toBe(0)
  })
  it('a run with a hill or erratic pace is not steady', () => {
    const wobble = run(1800, (i) => (Math.floor(i / 60) % 2 ? 2.4 : 3.6))
    expect(runEfforts(wobble).ss_v).toBeUndefined()
    const hill = run(1800, () => 3); hill.alt = hill.t.map((i) => 100 + i! * 0.2)
    expect(runEfforts(hill).ss_v).toBeUndefined()
  })
})
