import { useState } from 'preact/hooks'
import { useApi } from './api'
import { LineChart, summarize } from './chart'
import { DASH, day, num } from './fmt'
import { Err, Page, Tile } from './today'
import type { FitnessResp, Prediction, RecordsResp } from './types'

const NAMES: Record<string, string> = { '1k': '1 km', '1mi': '1 mile', '5k': '5 km', '10k': '10 km', hm: 'Half marathon', marathon: 'Marathon', p60: 'Power, 1 min', p300: 'Power, 5 min', p1200: 'Power, 20 min' }
const DIST: Record<string, number> = { '1k': 1000, '1mi': 1609.344, '5k': 5000, '10k': 10000, hm: 21097.5 }
const K = [1.04, 1.06, 1.08]
const short = (d: string) => day(d, { day: 'numeric', month: 'short', year: 'numeric' })

/** 1495 -> "24:55", 5400 -> "1:30:00" */
export function hms(s: number | null | undefined) {
  if (s == null || !Number.isFinite(s)) return DASH
  const t = Math.round(s), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), x = t % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`
}
const perKm = (mps: number) => hms(1000 / mps)
const ago = (d: number) => (d < 14 ? `${d} days ago` : d < 120 ? `${Math.round(d / 7)} weeks ago` : `${Math.round(d / 30)} months ago`)

// ---- records ----
export function RecordsView({ d, sel, setSel }: { d: RecordsResp; sel: string; setSel: (k: string) => void }) {
  const rows = d.records.filter((r) => r.best.length)
  if (!d.available || !rows.length) return <section class="card"><p class="k">Not enough data yet</p><p class="t0">Records are read from the second-by-second file of each run. They appear once runs have synced with their files and the records step has run.</p><a class="btn" href="#/settings">Open Settings</a></section>
  const cur = d.records.find((r) => r.label === sel && r.timeline.length) ?? d.records.find((r) => r.timeline.length)!, tl = cur.timeline
  const dates = tl.map((x) => x.date), v = tl.map((x) => x.value), w = cur.unit === 'W'
  return <>
    <section class="card wide"><h3 class="ch">Best efforts across {num(d.n_runs)} {d.n_runs === 1 ? 'run' : 'runs'}</h3>
      <table class="rt"><thead><tr><th>Distance</th><th>Best</th><th>{rows.some((r) => r.unit === 's') ? 'Pace' : ''}</th><th>Set on</th></tr></thead><tbody>
        {rows.map((r) => { const b = r.best[0], w2 = r.unit === 'W'; return <tr>
          <td>{NAMES[r.label]}{r.best.length > 1 && <small class="nx">Next: {r.best.slice(1).map((x) => w2 ? `${num(x.value)} W` : hms(x.value)).join(', ')}</small>}</td>
          <td class="b">{w2 ? `${num(b.value)} W` : hms(b.value)}</td><td>{w2 ? '' : `${hms(b.value / (DIST[r.label] / 1000))} /km`}</td><td>{short(b.date)}</td></tr> })}
      </tbody></table>
      <p class="cap2">Fastest continuous stretch of each distance, measured on moving distance. Stretches with a recording gap or a GPS jump are skipped. Power needs unbroken power readings.</p>
    </section>
    <section class="card wide"><h3 class="ch">How your best {NAMES[cur.label].toLowerCase()} changed</h3>
      <div class="tools"><div class="seg w" role="group" aria-label="Distance">{d.records.filter((r) => r.timeline.length).map((r) => <button type="button" aria-pressed={r.label === cur.label} onClick={() => setSel(r.label)}>{NAMES[r.label].replace('Half marathon', 'Half')}</button>)}</div></div>
      {tl.length < 2 ? <p class="empty">Only one record so far, set on {short(tl[0].date)}. The timeline draws once a second record is set.</p>
        : <LineChart dates={dates} xf={(x) => day(x, { month: 'short', year: '2-digit' })} h={210} yfmt={(x) => (w ? num(x) : hms(x))} unit={w ? ' W' : ''} label={`${NAMES[cur.label]} personal bests over time`} series={[{ name: NAMES[cur.label], v, c: 'var(--link)' }]}
          summary={summarize(NAMES[cur.label], dates, v, (n) => (w ? num(n) : hms(n)), w ? ' W' : '')} tip={(i) => [short(dates[i]), w ? `${num(v[i])} W` : hms(v[i])]} />}
      <p class="cap2">{tl.length} {tl.length === 1 ? 'record' : 'records'} set so far. Each point is a new best on the day it happened.</p>
    </section>
  </>
}

// ---- estimates ----
const FLAG: Record<string, string> = {
  old: 'The source effort is more than 8 weeks old, so this is a rough guide.',
  short: 'This reaches well beyond the source distance. Long races also depend on weekly mileage, which this does not see.',
}
function Card({ p }: { p: Prediction }) {
  const s = p.source, same = s && Math.abs(s.dist_m - p.dist_m) < 1
  return <section class="card"><p class="k">{NAMES[p.label]}</p>
    {p.point_s == null || !s ? <p class="empty">No recent effort to predict from.</p> : <>
      <div class="v2">{hms(p.point_s)}</div>
      <p class="mu">{same ? 'Your best from the last 6 months' : <>Likely range {hms(p.lo_s)} to {hms(p.hi_s)}</>}. Pace {hms(p.point_s / (p.dist_m / 1000))} /km.</p>
      <p class="cap2">{same ? `Set ${ago(s.age_days)}.` : `From your best ${NAMES[s.label].toLowerCase()}, set ${ago(s.age_days)}.`}{p.cs_s != null && ` Critical speed points to ${hms(p.cs_s)}.`}</p>
      {p.flags.map((f) => <p class="cap2 fl">{FLAG[f]}</p>)}</>}
  </section>
}

export function FitnessView({ f, k, setK }: { f: FitnessResp; k: number; setK: (k: number) => void }) {
  if (!f.available || !f.vo2) return <section class="card"><p class="k">Estimates not ready</p><p class="t0">VO2max, critical speed and race predictions are worked out from your best efforts. They appear after the records step has run.</p></section>
  const { vo2, cs, predictions: pr = [] } = f, h = vo2.history, hv = h.map((x) => x.value), nh = hv.filter((x) => x != null).length
  const win = `${day(vo2.from, { day: 'numeric', month: 'short' })} to ${day(vo2.to, { day: 'numeric', month: 'short' })}`
  return <>
    <h2 class="sh">Fitness estimates</h2>
    <div class="glance">
      <Tile l="VO2max estimate" v={vo2.value == null ? DASH : num(vo2.value)} u={vo2.value == null ? undefined : ' ml/kg/min'} lab="Estimate" tone="mute"
        n={vo2.value == null ? `Not enough steady runs yet. ${vo2.n} of 3 needed, ${win}.` : `Median of ${vo2.n} steady runs, ${win}.`} />
      <Tile l="Critical speed" v={cs?.ok ? perKm(cs.cs!) : DASH} u={cs?.ok ? ' /km' : undefined} lab="Estimate" tone="mute"
        n={cs?.ok ? `Pace you can hold for about 30 minutes. Reserve of ${num(cs.dprime)} m above it. Fit on ${cs.n} efforts, r² ${num(cs.r2, 3)}, ${day(cs.from, { day: 'numeric', month: 'short' })} to ${day(cs.to, { day: 'numeric', month: 'short' })}.`
          : cs?.reason === 'few' ? `Needs best efforts of 3 to 20 minutes from at least 3 lengths in the last 90 days. Found ${cs.n}.` : `The last 90 days of efforts do not line up well enough for a reliable fit (${cs?.n ?? 0} efforts, r² ${num(cs?.r2, 2)}).`} />
    </div>
    <section class="card wide"><h3 class="ch">VO2max estimate by week, last 26 weeks</h3>
      {nh < 2 ? <p class="empty">The trend draws once at least two weeks have enough steady runs.</p>
        : <LineChart dates={h.map((x) => x.week_start)} h={190} unit=" ml/kg/min" yfmt={(x) => num(x)} label="VO2max estimate per week" series={[{ name: 'VO2max estimate', v: hv, c: 'var(--b5)' }]}
          summary={summarize('VO2max estimate', h.map((x) => x.week_start), hv, (n) => num(n, 1), ' ml/kg/min')}
          tip={(i) => [`Week of ${day(h[i].week_start, { day: 'numeric', month: 'short' })}`, hv[i] == null ? `Only ${h[i].n} steady runs in 28 days` : `${num(hv[i], 1)} ml/kg/min from ${h[i].n} runs`]} />}
      <p class="cap2">Built from pace and heart rate on even 5-minute stretches of your runs, using the standard running oxygen cost and your heart rate reserve. Heat, hills and tired days shift it a few points. It is our own estimate and will not match your watch.</p>
    </section>
    <h2 class="sh">Race predictions</h2>
    <div class="tools"><div class="seg" role="group" aria-label="Riegel exponent">{K.map((x) => <button type="button" aria-pressed={x === k} onClick={() => setK(x)}>Exponent {x.toFixed(2)}</button>)}</div></div>
    <div class="pg">{pr.map((p) => <Card p={p} />)}</div>
    <p class="cap2">Predictions scale your best recent effort with the Riegel formula, time x (distance ratio) ^ exponent. The range shows the exponent 0.03 lower and higher. A higher exponent means more slowing over longer distances.</p>
  </>
}

export function RecordsPage() {
  const [sel, setSel] = useState('5k'), [k, setK] = useState(1.06)
  const [st, retry] = useApi<RecordsResp>('/api/records'), [fs, fretry] = useApi<FitnessResp>(`/api/fitness-estimates?riegel=${k}`)
  return <Page title="Records and predictions" st={st} retry={retry}>{(d) => <>
    <RecordsView d={d} sel={sel} setSel={setSel} />
    {fs.s === 'ok' ? <FitnessView f={fs.data} k={k} setK={setK} /> : fs.s === 'loading' ? <section class="card sk" aria-busy="true" /> : <Err msg={fs.msg} retry={fretry} />}
  </>}</Page>
}
