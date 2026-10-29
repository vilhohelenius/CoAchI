import { useState } from 'preact/hooks'
import { useApi } from './api'
import { StackedBars, summarize } from './chart'
import { day, num } from './fmt'
import { Page, Pill } from './today'
import type { IntensityResp } from './types'

const ZONES = [['Zone 1', 'var(--b5)'], ['Zone 2', 'var(--b3)'], ['Zone 3', 'var(--b2)'], ['Zone 4', 'var(--b1)'], ['Zone 5', 'var(--s-over)']] as const
const SPORT: Record<string, string> = { run: 'Running', bike: 'Cycling', swim: 'Swimming', strength: 'Strength', walk: 'Walking' }
const sport = (k: string) => SPORT[k] ?? k.charAt(0).toUpperCase() + k.slice(1)

export function IntensityView({ d, sel, setSel }: { d: IntensityResp; sel: string; setSel: (s: string) => void }) {
  const sports = [...new Set(d.weeks.flatMap((w) => Object.keys(w.minutes)))]
  if (!d.weeks.length || !sports.length) return <section class="card"><p class="k">Nothing here yet</p><p class="t0">No heart rate zone time has synced. Sessions need heart rate data to show up here.</p><a class="btn" href="#/settings">Open Settings</a></section>
  const dates = d.weeks.map((w) => w.week_start), pick = (w: IntensityResp['weeks'][number]) => (sel === 'all' ? sports.map((s) => w.minutes[s]) : [w.minutes[sel]]).reduce<number[]>((a, z) => a.map((x, i) => x + (z?.[i] ?? 0)), [0, 0, 0, 0, 0])
  const vals = d.weeks.map(pick), sh = sel === 'all' ? d.share_28d?.all : d.share_28d?.by_sport?.[sel], tg = d.share_28d?.easy_target ?? [0.75, 0.85]
  const state = !sh ? null : sh.easy < tg[0] ? ['A little hard-heavy', 'warn'] : sh.easy > tg[1] ? ['Mostly easy', 'mute'] : ['On target', 'ok']
  return <>
    <p class="sub">Time in each heart rate zone. Most of your training should be easy so the hard days can be hard.</p>
    <div class="tools"><div class="seg" role="group" aria-label="Sport">{['all', ...sports].map((s) => <button type="button" aria-pressed={sel === s} onClick={() => setSel(s)}>{s === 'all' ? 'All sports' : sport(s)}</button>)}</div></div>
    <div class="g2">
      <section class="card wide"><h3 class="ch">Minutes per week by zone, last {d.weeks.length} weeks</h3>
        <StackedBars dates={dates} h={230} unit=" min" label="Minutes per week in each heart rate zone" summary={summarize('Weekly minutes', dates, vals.map((z) => z.reduce((s, x) => s + x, 0)), (n) => num(n), ' min')}
          stacks={ZONES.map(([name, c]) => ({ name, c }))} vals={vals} tip={(i) => [`Week of ${day(dates[i], { day: 'numeric', month: 'short' })}`, ...ZONES.map(([n], k) => `${n} ${num(vals[i][k])} min`)]} />
      </section>
      <section class="card wide"><p class="k">Easy against hard, last 28 days{state && <Pill tone={state[1]}>{state[0]}</Pill>}</p>
        {!sh ? <p class="empty">No heart rate zone time in the last 28 days{sel === 'all' ? '' : ` for ${sport(sel).toLowerCase()}`}.</p> : <>
          <div class="stages" role="img" aria-label={`Easy ${num(sh.easy * 100)} percent, moderate ${num(sh.mid * 100)} percent, hard ${num(sh.hard * 100)} percent`}>
            <i style={`flex:${sh.easy};background:var(--b5)`} /><i style={`flex:${sh.mid};background:var(--b2)`} /><i style={`flex:${sh.hard};background:var(--b1)`} /></div>
          <div class="tgt" aria-hidden="true"><i style={`left:${tg[0] * 100}%;width:${(tg[1] - tg[0]) * 100}%`} /></div>
          <div class="legend"><span><i style="background:var(--b5)" />Easy {num(sh.easy * 100)}%</span><span><i style="background:var(--b2)" />Moderate {num(sh.mid * 100)}%</span><span><i style="background:var(--b1)" />Hard {num(sh.hard * 100)}%</span></div>
          <p class="cap2">The green marker shows the usual aim of {num(tg[0] * 100)} to {num(tg[1] * 100)}% easy, zones 1 and 2. Based on {num(sh.minutes)} minutes of heart rate data. A low share is not a problem on its own. It matters most when you feel flat.</p></>}
      </section>
    </div>
  </>
}

export function IntensityPage() {
  const [sel, setSel] = useState('all'), [st, retry] = useApi<IntensityResp>('/api/intensity?weeks=8')
  return <Page title="Intensity" st={st} retry={retry}>{(d) => <IntensityView d={d} sel={sel} setSel={setSel} />}</Page>
}
