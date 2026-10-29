import { useState } from 'preact/hooks'
import { useApi } from './api'
import { LineChart, summarize } from './chart'
import { DASH, num, sgn, statusReason } from './fmt'
import { Gauge, Page, Pill } from './today'
import { addDays } from '../../src/metrics/dates'
import type { LoadResp } from './types'

/** Same step the server uses for `rest` and `typical`: form is read before the day's load is applied, fitness and fatigue after. */
export function project(ctl: number, atl: number, loads: number[], ctlTau = 42, atlTau = 7) {
  return loads.map((l) => {
    const tsb = ctl - atl
    ctl += (l - ctl) * (1 - Math.exp(-1 / ctlTau)); atl += (l - atl) * (1 - Math.exp(-1 / atlTau))
    return { ctl, atl, tsb }
  })
}
const RANGES = [['90', '90 days', 90], ['365', '1 year', 365], ['all', 'All time', 0]] as const
const SPORT: Record<string, string> = { run: 'Running', bike: 'Cycling', swim: 'Swimming', strength: 'Strength', walk: 'Walking' }
const sport = (k: string) => SPORT[k] ?? k.charAt(0).toUpperCase() + k.slice(1)

/** Mirrors trainingStatus() in src/metrics/status.ts, in the order it checks. */
export const RULES = [['Overreaching', 'Form below -30, or below -20 with over a third of training hard'], ['Productive', 'Fitness up more than 1.5 over 28 days'], ['Maintaining', 'Fitness within 1.5 of 28 days ago'], ['Recovery', 'Fitness down, but fatigue fell under 70% of last week and fitness is intact'], ['Maintaining', 'Fitness down, but fatigue is still at least 80% of fitness'], ['Detraining', 'Anything else, fitness down and training well below usual']]

export function StatusBody({ last, children }: { last: LoadResp['days'][number]; children?: preact.ComponentChildren }) {
  return <>
    <h2 class="ts">{last.status ?? DASH}</h2>
    <p class="why2">{last.status ? statusReason({ label: last.status, acwr: last.acwr, ramp7: last.ramp7, tsb: last.tsb, warming_up: !!last.warming_up }) : 'Not enough data yet.'}</p>
    <div class="facts">
      <div><b>{num(last.ctl)}</b><span>Fitness{last.ramp7 != null && `, ${last.ramp7 < 0 ? 'down' : 'up'} ${num(Math.abs(last.ramp7), 1)}`}</span></div><div><b>{num(last.atl)}</b><span>Fatigue</span></div>
      <div><b>{sgn(last.tsb)}</b><span>Form</span></div><div><b>{num(last.acwr, 2)}</b><span>Load ratio</span></div>{children}
    </div>
  </>
}
export function RulesCard({ status }: { status: string | null }) {
  const at = RULES.findIndex((x) => x[0] === status)
  return <section class="card"><h3 class="ch">How the label is chosen</h3>
    <div class="tw"><table class="tbl"><thead><tr><th scope="col">#</th><th scope="col">Label</th><th scope="col">When</th></tr></thead>
      <tbody>{RULES.map(([l, w], i) => { const hit = i === at; return <tr class={hit ? 'hit' : ''}><td>{i + 1}</td><td><b>{l}</b>{hit && <small class="lab">Matches today</small>}</td><td>{w}</td></tr> })}</tbody></table></div>
    <span class="lab">The first rule that fits wins.{at > 0 ? ` Rules 1 to ${at} did not match, rule ${at + 1} did.` : at === 0 ? ' Rule 1 matched.' : ''} Under 28 days of history there is no label.</span>
  </section>
}

