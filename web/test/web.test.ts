import { describe, expect, it } from 'vitest'
import { render } from 'preact-render-to-string'
import { h } from 'preact'
import { TodayView } from '../src/today'
import { day, dur, km, num, pace, sgn, statusReason } from '../src/fmt'
import today from '../fixtures/today.json'
import goals from '../fixtures/goals.json'
import type { Goals, Today } from '../src/types'

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

const view = (d: unknown, g: Goals | null) =>
  render(h(TodayView, { d: d as Today, goals: g ? { s: 'ok', data: g } : { s: 'error', msg: 'The server did not answer.' }, retryGoals: () => {} }))

describe('Today render', () => {
  it('shows the fixture', () => {
    const html = view(today, goals as Goals)
    for (const s of ['Productive', 'Morning run', '5:38', '82', 'Moderate', '4 of 5 signals used', 'No data today', 'Coach arrives in a later phase', 'on pace', 'ahead of pace'])
      expect(html).toContain(s)
    expect(html.replace(/<[^>]*>/g, ' ')).not.toMatch(/null|NaN|undefined|[—;]/)
  })
  it('degrades when most values are null and goals fail', () => {
    const html = view({ as_of: 'x', data_date: '2030-06-01', status: null, readiness: { score: null, label: 'poor', confidence: 'none', capped: false, n_components: 0, drivers: [], components: [] },
      last_activity: null, sleep: { date: '2030-06-01', total_s: 25000, deep_s: null, light_s: null, rem_s: null, awake_s: null, score: null, start_ts: null, end_ts: null }, tiles: null, this_week: null }, null)
    for (const s of ['Not enough data yet', 'No activities synced yet', 'Stage breakdown is not available', 'No sessions yet this week', 'Try again'])
      expect(html).toContain(s)
    expect(html.replace(/<[^>]*>/g, ' ')).not.toMatch(/null|NaN|undefined/)
  })
  it('shows the empty state on an empty database', () => {
    expect(view({ as_of: 'x', data_date: null }, null)).toContain('No data has synced')
  })
})
