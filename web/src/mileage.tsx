import { useState } from 'preact/hooks'
import { useApi } from './api'
import { LineChart, StackedBars, summarize } from './chart'
import { Err } from './today'
import { day, dur, num } from './fmt'
import type { CompareResp, MileageResp } from './types'

export const SPORTS: [string, string][] = [['run', 'Running'], ['bike', 'Cycling'], ['ski', 'Skiing'], ['all', 'All sports']]
const BY = [['week', 'Weeks'], ['month', 'Months'], ['year', 'Years']] as const
const YEAR_C = ['var(--link)', 'var(--b5)', 'var(--b2)', 'var(--b1)', 'var(--b3)', 'var(--s-peak)', 'var(--s-detr)', 'var(--mute)']
const LEAP = Array.from({ length: 366 }, (_, i) => new Date(Date.UTC(2024, 0, 1 + i)).toISOString().slice(0, 10))
const mdate = (by: string, k: string) => (by === 'week' ? k : by === 'month' ? `${k}-01` : `${k}-01-01`)
const label = (by: string, k: string) => (by === 'year' ? k : by === 'month' ? day(`${k}-01`, { month: 'short', year: 'numeric' }) : `Week of ${day(k, { day: 'numeric', month: 'short' })}`)

export function BarsCard({ d }: { d: MileageResp }) {
  const p = d.periods, tot = p.reduce((a, x) => ({ km: a.km + x.km, h: a.h + x.hours, n: a.n + x.sessions, e: a.e + x.elev_m }), { km: 0, h: 0, n: 0, e: 0 })
  const dates = p.map((x) => mdate(d.by, x.key)), unit = d.by
  const xf = (s: string) => (unit === 'year' ? s.slice(0, 4) : unit === 'month' ? day(s, { month: 'short', year: '2-digit' }) : day(s, { day: 'numeric', month: 'short' }))
  return <section class="card wide"><h3 class="ch">Distance per {unit}, last {p.length} {unit}s</h3>
    {tot.n === 0 ? <p class="empty">No activities in this view yet. Pick another sport or sync more history.</p> : <>
      <div class="kv" style="margin-bottom:14px">
        <div><span class="num">{num(tot.km)}<small> km</small></span><span class="lab">Distance</span></div>
        <div><span class="num">{dur(tot.h * 3600)}</span><span class="lab">Time</span></div>
        <div><span class="num">{num(tot.n)}</span><span class="lab">Sessions</span></div>
        <div><span class="num">{num(tot.e)}<small> m</small></span><span class="lab">Climbing</span></div>
      </div>
      <StackedBars dates={dates} xf={xf} h={230} unit=" km" legend={false} label={`Kilometres per ${unit}`} stacks={[{ name: 'Distance', c: 'var(--link)' }]} vals={p.map((x) => [x.km])}
        summary={summarize(`Distance per ${unit}`, dates, p.map((x) => x.km), (n) => num(n, 1), ' km')}
        tip={(i) => [label(unit, p[i].key), `${num(p[i].km, 1)} km`, `${p[i].sessions} sessions, ${dur(p[i].hours * 3600)}`]} /></>}
  </section>
}