type Proj = NonNullable<LoadResp['projection']>
const formWord = (t: number) => (t < -20 ? 'deep fatigue' : t < -10 ? 'tired but in range' : t <= 5 ? 'balanced' : t <= 15 ? 'fresh' : 'very fresh')
/** The 21 day what-if, laid out like the mock: load picker (with `head` above it) beside fitness and fatigue with 28 days of history, then form against the +5 to +15 band, then four outcome tiles. */
export function ForecastView({ p, load, typ, setDaily, hist = [], head }: { p?: Proj | null; load: number; typ: number; setDaily: (n: number) => void; hist?: LoadResp['days']; head?: preact.ComponentChildren }) {
  if (!p) return <section class="card"><p class="empty">The projection is not available yet.</p></section>
  const plan = project(p.ctl, p.atl, Array(21).fill(load), p.ctl_tau, p.atl_tau), rest = project(p.ctl, p.atl, Array(21).fill(0), p.ctl_tau, p.atl_tau)
  const pd = Array.from({ length: 21 }, (_, i) => addDays(p.date, i + 1)), end = plan[20], fin = end.ctl, low = Math.min(...plan.map((x) => x.tsb))
  const h = hist.slice(-28), hn = h.length, nul = (k: number) => Array<number | null>(k).fill(null), fd = [...h.map((x) => x.date), ...pd]
  const band = { lo: Array(21).fill(5), hi: Array(21).fill(15) }
  return <>
    <div class="g2">
      <div class="pg" style="margin-top:0">{head}
        <section class="card">
          <h3 class="ch">If you train this much every day, about {num(load)} load</h3>
          <div class="tools"><div class="seg" role="group" aria-label="Daily load presets">
            {([['Rest', 0], ['Typical', typ], ['Hard', Math.round(typ * 1.5)]] as const).map(([l, v]) => <button type="button" aria-pressed={load === v} onClick={() => setDaily(v)}>{l} {num(v)}</button>)}</div></div>
          <input type="range" min={0} max={Math.max(150, typ * 2)} step={5} value={load} onInput={(e) => setDaily(+(e.target as HTMLInputElement).value)} aria-label="Daily load" />
          <span class="lab">Your typical day averages {num(typ)} load over the last 4 weeks.</span>
          <p class="t0" style="margin:12px 0 0" aria-live="polite">At {num(load)} a day, fitness goes from {num(p.ctl)} to {num(fin)} and fatigue from {num(p.atl)} to {num(end.atl)}. Form ends at {sgn(end.tsb)}, which is {formWord(end.tsb)}. The lowest form on the way is {sgn(low)}.</p>
        </section></div>
      <div class="pg" style="margin-top:0">
        <section class="card"><h3 class="ch">Fitness and fatigue, dotted is projected</h3>
          <LineChart dates={fd} h={230} vline={hn ? hn - 1 : undefined} label="Fitness and fatigue with a 21 day projection" summary={summarize('Projected fitness', pd, plan.map((x) => x.ctl), (n) => num(n, 1))}
            series={[{ name: 'Fitness', v: [...h.map((x) => x.ctl), ...nul(21)], c: 'var(--link)', w: 2.8 }, { name: 'Fatigue', v: [...h.map((x) => x.atl), ...nul(21)], c: 'var(--warn)' },
              { name: 'Fitness, projected', v: [...nul(Math.max(0, hn - 1)), ...(hn ? [h[hn - 1].ctl] : []), ...plan.map((x) => x.ctl)], c: 'var(--link)', w: 2.8, dash: '2 5' },
              { name: 'Fatigue, projected', v: [...nul(Math.max(0, hn - 1)), ...(hn ? [h[hn - 1].atl] : []), ...plan.map((x) => x.atl)], c: 'var(--warn)', dash: '2 5' }]} />
        </section>
        <section class="card"><h3 class="ch">Form, green is +5 to +15</h3>
          <LineChart dates={pd} h={190} label="Projected form with the race-fresh band" include={[0]} band={band} yfmt={(v) => sgn(v)} summary={summarize('Projected form', pd, plan.map((x) => x.tsb), (n) => sgn(n, 1))}
            series={[{ name: 'Your plan', v: plan.map((x) => x.tsb), c: 'var(--s-maint)', w: 2.4 }, { name: 'Rest', v: rest.map((x) => x.tsb), c: 'var(--mute)', dash: '4 5', w: 1.6 }]} />
        </section></div>
    </div>
    <div class="pr" style="margin-top:10px">
      <div class="t"><p class="k">Fitness on day 21</p><div class="v">{num(fin)}</div><span class="n">{sgn(fin - p.ctl, 1)} from today</span></div>
      <div class="t"><p class="k">Form on day 21</p><div class="v">{sgn(end?.tsb)}</div><span class="n">Today it is {sgn(p.ctl - p.atl)}</span></div>
      <div class="t"><p class="k">If you rest</p><div class="v">{num(rest[20].ctl)}</div><span class="n">Fitness after 21 days off</span></div>
      <div class="t"><p class="k">Form if you rest</p><div class="v">{sgn(rest[20].tsb)}</div><span class="n">Fresher, with less fitness</span></div>
    </div>
  </>
}

