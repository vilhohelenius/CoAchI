import { describe, expect, it } from 'vitest'
import { MIN_N, correlate, pearson, report } from '../src/metrics/correlations.js'
import { addDays } from '../src/metrics/dates.js'

const days = (n: number, f: (i: number) => number) => Array.from({ length: n }, (_, i) => ({ date: addDays('2030-01-01', i), v: f(i) }))
const noise = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296)

describe('correlations', () => {
  it('pearson known values', () => {
    expect(pearson([1, 2, 3, 4], [2, 4, 6, 8])).toBeCloseTo(1); expect(pearson([1, 2, 3], [3, 2, 1])).toBeCloseTo(-1); expect(pearson([1, 1, 1], [1, 2, 3])).toBeNaN()
  })
  it('refuses below the minimum n', () => {
    const x = days(MIN_N - 1, (i) => i), c = correlate(x, x, 0)
    expect(c).toMatchObject({ n: MIN_N - 1, status: 'not_enough_data' }); expect('r' in c).toBe(false)
  })
  it('recovers a planted lag-1 relation and respects the lag', () => {
    const rnd = noise(1), x = days(80, () => rnd()), y = days(80, (i) => (i ? x[i - 1].v * 2 + rnd() * 0.2 : 0))
    expect(correlate(x, y, 1)).toMatchObject({ n: 79, status: 'strong_double_check' })
    expect((correlate(x, y, 1) as any).ci[0]).toBeGreaterThan(0.8)
    expect((correlate(x, y, 0) as any).status).not.toBe('strong_double_check')
  })
  it('independent noise gives no clear link almost always, and a random walk does not look strong', () => {
    let hits = 0
    for (let s = 1; s <= 200; s++) { const a = noise(s), b = noise(s + 1000), c: any = correlate(days(60, () => a()), days(60, () => b()), 0); if (c.status !== 'no_clear_link') hits++ }
    expect(hits / 200).toBeLessThan(0.1)
    const a = noise(5), b = noise(6); let p = 0, q = 0
    const w1 = days(60, () => (p += a() - 0.5)), w2 = days(60, () => (q += b() - 0.5)), c: any = correlate(w1, w2, 0)
    expect(c.n_eff).toBeLessThan(c.n)
  })
  it('report keeps the fixed pair list and narrows by key', () => {
    expect(report({}).pairs.every((p) => p.status === 'not_enough_data')).toBe(true)
    expect(report({}, ['load']).pairs.map((p) => p.y)).toEqual(['hrv', 'rhr'])
  })
})
