import { useState } from 'preact/hooks'
import { useApi } from './api'
import { LineChart, StackedBars, summarize } from './chart'
import { Err } from './today'
import { DASH, day, dur, num, sgn } from './fmt'
import type { CompareResp, Goals, MileageResp } from './types'

export const SPORTS: [string, string][] = [['run', 'Running'], ['bike', 'Cycling'], ['ski', 'Skiing'], ['all', 'All sports']]
const PER = [['week', 'Week'], ['month', 'Month'], ['year', 'Year'], ['all', 'All time']] as const
type Per = (typeof PER)[number][0]
const mdate = (by: string, k: string) => (by === 'week' ? k : by === 'month' ? `${k}-01` : `${k}-01-01`)
const label = (by: string, k: string) => (by === 'year' ? k : by === 'month' ? day(`${k}-01`, { month: 'long', year: 'numeric' }) : `Week of ${day(k, { day: 'numeric', month: 'long' })}`)

const SHOWN = { week: 16, month: 12, year: 99, all: 99 }
const TITLE = { week: 'Last 16 weeks', month: 'Last 12 months', year: 'Each year', all: 'Running total by year' }
const BEFORE = { week: 'the week before', month: 'the month before', year: 'the year before' }

/** The selected period as a big number with stats, beside the bar chart that picks it. `goals` only applies to running. */
export function BarsCard({ d, per, goals }: { d: MileageResp; per: Per; goals?: Goals | null }) {
  const p = d.periods.slice(-SHOWN[per]), [sel0, setSel] = useState<number | null>(null), sel = Math.min(sel0 ?? p.length - 1, p.length - 1)
  const run = d.sport === 'run', sess = run ? 'Runs' : 'Sessions'
  let c = 0
  const km = p.map((x) => (per === 'all' ? (c += x.km) : x.km)), dates = p.map((x) => mdate(d.by, x.key)), b = p[sel], last = sel === p.length - 1
  const tot = d.periods.reduce((a, x) => ({ h: a.h + x.hours, n: a.n + x.sessions, e: a.e + x.elev_m }), { h: 0, n: 0, e: 0 })
  const xf = (s: string) => (d.by === 'year' ? s.slice(0, 4) : d.by === 'month' ? day(s, { month: 'short' }) : day(s, { day: 'numeric', month: 'short' }))
  const yg = goals?.progress?.year?.target_km, wk = goals?.progress?.week
  const stats: [string, string, string][] = per === 'all' ? [['Years', num(p.length), ''], [sess, num(tot.n), ''], ['Time', num(tot.h), ' h'], ['Climb', num(tot.e), ' m']]
    : [[sess, num(b.sessions), ''], ['Time', dur(b.hours * 3600), ''], ['Climb', num(b.elev_m), ' m'], ['Longest', b.longest_km ? num(b.longest_km, 1) : DASH, b.longest_km ? ' km' : '']]
  const diff = per === 'all' ? `All ${sess.toLowerCase()} from ${p[0]?.key} to today.` : sel > 0 ? `${sgn(b.km - p[sel - 1].km)} km compared with ${BEFORE[per]}${last ? ' (this one is not finished)' : ''}.` : ''
  const note = per === 'week' ? (run && wk ? `The green band is your ${num(wk.band_lo)} to ${num(wk.band_hi)} km aim.` : '') : per === 'month' ? (run && yg ? `The dashed line is one twelfth of your ${num(yg)} km aim.` : '')
    : per === 'year' ? (run && yg ? `The dashed line is your ${num(yg)} km yearly aim.` : '') : 'Each bar adds that year to the years before it.'
  if (!p.length || tot.n === 0) return <section class="card wide"><p class="empty">No activities in this view yet. Pick another sport or sync more history.</p></section>
  return <div class="g2">
    <section class="card"><p class="k"><b>{per === 'all' ? `Through ${b.key}` : label(d.by, b.key)}{last && per !== 'all' ? ', so far' : ''}</b>
      <span><button type="button" class="xp" aria-label="Earlier" disabled={sel === 0} onClick={() => setSel(sel - 1)}>‹</button> <button type="button" class="xp" aria-label="Later" disabled={last} onClick={() => setSel(sel + 1)}>›</button></span></p>
      <div class="bigrow"><span class="big" aria-live="polite">{num(km[sel])}<small>km</small></span></div>
      <p class="t0" style="margin:10px 0 14px">{diff}</p>
      <div class="kv">{stats.map(([l, v, u]) => <div><span class="num">{v}{u && <small>{u}</small>}</span><span class="lab">{l}</span></div>)}</div></section>
    <section class="card"><p class="k"><b>{TITLE[per]}</b><span>tap a bar</span></p>
      <StackedBars dates={dates} xf={xf} h={200} unit=" km" legend={false} sel={sel} onSel={setSel} label={`Kilometres per ${d.by}`} stacks={[{ name: 'Distance', c: 'var(--link)' }]} vals={km.map((x) => [x])}
        goal={run && per === 'month' && yg ? yg / 12 : run && per === 'year' && yg ? yg : undefined} band={run && per === 'week' && wk ? [wk.band_lo, wk.band_hi] : undefined}
        summary={summarize(`Distance per ${d.by}`, dates, km, (n) => num(n, 1), ' km')}
        tip={(i) => [per === 'all' ? `Through ${p[i].key}` : label(d.by, p[i].key), `${num(km[i], 1)} km`, `${p[i].sessions} sessions, ${dur(p[i].hours * 3600)}`]} />
      {note && <p class="cap2">{note}</p>}</section>
  </div>
}