export function LoadView({ d, range, setRange }: { d: LoadResp; range: string; setRange: (r: string) => void }) {
  if (!d.days.length) return <section class="card"><p class="k">Nothing here yet</p><p class="t0">No training load has been calculated. Run a sync from Settings and come back.</p><a class="btn" href="#/settings">Open Settings</a></section>
  const last = d.days[d.days.length - 1], cut = RANGES.find((r) => r[0] === range)![2], shown = cut ? d.days.slice(-cut) : d.days
  const dates = shown.map((x) => x.date), band = d.acwr_band ?? [0.8, 1.3], flat = (v: number) => shown.map(() => v)
  return <>
    <p class="sub">How hard you have trained and how tired it leaves you. The label and its rules are on <a href="#/insights/status">Training status</a>, the 21 day outlook on <a href="#/insights/forecast">Forecast</a>.</p>
    <div class="tools"><div class="seg" role="group" aria-label="Time range">{RANGES.map(([k, l]) => <button type="button" aria-pressed={range === k} onClick={() => setRange(k)}>{l}</button>)}</div></div>
    <div class="g2 eq">
      <section class="card"><p class="k">Today</p>
        <div class="facts">
          <div><b>{num(last.ctl)}</b><span>Fitness{last.ramp7 != null && `, ${last.ramp7 < 0 ? 'down' : 'up'} ${num(Math.abs(last.ramp7), 1)}`}</span></div><div><b>{num(last.atl)}</b><span>Fatigue</span></div>
          <div><b>{sgn(last.tsb)}</b><span>Form</span></div><div><b>{num(last.acwr, 2)}</b><span>Load ratio</span></div></div>
        <p class="cap2">Fitness is a 42-day average of load. Fatigue is a 7-day average. Form is fitness minus fatigue. Load ratio is 7 days over 28 days.</p>
      </section>
      <section class="card"><h3 class="ch">Fitness and fatigue, {shown.length} days</h3>
        <LineChart dates={dates} h={210} label="Fitness and fatigue over time" summary={summarize('Fitness', dates, shown.map((x) => x.ctl), (n) => num(n, 1)) + ' ' + summarize('Fatigue', dates, shown.map((x) => x.atl), (n) => num(n, 1))}
          series={[{ name: 'Fitness', v: shown.map((x) => x.ctl), c: 'var(--link)', w: 2.8 }, { name: 'Fatigue', v: shown.map((x) => x.atl), c: 'var(--warn)' }]} />
      </section>
    </div>
    <div class="g2" style="margin-top:10px">
      <section class="card"><h3 class="ch">Load ratio, safe range {band[0]} to {band[1]}</h3>
        <LineChart dates={dates} h={190} label="Load ratio over time with the safe range" band={{ lo: flat(band[0]), hi: flat(band[1]) }} yfmt={(v) => num(v, 1)} summary={summarize('Load ratio', dates, shown.map((x) => x.acwr), (n) => num(n, 2))}
          series={[{ name: 'Load ratio', v: shown.map((x) => x.acwr), c: 'var(--link)' }]} />
        <span class="lab">The green band is the safe range.</span>
      </section>
      <section class="card"><h3 class="ch">Form, fitness minus fatigue</h3>
        <LineChart dates={dates} h={190} label="Form over time" include={[0]} summary={summarize('Form', dates, shown.map((x) => x.tsb), (n) => sgn(n, 1))}
          series={[{ name: 'Form', v: shown.map((x) => x.tsb), c: 'var(--s-maint)' }]} yfmt={(v) => sgn(v)} />
        <span class="lab">Above zero you are fresh. Below −20 is heavy fatigue.</span>
      </section>
    </div>

    <h2 class="sh">Load ratio by sport</h2>
    <section class="card">
      <p class="mu" style="margin-bottom:8px">Recent load against what you are used to. The safe range is {band[0]} to {band[1]}.</p>
      <Ratio name="All sports" acwr={last.acwr} band={band} note={`${d.days.length} days of history`} />
      {Object.entries(d.per_sport ?? {}).map(([k, rows]) => {
        const e = rows[rows.length - 1], ok = e && e.date === last.date && e.acwr != null
        return <Ratio name={sport(k)} acwr={ok ? e.acwr : null} band={band} note={ok ? `${e.n35} sessions in 35 days` : 'Fewer than 5 sessions in the last 35 days'} />
      })}
    </section>
  </>
}

function Ratio({ name, acwr, band, note }: { name: string; acwr: number | null; band: number[]; note: string }) {
  const tone = acwr == null ? 'mute' : acwr < band[0] ? 'mute' : acwr <= band[1] ? 'ok' : 'warn', w = acwr == null ? '' : acwr < band[0] ? 'Light' : acwr <= band[1] ? 'In range' : 'High'
  return <div class="rowb"><span>{name}<small class="lab">{note}</small></span>
    {acwr == null ? <span class="mu">Not enough data</span> : <Gauge min={0.4} max={1.8} lo={band[0]} hi={band[1]} v={acwr} />}
    <span><b>{num(acwr, 2)}</b> {w && <Pill tone={tone}>{w}</Pill>}</span></div>
}

export function LoadPage() {
  const [range, setRange] = useState('90')
  const [st, retry] = useApi<LoadResp>(`/api/load?days=${range === 'all' ? 3000 : 400}`)
  return <Page title="Form and Fitness" st={st} retry={retry}>{(d) => <LoadView d={d} range={range} setRange={setRange} />}</Page>
}
