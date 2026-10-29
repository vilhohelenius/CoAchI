import { describe, expect, it } from 'vitest'
import { render } from 'preact-render-to-string'
import { h } from 'preact'
import { LineChart, StackedBars, bandPath, extent, linePath, scale, stack, summarize, ticks } from '../src/chart'
import { project } from '../src/load'
import load from '../fixtures/load.json'

describe('chart helpers', () => {
  it('scales, including a flat domain', () => {
    const s = scale(0, 10, 100, 0)
    expect([s(0), s(5), s(10)]).toEqual([100, 50, 0])
    expect(scale(3, 3, 0, 100)(3)).toBe(50)
  })
  it('extent and ticks', () => {
    expect(extent([1, null, 5], [3])).toEqual([1, 5])
    expect(extent([null], [])).toBeNull()
    expect(ticks(0, 100, 4)).toEqual([0, 50, 100])
    expect(ticks(7, 7)).toEqual([7])
  })
  it('builds paths with gaps, single points and empty series', () => {
    expect(linePath([0, 10, 20], [1, 2, 3])).toBe('M0.0 1.0L10.0 2.0L20.0 3.0')
    expect(linePath([0, 10, 20, 30], [1, null, 3, 4])).toBe('M0.0 1.0l0 0M20.0 3.0L30.0 4.0')
    expect(linePath([5], [9])).toBe('M5.0 9.0l0 0')
    expect(linePath([], [])).toBe('')
    expect(bandPath([0, 10, 20], [1, 1, null], [2, 2, 2])).toMatch(/^M0.0 2.0L10.0 2.0L10.0 1.0L0.0 1.0Z$/)
    expect(bandPath([0], [1], [2])).toBe('')
  })
  it('stacks, ignoring nulls and negatives', () => {
    expect(stack([2, null, 3, -1])).toEqual([[0, 2], [2, 2], [2, 5], [5, 5]])
  })
  it('summarises for screen readers', () => {
    expect(summarize('HRV', ['2030-06-01'], [null])).toBe('HRV: no data.')
    expect(summarize('HRV', ['2030-05-31', '2030-06-01'], [50, 52], String, ' ms')).toBe('HRV: latest 52 ms on 1 June, from 2 readings.')
  })
})

describe('chart components', () => {
  const d = ['2030-05-30', '2030-05-31', '2030-06-01']
  it('render empty, single point and normal series without NaN', () => {
    for (const v of [[], [4], [1, null, 3]]) {
      const html = render(h(LineChart, { dates: d.slice(0, v.length), series: [{ name: 'A', v, c: 'red' }], label: 'x', summary: 'sum' }))
      expect(html).not.toMatch(/NaN|undefined|null/)
      expect(html).toContain(v.length ? 'class="sr"' : 'class="empty"')
    }
    const bars = render(h(StackedBars, { dates: d, stacks: [{ name: 'A', c: 'red' }, { name: 'B', c: 'blue' }], vals: [[1, 2], [null, 0], [3, 1]], label: 'x', summary: 'sum' }))
    expect(bars.match(/<rect/g)?.length).toBe(4)
    expect(render(h(StackedBars, { dates: [], stacks: [], vals: [], label: 'x', summary: 'No data.' }))).toContain('No data.')
  })
  it('projection matches the server numbers', () => {
    const p = load.projection, mine = project(p.ctl, p.atl, Array(21).fill(0))
    expect(mine[0].ctl).toBeCloseTo(p.rest[0].ctl, 1); expect(mine[20].tsb).toBeCloseTo(p.rest[20].tsb, 1)
  })
})