export function CompareCards({ c }: { c: CompareResp }) {
  const ys = c.years, now = ys.at(-1)?.year, todayDoy = c.today ? Math.round((Date.parse(c.today) - Date.parse(`${c.today.slice(0, 4)}-01-01`)) / 864e5) + 1 : 366
  const thisYear = c.today ? +c.today.slice(0, 4) : now
  const series = ys.map((y, k) => {
    let j = 0, cum = 0
    const v = LEAP.map((_, i) => { while (j < y.points.length && y.points[j][0] <= i + 1) cum = y.points[j++][1]; return y.year === thisYear && i + 1 > todayDoy ? null : cum })
    return { name: String(y.year), v, c: YEAR_C[Math.min(ys.length - 1 - k, YEAR_C.length - 1)], w: y.year === thisYear ? 3 : 1.8 }
  })
  const goal = c.goal_km == null ? [] : [{ name: 'Goal pace', v: LEAP.map((_, i) => (c.goal_km! * (i + 1)) / 366), c: 'var(--mute)', dash: '4 5', w: 1.6 }]
  const cur = series.find((s) => s.name === String(thisYear)), prev = series.find((s) => s.name === String(thisYear! - 1))
  const a = cur?.v[todayDoy - 1], b = prev?.v[todayDoy - 1]
  const gap = a != null && b != null && prev ? `${num(Math.abs(a - b), 1)} km ${a >= b ? 'ahead of' : 'behind'} the same day last year.` : ''
  const hasRoll = (v: (number | null)[]) => v.some((x) => x != null)
  const xf = (s: string) => day(s, { day: 'numeric', month: 'short' })
  return <>
    <section class="card wide"><h3 class="ch">Distance so far in each year{c.goal_km != null ? ', with the yearly goal pace' : ''}</h3>
      {!ys.length ? <p class="empty">No distance recorded yet.</p> : <>
        <LineChart dates={LEAP} h={260} unit=" km" label="Cumulative distance for each year" include={[0]}
          summary={`Cumulative distance by year. ${ys.map((y) => `${y.year}: ${num(y.total_km, 1)} km`).join(', ')}.`}
          series={[...goal, ...series.slice().reverse()]}
          tip={(i) => [day(LEAP[i], { day: 'numeric', month: 'long' }), ...series.slice().reverse().map((s) => `${s.name} ${s.v[i] == null ? '–' : num(s.v[i], 1) + ' km'}`)]} />
        <p class="cap2">{gap ? `This year is ${gap}` : 'Each line adds up the distance as the year goes on.'}{c.goal_km != null && ` The dashed line is your ${num(c.goal_km)} km goal spread evenly over the year.`}</p></>}
    </section>
    {[['km30', 'Last 30 days, rolling', 'Needs 30 days of history before it starts.'], ['km365', 'Last 365 days, rolling', 'Needs a full year of history before it starts.']].map(([k, t, none]) => {
      const v = c.rolling[k as 'km30' | 'km365']
      return <section class="card"><h3 class="ch">{t}</h3>
        <LineChart dates={c.rolling.dates} xf={(s) => day(s, { month: 'short', year: '2-digit' })} h={190} unit=" km" label={`${t}, kilometres`} include={[0]}
          summary={hasRoll(v) ? summarize(t, c.rolling.dates, v, (n) => num(n, 0), ' km') : none}
          series={[{ name: t, v, c: k === 'km30' ? 'var(--link)' : 'var(--b5)' }]} yfmt={(n) => num(n)} />
      </section>
    })}
  </>
}

export function MileageView({ d, c }: { d: MileageResp; c: CompareResp }) {
  return <div class="g2"><BarsCard d={d} /><CompareCards c={c} /></div>
}

export function MileagePage() {
  const [sport, setSport] = useState('run'), [by, setBy] = useState<'week' | 'month' | 'year'>('week')
  const [bars, r1] = useApi<MileageResp>(`/api/mileage?by=${by}&sport=${sport}`), [cmp, r2] = useApi<CompareResp>(`/api/mileage/compare?sport=${sport}`)
  return <>
    <h1>Mileage</h1>
    <p class="sub">How far you have gone, week by week and year against year.</p>
    <div class="tools">
      <div class="seg" role="group" aria-label="Sport">{SPORTS.map(([k, l]) => <button type="button" aria-pressed={sport === k} onClick={() => setSport(k)}>{l}</button>)}</div>
      <div class="seg" role="group" aria-label="Group by">{BY.map(([k, l]) => <button type="button" aria-pressed={by === k} onClick={() => setBy(k)}>{l}</button>)}</div>
    </div>
    {bars.s === 'error' ? <Err msg={bars.msg} retry={r1} /> : cmp.s === 'error' ? <Err msg={cmp.msg} retry={r2} />
      : bars.s === 'loading' || cmp.s === 'loading' ? <div aria-busy="true" aria-label="Loading"><section class="card sk" /></div> : <MileageView d={bars.data} c={cmp.data} />}
  </>
}
