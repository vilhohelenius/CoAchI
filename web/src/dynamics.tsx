import { useState } from 'preact/hooks'
import { useApi } from './api'
import { LineChart, summarize } from './chart'
import { DASH, day, num } from './fmt'
import { Page, Tile } from './today'
import type { ActDetail, ActResp, DynResp } from './types'

type Metric = { s: string; k: 'stride_m' | 'vert_osc_mm' | 'vert_ratio' | 'gct_ms' | 'gct_balance' | 'cadence' | 'power'; t: string; u: string; d: number; c: string }
const METRICS: Metric[] = [
  { s: 'Cadence', k: 'cadence', t: 'Cadence', u: ' steps/min', d: 0, c: 'var(--b5)' },
  { s: 'Stride', k: 'stride_m', t: 'Stride length', u: ' m', d: 2, c: 'var(--link)' },
  { s: 'Oscillation', k: 'vert_osc_mm', t: 'Vertical oscillation', u: ' mm', d: 0, c: 'var(--b3)' },
  { s: 'Ratio', k: 'vert_ratio', t: 'Vertical ratio', u: ' %', d: 1, c: 'var(--b2)' },
  { s: 'Contact', k: 'gct_ms', t: 'Ground contact time', u: ' ms', d: 0, c: 'var(--b1)' },
  { s: 'Balance', k: 'gct_balance', t: 'Ground contact balance', u: ' % left', d: 1, c: 'var(--s-over)' },
  { s: 'Power', k: 'power', t: 'Power', u: ' W', d: 0, c: 'var(--ok)' },
]
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`

// ---- one activity ----
type A = ActResp['activity']
const AVG: Record<Metric['k'], (a: A) => number | null | undefined> = {
  cadence: (a) => a.avg_cadence, stride_m: (a) => a.avg_stride_m, vert_osc_mm: (a) => a.avg_vert_osc_mm, vert_ratio: (a) => a.avg_vert_ratio,
  gct_ms: (a) => a.avg_gct_ms, gct_balance: (a) => a.avg_gct_balance, power: (a) => a.avg_power,
}
const SERIES: Record<Metric['k'], keyof ActDetail> = { cadence: 'cad', stride_m: 'str', vert_osc_mm: 'vo', vert_ratio: 'vr', gct_ms: 'gct', gct_balance: 'bal', power: 'pwr' }

export function DynamicsCard({ a, det }: { a: A; det: ActDetail | null }) {
  const [sel, setSel] = useState<string | null>(null)
  const tiles = METRICS.filter((m) => AVG[m.k](a) != null)
  const has = (m: Metric) => (det?.[SERIES[m.k]] as (number | null)[] | undefined)?.some((v) => v != null && v > 0)
  const tabs = METRICS.filter(has)
  if (!tiles.some((m) => m.k !== 'cadence' && m.k !== 'power') && !tabs.some((m) => m.k !== 'cadence' && m.k !== 'power'))
    return <section class="card"><p class="k">Running dynamics</p><p class="t0">No running dynamics were recorded for this run. They need a watch with running dynamics, usually with a heart rate strap or running pod.</p></section>
  const m = tabs.find((t) => t.k === sel) ?? tabs[0]
  const n = det?.hr.length || det?.speed.length || 0, dates = Array.from({ length: n }, (_, i) => clock((i * det!.duration_s) / Math.max(1, n - 1)))
  const v = m ? ((det![SERIES[m.k]] as (number | null)[]).map((x) => (x != null && x > 0 ? x : null))) : []
  const avg = m ? AVG[m.k](a) : null
  return <section class="card wide"><p class="k">Running dynamics</p>
    <div class="glance">{tiles.map((t) => <Tile l={t.t} v={num(AVG[t.k](a), t.d)} u={t.u.replace(' % left', ' %')} n={t.k === 'gct_balance' ? 'Left side share' : 'Average'} />)}</div>
    {m && n > 1 && <>
      <div class="tools"><div class="seg w" role="group" aria-label="Running dynamics series">{tabs.map((t) => <button type="button" aria-pressed={t.k === m.k} onClick={() => setSel(t.k)}>{t.s}</button>)}</div></div>
      <LineChart dates={dates} xf={(x) => x} h={170} yfmt={(x) => num(x, m.d)} unit={m.u} label={`${m.t} over the activity`} series={[{ name: m.t, v, c: m.c, w: 1.8 }]}
        summary={`${m.t}: average ${num(avg, m.d)}${m.u} over ${clock(det!.duration_s)}.`} tip={(i) => [dates[i], `${m.t} ${v[i] == null ? DASH : num(v[i], m.d) + m.u}`]} /></>}
    <p class="cap2">Ground contact balance is the share of ground contact time on the left foot, 50 means even. Vertical ratio is bounce as a share of stride length.</p>
  </section>
}

// ---- weekly trend ----
export function DynamicsView({ d, sel, setSel }: { d: DynResp; sel: Metric['k']; setSel: (k: Metric['k']) => void }) {
  const avail = METRICS.filter((m) => d.weeks.some((w) => w[m.k]))
  if (!avail.length) return <section class="card"><p class="k">Nothing here yet</p><p class="t0">No running dynamics have synced. They need a watch that records them, and the activity files must have been read.</p><a class="btn" href="#/settings">Open Settings</a></section>
  const m = avail.find((x) => x.k === sel) ?? avail[0], dates = d.weeks.map((w) => w.week_start), v = d.weeks.map((w) => w[m.k]?.avg ?? null), runs = d.weeks.reduce((s, w) => s + (w[m.k]?.n ?? 0), 0)
  return <>
    <p class="sub">Weekly averages across your runs. Only runs that recorded the measure count, so some weeks have fewer readings.</p>
    <div class="tools"><div class="seg w" role="group" aria-label="Measure">{avail.map((x) => <button type="button" aria-pressed={x.k === m.k} onClick={() => setSel(x.k)}>{x.s}</button>)}</div></div>
    <section class="card wide"><h3 class="ch">{m.t}, weekly average over {d.weeks.length} weeks</h3>
      <LineChart dates={dates} h={230} unit={m.u} yfmt={(x) => num(x, m.d)} label={`${m.t} per week`} series={[{ name: m.t, v, c: m.c }]}
        summary={summarize(m.t, dates, v, (x) => num(x, m.d), m.u)}
        tip={(i) => [`Week of ${day(dates[i], { day: 'numeric', month: 'short' })}`, v[i] == null ? 'No runs with this measure' : `${m.t} ${num(v[i], m.d)}${m.u}`, ...(d.weeks[i][m.k] ? [`${d.weeks[i][m.k]!.n} ${d.weeks[i][m.k]!.n === 1 ? 'run' : 'runs'}`] : [])]} />
      <p class="cap2">Based on {runs} {runs === 1 ? 'run' : 'runs'}. Shoes, pace and terrain all move these numbers, so look for slow shifts and not single weeks.</p>
    </section>
  </>
}

export function DynamicsPage() {
  const [sel, setSel] = useState<Metric['k']>('cadence'), [st, retry] = useApi<DynResp>('/api/dynamics?weeks=26')
  return <Page title="Dynamics" st={st} retry={retry}>{(d) => <DynamicsView d={d} sel={sel} setSel={setSel} />}</Page>
}
