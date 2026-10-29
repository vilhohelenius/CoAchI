import { describe, expect, it } from 'vitest'
import { render } from 'preact-render-to-string'
import { h } from 'preact'
import { CoachPlanView, TodayView } from '../src/today'
import coachToday from '../fixtures/coach-today.json'
import { day, dur, km, num, pace, sgn, statusReason } from '../src/fmt'
import today from '../fixtures/today.json'
import load from '../fixtures/load.json'
import type { Today } from '../src/types'

describe('fmt', () => {
  it('formats and degrades on null', () => {
    expect(dur(27000)).toBe('7 h 30 min')
    expect(dur(2700)).toBe('45 min')
    expect(dur(null)).toBe('–')
    expect(pace(8000, 2700)).toBe('5:38')
    expect(pace(0, 10)).toBe('–')
    expect(km(8000)).toBe('8.0')
    expect(sgn(-7.7, 1)).toBe('−7.7')
    expect(sgn(2.4, 1)).toBe('+2.4')
    expect(num(NaN)).toBe('–')
    expect(day('2030-06-01 07:00:00', { day: 'numeric', month: 'short' })).toBe('1 Jun')
  })
  it('writes copy without em dashes or semicolons', () => {
    for (const label of ['Productive', 'Maintaining', 'Recovery', 'Overreaching', 'Detraining', 'Not enough data'])
      expect(statusReason({ label, acwr: 1.12, ramp7: 2.4, tsb: -7, warming_up: false })).not.toMatch(/[—;]/)
  })
})

const view = (d: unknown, load?: unknown) => render(h(TodayView, { d: d as Today, load: load as never }))

describe('Today render', () => {
  it('shows the fixture', () => {
    const html = view(today, load)
    for (const s of ['Productive', 'Morning run', '5:38', '82', 'Moderate', '4 of 5 signals used', 'No data today', 'Coach arrives in a later phase', 'on pace', 'ahead of pace', 'Fitness is rising and fatigue is manageable.', 'Status over the last 28 days', '10.5'])
      expect(html).toContain(s)
    expect(html.replace(/<[^>]*>/g, ' ')).not.toMatch(/null|NaN|undefined|[—;]/)
  })
  it('degrades when most values are null and goals are missing', () => {
    const html = view({ as_of: 'x', data_date: '2030-06-01', status: null, readiness: { score: null, label: 'poor', confidence: 'none', capped: false, n_components: 0, drivers: [], components: [] },
      last_activity: null, sleep: { date: '2030-06-01', total_s: 25000, deep_s: null, light_s: null, rem_s: null, awake_s: null, score: null, start_ts: null, end_ts: null }, tiles: null, this_week: null })
    for (const s of ['Not enough data yet', 'No activities synced yet', 'Stage breakdown is not available', 'No sessions yet this week', 'No goals set yet'])
      expect(html).toContain(s)
    expect(html.replace(/<[^>]*>/g, ' ')).not.toMatch(/null|NaN|undefined/)
  })
  it('shows the empty state on an empty database', () => {
    expect(view({ as_of: 'x', data_date: null })).toContain('No data has synced')
  })
})

describe('Coach card', () => {
  it('shows the suggestion, brief and prefilled quick prompts from the fixture', () => {
    const html = render(h(CoachPlanView, { p: coachToday as never }))
    for (const s of ['Coach suggests', 'Easy', '· 9 km', 'Easy aerobic run', 'keep your heart rate under 143', 'Heart rate under', 'Recovery looks good', 'Open in Coach', 'Why this run', 'aria-expanded="false"', 'Open chat', 'href="#/coach/Make%20today%20easier"'])
      expect(html).toContain(s)
    expect(html).not.toContain('Yesterday was hard') // the why text is behind the button
    expect(html.replace(/<[^>]*>/g, ' ')).not.toMatch(/null|NaN|undefined/)
    const rest = render(h(CoachPlanView, { p: { ...coachToday, brief: null, suggestion: { ...coachToday.suggestion, kind: 'rest', km: null, pace: null, hr_cap: null } } as never }))
    expect(rest).toContain('Rest'); expect(rest).not.toContain('Morning note'); expect(rest).not.toContain('Heart rate under')
  })
})