// ---- compared with before ----
const WIN = [['week', 'Week'], ['month', 'Month'], ['year', 'Year'], ['r30', '30 days'], ['r365', '365 days']] as const
type Win = (typeof WIN)[number][0]
const iso = (t: number) => new Date(t).toISOString().slice(0, 10)
const add = (s: string, n: number) => iso(Date.parse(s) + n * 864e5)
const COL = ['var(--link)', 'var(--mute)', 'var(--s-maint)']

/** Kilometres per day, rebuilt from the cumulative points of each year. */
function daily(c: CompareResp) {
  const m = new Map<string, number>()
  for (const y of c.years) { let prev = 0; for (const [doy, cum] of y.points) { m.set(add(`${y.year}-01-01`, doy - 1), cum - prev); prev = cum } }
  return m
}

export function Compare({ c }: { c: CompareResp }) {
  const [win, setWin] = useState<Win>('week'), m = daily(c), t = c.today ?? iso(Date.now())
  const cum = (from: string, len: number, max = len) => { let s = 0; return Array.from({ length: len }, (_, i) => { const d = add(from, i); if (d > t || i >= max) return null; s += m.get(d) ?? 0; return Math.round(s * 10) / 10 }) }
  const mon = add(t, -((new Date(t).getUTCDay() + 6) % 7)), y = +t.slice(0, 4), first = `${t.slice(0, 7)}-01`, pm = iso(Date.UTC(y, +t.slice(5, 7) - 2, 1)), dim = (s: string) => new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7), 0)).getUTCDate()
  const mn = (s: string) => day(s, { month: 'long' }), ydays = (yr: number) => (yr % 4 === 0 ? 366 : 365)
  const def = {
    week: { n: 7, from: mon, s: [['This week', cum(mon, 7)], ['Last week', cum(add(mon, -7), 7)]], lab: (i: number) => day(add(mon, i), { weekday: 'short' }), at: 'this day' },
    month: { n: 31, from: first, s: [[mn(first), cum(first, 31, dim(first))], [mn(pm), cum(pm, 31, dim(pm))]], lab: (i: number) => String(i + 1), at: 'this day of the month' },
    year: { n: 366, from: `${y}-01-01`, s: [0, 1, 2].map((k) => [String(y - k), cum(`${y - k}-01-01`, 366, ydays(y - k))]), lab: (i: number) => day(add(`${y}-01-01`, i), { day: 'numeric', month: 'short' }), at: 'this day of the year' },
    r30: { n: 30, from: add(t, -29), s: [['Last 30 days', cum(add(t, -29), 30)], ['30 days before', cum(add(t, -59), 30)]], lab: (i: number) => `Day ${i + 1}`, at: 'the same day' },
    r365: { n: 365, from: add(t, -364), s: [['Last 365 days', cum(add(t, -364), 365)], ['365 days before', cum(add(t, -729), 365)]], lab: (i: number) => `Day ${i + 1}`, at: 'the same day' },
  }[win] as { n: number; from: string; s: [string, (number | null)[]][]; lab: (i: number) => string; at: string }
  const dates = Array.from({ length: def.n }, (_, i) => add(def.from, i)), ai = def.s[0][1].reduce((a: number, v, i) => (v != null ? i : a), 0)
  const val = (s: (number | null)[]) => s[Math.min(ai, s.length - 1)] ?? s.filter((v) => v != null).pop() ?? 0, a = val(def.s[0][1]), b = val(def.s[1][1])
  const series = def.s.map(([name, v], i) => ({ name, v, c: COL[i], w: i ? 2 : 3, dash: i === 2 ? '2 5' : undefined }))
  if (win === 'year' && c.goal_km != null) series.unshift({ name: 'Goal pace', v: dates.map((_, i) => (c.goal_km! * (i + 1)) / 366), c: 'var(--mute)', w: 1.6, dash: '4 5' })
  const idx = (d: string) => dates.indexOf(d)
  return <section class="card"><div class="tools"><div class="seg" role="group" aria-label="Comparison window">{WIN.map(([k, l]) => <button type="button" aria-pressed={win === k} onClick={() => setWin(k)}>{l}</button>)}</div></div>
    {!c.years.length ? <p class="empty">No distance recorded yet.</p> : <>
      <LineChart dates={dates} h={230} unit=" km" include={[0]} label={`Cumulative kilometres: ${def.s.map((s) => s[0]).join(' compared with ')}`} xf={(d) => def.lab(idx(d))} yfmt={(n) => num(n)}
        summary={`Cumulative distance. ${def.s.map(([n, v]) => `${n}: ${num(val(v), 1)} km`).join(', ')}.`} series={series}
        tip={(i) => [def.lab(i), ...def.s.map(([n, v]) => `${n} ${v[i] == null ? DASH : num(v[i], 1) + ' km'}`)]} />
      <div class="legend">{def.s.map(([n, v], i) => <span><i style={`background:${COL[i]}`} />{n}: {num(val(v))} km</span>)}</div>
      <p class="t0" style="margin:10px 0 0" role="status">At {def.at} you are {num(Math.abs(a - b))} km {a >= b ? 'ahead of' : 'behind'} {def.s[1][0].toLowerCase()}. That is a comparison, not a target.</p></>}
  </section>
}

