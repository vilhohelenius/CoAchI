import { describe, expect, it } from 'vitest'
import { render } from 'preact-render-to-string'
import { h } from 'preact'
import { LoadView } from '../src/load'
import { RecoveryView } from '../src/recovery'
import { IntensityView } from '../src/intensity'
import { GoalsView } from '../src/goals'
import { MileageView } from '../src/mileage'
import { DynamicsView } from '../src/dynamics'
import dyn from '../fixtures/dynamics.json'
import { FitnessView, RecordsView } from '../src/records'
import recs from '../fixtures/records.json'
import fit from '../fixtures/fitness-estimates.json'
import { ActivitiesView, ActivityView, routePath } from '../src/activities'
import mWeek from '../fixtures/mileage-week.json'
import mCmp from '../fixtures/mileage-compare.json'
import acts from '../fixtures/activities.json'
import aRun from '../fixtures/activity-run.json'
import aStr from '../fixtures/activity-strength.json'
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
  it('Mileage, normal and sparse', () => {
    const html = render(h(MileageView, { d: mWeek as never, c: mCmp as never }))
    for (const x of ['Distance per week', 'Cumulative distance for each year', 'the same day last year', 'Goal pace', 'Last 30 days, rolling', 'Last 365 days, rolling', '2030']) expect(html).toContain(x)
    clean(html)
    const bare = render(h(MileageView, { d: { as_of: 'x', by: 'year', sport: 'ski', periods: [{ key: '2030', km: 0, hours: 0, elev_m: 0, sessions: 0 }] }, c: { as_of: 'x', sport: 'ski', goal_km: null, years: [], rolling: { dates: [], km30: [], km365: [] } } }))
    expect(bare).toContain('No activities in this view yet'); expect(bare).toContain('No distance recorded yet'); expect(bare).toContain('Needs a full year of history'); clean(bare)
  })
  it('Activity list, normal and empty', () => {
    const html = render(h(ActivitiesView, { items: acts.activities as never, sport: 'all', setSport: noop, more: true, onMore: noop, busy: false, err: null }))
    for (const x of ['Morning run', 'Strength', 'href="#/activities/100"', 'Load more', 'Strength']) expect(html).toContain(x)
    clean(html)
    expect(render(h(ActivitiesView, { items: [], sport: 'bike', setSport: noop, more: false, onMore: noop, busy: false, err: null }))).toContain('No cycling activities have synced')
    expect(render(h(ActivitiesView, { items: [], sport: 'all', setSport: noop, more: false, onMore: noop, busy: false, err: 'The server did not answer.' }))).toContain('Try again')
  })
  it('Activity detail, run, strength and null-heavy', () => {
    const html = render(h(ActivityView, { d: aRun as never }))
    for (const x of ['Kilometre splits', 'Laps', 'Route of this activity', 'Efficiency and drift', 'Held steady', 'Heart rate', 'Pace', 'Cadence']) expect(html).toContain(x)
    clean(html)
    expect((html.match(/<path d="M[^"]*"/g) ?? []).length).toBeGreaterThan(3)
    const str = render(h(ActivityView, { d: aStr as never }))
    expect(str).toContain('no route or pace'); expect(str).not.toContain('Route of this'); expect(str).not.toContain('Efficiency'); clean(str)
    const bare = render(h(ActivityView, { d: { as_of: 'x', activity: { id: 1, start_local: '2030-05-31 07:00:00', type: 'running', sport: 'run', name: null, distance_m: null, duration_s: null, elev_gain_m: null, avg_hr: null, load: null, moving_s: null, max_hr: null, avg_cadence: null, avg_power: null, norm_power: null, aero_te: null, anaero_te: null, load_source: null, rpe: null, feel: null, hr_z1_s: null, hr_z2_s: null, hr_z3_s: null, hr_z4_s: null, hr_z5_s: null, temp_c: null }, laps: [], detail: null } }))
    expect(bare).toContain('Not enough data'); expect(bare).toContain('has not synced'); clean(bare)
    const short = render(h(ActivityView, { d: { ...(aRun as any), detail: { ...(aRun as any).detail, ef: null, decoupling: null, why: 'variable', route: [] } } }))
    expect(short).toContain('pace changed too much'); expect(short).not.toContain('Route of this'); clean(short)
  })
  it('Running dynamics card, present and absent', () => {
    const html = render(h(ActivityView, { d: aRun as never }))
    for (const x of ['Running dynamics', 'Stride length', 'Vertical oscillation', 'Vertical ratio', 'Ground contact time', 'Ground contact balance', 'Left side share']) expect(html).toContain(x)
    expect(html).toContain('1.14'); expect(html).toContain('246'); clean(html)
    const none = render(h(ActivityView, { d: { ...(aRun as any), activity: { ...(aRun as any).activity, avg_stride_m: null, avg_vert_osc_mm: null, avg_vert_ratio: null, avg_gct_ms: null, avg_gct_balance: null },
      detail: Object.fromEntries(Object.entries((aRun as any).detail).filter(([k]) => !['str', 'vo', 'vr', 'gct', 'bal'].includes(k))) } }))
    expect(none).toContain('No running dynamics were recorded'); expect(none).not.toContain('Stride length'); clean(none)
    expect(render(h(ActivityView, { d: aStr as never }))).not.toContain('Running dynamics')
  })
  it('Dynamics weekly trend, normal and empty', () => {
    const html = render(h(DynamicsView, { d: dyn as never, sel: 'gct_ms', setSel: noop }))
    for (const x of ['Ground contact time, weekly average over 26 weeks', 'Cadence', 'Stride', 'Based on', 'class="sr"']) expect(html).toContain(x)
    expect(html).not.toContain('>Power<'); clean(html)
    const none = render(h(DynamicsView, { d: { as_of: 'x', weeks: [{ week_start: '2030-05-27', stride_m: null, vert_osc_mm: null, vert_ratio: null, gct_ms: null, gct_balance: null, cadence: null, power: null }] }, sel: 'cadence', setSel: noop }))
    expect(none).toContain('No running dynamics have synced'); clean(none)
  })
  it('routePath fits the box', () => {
    expect(routePath([[1, 1]])).toBeNull()
    const r = routePath([[50, 8], [50.01, 8.02], [50.02, 8]])!
    for (const n of r.d.match(/-?\d+\.\d/g)!.map(Number)) { expect(n).toBeGreaterThanOrEqual(0); expect(n).toBeLessThanOrEqual(300) }
  })
  it('Records and predictions, normal and null-heavy', () => {
    const html = render(h(RecordsView, { d: recs as never, sel: '5k', setSel: noop }))
    for (const x of ['Best efforts across 142 runs', 'Half marathon', '21:00', 'How your best 5 km changed', 'Power, 5 min', 'Next:']) expect(html).toContain(x)
    clean(html)
    const one = render(h(RecordsView, { d: { ...recs, records: [{ ...recs.records[2], timeline: recs.records[2].timeline.slice(0, 1) }] } as never, sel: '5k', setSel: noop }))
    expect(one).toContain('Only one record so far'); clean(one)
    const none = render(h(RecordsView, { d: { as_of: 'x', available: false, n_runs: 0, records: [] }, sel: '5k', setSel: noop }))
    expect(none).toContain('Not enough data yet'); clean(none)
    const f = render(h(FitnessView, { f: fit as never, k: 1.06, setK: noop }))
    for (const x of ['VO2max estimate', 'Estimate', 'Median of 5 steady runs', 'Critical speed', '4:07', 'Likely range', 'older than 8 weeks'.replace('older than', 'more than'), 'reaches well beyond', 'Exponent 1.06', 'Riegel']) expect(f).toContain(x)
    clean(f)
    const bare = render(h(FitnessView, { f: { as_of: 'x', available: true, riegel: 1.06, vo2: { value: null, n: 1, from: '2030-05-05', to: '2030-06-01', history: [] },
      cs: { ok: false, reason: 'few', n: 2, from: '2030-03-03', to: '2030-06-01' }, predictions: [{ label: '5k', dist_m: 5000, point_s: null, lo_s: null, hi_s: null, cs_s: null, flags: [], source: null }] }, k: 1.06, setK: noop }))
    for (const x of ['Not enough steady runs yet', 'Found 2', 'No recent effort', 'trend draws once']) expect(bare).toContain(x)
    clean(bare)
    expect(render(h(FitnessView, { f: { as_of: 'x', available: false, riegel: 1.06 }, k: 1.06, setK: noop }))).toContain('Estimates not ready')
  })
})
