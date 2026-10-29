import { describe, expect, it } from 'vitest'
import { render } from 'preact-render-to-string'
import { h } from 'preact'
import { LoadView } from '../src/load'
import { RecoveryView } from '../src/recovery'
import { IntensityView } from '../src/intensity'
import { GoalsView } from '../src/goals'
import load from '../fixtures/load.json'
import recovery from '../fixtures/recovery.json'
import intensity from '../fixtures/intensity.json'
import goals from '../fixtures/goals.json'

const text = (html: string) => html.replace(/<[^>]*>/g, ' ')
const clean = (html: string) => { expect(text(html)).not.toMatch(/null|NaN|undefined|[—;]/) }
const noop = () => {}

describe('page renders', () => {
  it('Load, normal and sparse', () => {
    const html = render(h(LoadView, { d: load as never, range: '90', setRange: noop, daily: null, setDaily: noop }))
    for (const s of ['Productive', 'Fitness and fatigue, 90 days', 'Running', 'Cycling', 'Fewer than 5 sessions', 'Next 21 days', 'Fitness on day 21']) expect(html).toContain(s)
    clean(html)
    const bare = render(h(LoadView, { d: { as_of: 'x', days: [{ date: '2030-06-01', load: null, ctl: null, atl: null, tsb: null, tsb_end: null, acwr: null, ramp7: null, status: null, warming_up: 1 }] }, range: 'all', setRange: noop, daily: 40, setDaily: noop }))
    expect(bare).toContain('The projection is not available yet'); clean(bare)
    expect(render(h(LoadView, { d: { as_of: 'x', days: [] }, range: '90', setRange: noop, daily: null, setDaily: noop }))).toContain('Nothing here yet')
  })
  it('Recovery, normal and sparse', () => {
    const html = render(h(RecoveryView, { d: recovery as never }))
    for (const s of ['HRV against your normal', 'In balance', 'Sleep debt', 'Consistency', 'Body battery', 'class="sr"']) expect(html).toContain(s)
    clean(html)
    const bare = render(h(RecoveryView, { d: { as_of: 'x', days: [{ date: '2030-06-01' }] } }))
    expect(bare).toContain('Not enough readings'); clean(bare)
  })
  it('Intensity, normal and sparse', () => {
    const html = render(h(IntensityView, { d: intensity as never, sel: 'all', setSel: noop }))
    for (const s of ['Zone 1', 'Easy 78%', 'On target', 'Running', 'Cycling']) expect(html).toContain(s)
    clean(html)
    const bare = render(h(IntensityView, { d: { as_of: 'x', weeks: [{ week_start: '2030-05-27', minutes: { run: [5, 0, 0, 0, 0] } }], share_28d: { all: null, by_sport: {}, easy_target: [0.75, 0.85] } }, sel: 'all', setSel: noop }))
    expect(bare).toContain('No heart rate zone time in the last 28 days'); clean(bare)
    expect(render(h(IntensityView, { d: { as_of: 'x', weeks: [] }, sel: 'all', setSel: noop }))).toContain('Nothing here yet')
  })
  it('Goals, normal and sparse', () => {
    const html = render(h(GoalsView, { g: goals as never }))
    for (const s of ['on pace', 'ahead of pace', 'below the band', 'above the band', 'In a row at goal', '30-day average']) expect(html).toContain(s)
    clean(html)
    const bare = render(h(GoalsView, { g: { as_of: 'x', data_date: '2030-06-01', progress: { steps: { goal: 10000, today: null, streak_days: 0, today_pending: true, hit_30d: 0, avg_7d: null, status: 'behind' } } } }))
    expect(bare).toContain('No steps recorded yet today'); clean(bare)
    expect(render(h(GoalsView, { g: { as_of: 'x', progress: null } }))).toContain('No goals yet')
  })
})