export function MileageView({ d, c, per = d.by, goals }: { d: MileageResp; c: CompareResp; per?: Per; goals?: Goals | null }) {
  return <><BarsCard key={per + d.sport} d={d} per={per} goals={goals} /><h2 class="sh">Compared with before</h2><Compare c={c} /></>
}

export function MileagePage() {
  const [sport, setSport] = useState('run'), [per, setPer] = useState<Per>('week')
  const [bars, r1] = useApi<MileageResp>(`/api/mileage?by=${per === 'all' ? 'year' : per}&sport=${sport}`), [cmp, r2] = useApi<CompareResp>(`/api/mileage/compare?sport=${sport}`), [gl] = useApi<Goals>('/api/goals')
  return <>
    <h1>Mileage</h1>
    <p class="sub">{sport === 'run' ? 'Running distance only. Rides are listed in Activities.' : 'How far you have gone, week by week and year against year.'}</p>
    <div class="tools">
      <div class="seg" role="group" aria-label="Period">{PER.map(([k, l]) => <button type="button" aria-pressed={per === k} onClick={() => setPer(k)}>{l}</button>)}</div>
      <div class="seg" role="group" aria-label="Sport">{SPORTS.map(([k, l]) => <button type="button" aria-pressed={sport === k} onClick={() => setSport(k)}>{l}</button>)}</div>
    </div>
    {bars.s === 'error' ? <Err msg={bars.msg} retry={r1} /> : cmp.s === 'error' ? <Err msg={cmp.msg} retry={r2} />
      : bars.s === 'loading' || cmp.s === 'loading' ? <div aria-busy="true" aria-label="Loading"><section class="card sk" /></div> : <MileageView d={bars.data} c={cmp.data} per={per} goals={sport === 'run' && gl.s === 'ok' ? gl.data : null} />}
  </>
}
