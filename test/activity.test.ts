import { describe, expect, it } from 'vitest'
import { buildDetail, downsample, efficiency, route, splits } from '../src/metrics/activity.js'

// Synthetic run: 1 Hz, speed 3 m/s, heart rate rising by `drift` bpm per minute after warm-up.
const run = (secs: number, drift = 0, speed = (_: number) => 3) => {
  const t = Array.from({ length: secs }, (_, i) => i)
  return { t, hr: t.map((i) => 140 + (drift * i) / 60), speed: t.map(speed), alt: t.map(() => 10), cad: t.map(() => 170), pwr: t.map(() => null), lat: t.map((i) => 50 + i * 1e-5), lon: t.map(() => 8), dist: t.map((i) => i * 3) }
}

describe('downsample, route, splits', () => {
  it('caps length, averages buckets, keeps null buckets', () => {
    expect(downsample(Array.from({ length: 1000 }, (_, i) => i), 300).length).toBe(300)
    expect(downsample([1, 3, null, null], 2)).toEqual([2, null])
    expect(downsample([1.234, null], 5, 1)).toEqual([1.2, null])
    expect(route([1, null, 3, 4], [1, 1, 3, 4], 2)).toEqual([[1, 1], [4, 4]])
  })
  it('one split per full kilometre', () => {
    const sp = splits(run(3100))
    expect(sp.length).toBe(9); expect(sp[0]).toMatchObject({ km: 1, s: 334 }); expect(sp[1].s).toBe(333)
    expect(splits({ t: [0, 1], hr: [null, null], dist: [null, null] })).toEqual([])
  })
})

describe('efficiency and decoupling', () => {
  it('flat heart rate gives zero decoupling and a known EF', () => {
    const e = efficiency(run(3000))
    expect(e.why).toBe('ok'); expect(e.decoupling).toBeCloseTo(0, 1); expect(e.ef).toBeCloseTo((3 * 60) / 140, 2)
  })
  it('rising heart rate at constant pace shows positive drift', () => {
    const e = efficiency(run(3000, 0.3))
    expect(e.decoupling!).toBeGreaterThan(3); expect(e.decoupling!).toBeLessThan(10)
  })
  it('refuses short, variable and heart-rate-less runs', () => {
    expect(efficiency(run(1500))).toMatchObject({ ef: null, decoupling: null, why: 'short' })
    expect(efficiency(run(3000, 0, (i) => (Math.floor(i / 120) % 2 ? 4.5 : 2.5)))).toMatchObject({ ef: null, why: 'variable' })
    expect(efficiency({ ...run(3000), hr: run(3000).hr.map(() => null) })).toMatchObject({ why: 'no_hr' })
  })
  it('a 30 minute steady run gets EF but no decoupling', () => {
    const e = efficiency(run(2000)); expect(e.ef).not.toBeNull(); expect(e.decoupling).toBeNull(); expect(e.why).toBe('short')
  })
  it('buildDetail stays under 300 points', () => {
    const d = buildDetail(run(7200)); expect(d.hr.length).toBe(300); expect(d.speed.length).toBe(300); expect(d.route.length).toBe(200)
  })
})
