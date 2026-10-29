import { useState } from 'preact/hooks'
import { useApi } from './api'
import { LineChart, summarize } from './chart'
import { DASH, day, num } from './fmt'
import { Err, Page, Pill, Tile } from './today'
import type { FitnessResp, Prediction, RecordsResp } from './types'

const NAMES: Record<string, string> = { '1k': '1 km', '1mi': '1 mile', '5k': '5 km', '10k': '10 km', hm: 'Half marathon', marathon: 'Marathon' }
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
type Eff = { value: number; date: string; activity_id: number }
const RANGES: [string, string][] = [['all', 'All time'], ['yr', 'This year'], ['l12', 'Last 12 months']]
const when = (d: string, as: string) => (Date.parse(as) - Date.parse(d)) / 864e5

export function RecordsView({ d, sel, setSel }: { d: RecordsResp; sel: string; setSel: (k: string) => void }) {
  const [range, setRange] = useState('all'), [sport, setSport] = useState('run')
  const rows = d.records.filter((r) => r.best.length || r.unit === 's')
  if (!d.available || !d.records.some((r) => r.best.length)) return <section class="card"><p class="k">Not enough data yet</p><p class="t0">Records are read from the second-by-second file of each run. They appear once runs have synced with their files and the records step has run.</p></section>
  const cur = d.records.find((r) => r.label === sel && r.timeline.length) ?? d.records.find((r) => r.timeline.length)!, tl = cur.timeline
  const dates = tl.map((x) => x.date), v = tl.map((x) => x.value), w = cur.unit === 'W', fmt = (n: number, u: string) => (u === 'W' ? `${num(n)} W` : hms(n))
  const pick = (r: RecordsResp['records'][number]): Eff | undefined => (range === 'all' ? r.best[0] : d.ranges?.[range]?.[r.label])
  const rd = d.rides, lo = d.longest, cl = d.climb
  return <>
    {rd && <div class="tools"><div class="seg" role="group" aria-label="Sport">{[['run', 'Running'], ['ride', 'Cycling']].map(([k, l]) => <button type="button" aria-pressed={sport === k} onClick={() => setSport(k)}>{l}</button>)}</div></div>}
    {sport === 'ride' && rd ? <section class="card"><p class="k"><b>Speed bests</b><span>{rd.n} {rd.n === 1 ? 'ride' : 'rides'}</span></p><div class="rl n2">
      {([['Fastest average speed', rd.fastest, (a: NonNullable<typeof rd.fastest>) => [num((a.distance_m! / a.duration_s!) * 3.6, 1), 'km/h']], ['Longest ride', rd.longest, (a: NonNullable<typeof rd.longest>) => [num(a.distance_m! / 1000, 1), 'km']], ['Biggest climb', rd.climb, (a: NonNullable<typeof rd.climb>) => [num(a.elev_gain_m), 'm']]] as const).map(([l, a, f]) => a && <a href={`#/activities/${a.id}`}>
        <span><span class="nm">{l}</span><span class="ms">{short(a.date)}</span></span><span class="rv">{f(a as never)[0]}<small>{f(a as never)[1]}</small></span></a>)}</div></section> : <>
    <div class="tools"><div class="seg" role="group" aria-label="Time range">{RANGES.map(([k, l]) => <button type="button" aria-pressed={range === k} onClick={() => setRange(k)}>{l}</button>)}</div></div>
    <div class="g2">
      <section class="card"><p class="k"><b>Best efforts</b><span>tap a row for its chart</span></p>
        <div class="tw"><table class="tbl"><thead><tr><th scope="col">Distance</th><th scope="col" class="r">Time</th><th scope="col" class="r">Pace</th><th scope="col">When</th></tr></thead><tbody>
          {rows.map((r) => { const b = pick(r), on = r.label === cur.label, go = r.timeline.length > 0, w2 = r.unit === 'W', pr = b && r.best[0] && b.activity_id === r.best[0].activity_id
            return <tr class={on ? 'hit' : ''} tabindex={go ? 0 : undefined} role={go ? 'button' : undefined} aria-pressed={go ? on : undefined} onClick={go ? () => setSel(r.label) : undefined} onKeyDown={go ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSel(r.label) } } : undefined}>
              <td><b>{NAMES[r.label] ?? r.label}</b></td>
              {b ? <><td class="r">{fmt(b.value, r.unit)}</td><td class="r">{w2 ? DASH : `${hms(b.value / (DIST[r.label] / 1000))} /km`}</td>
                <td>{b.activity_id > 0 ? <a href={`#/activities/${b.activity_id}`}>{short(b.date)}</a> : short(b.date)}{pr && (when(b.date, d.as_of) <= 45 ? <> <Pill tone="ok">New PR</Pill></> : <> <Pill>PR</Pill></>)}{b.activity_id < 0 && <small class="nx"> Entered by hand</small>}</td></>
                : <><td class="r empty" colspan={2}>Not yet</td><td class="empty">{range === 'all' ? 'No run this long' : 'No run in this range'}</td></>}
            </tr> })}
        </tbody></table></div>
        <p class="cap2">Fastest continuous stretch of each distance, measured on moving distance. Stretches with a recording gap or a GPS jump are skipped. {num(d.n_runs)} {d.n_runs === 1 ? 'run' : 'runs'} read.</p>
      </section>
      <div class="pg">
        <section class="card"><p class="k"><b>{NAMES[cur.label]} over time</b><span>line is the best so far</span></p>
          {tl.length < 2 ? <p class="empty">Only one record so far, set on {short(tl[0].date)}. The timeline draws once a second record is set.</p>
            : <LineChart dates={dates} xf={(x) => day(x, { month: 'short', year: '2-digit' })} h={200} yfmt={(x) => (w ? num(x) : hms(x))} unit={w ? ' W' : ''} label={`${NAMES[cur.label]} personal bests over time`} series={[{ name: NAMES[cur.label], v, c: 'var(--link)', w: 2.6 }]}
              summary={summarize(NAMES[cur.label], dates, v, (n) => (w ? num(n) : hms(n)), w ? ' W' : '')} tip={(i) => [short(dates[i]), w ? `${num(v[i])} W` : hms(v[i])]} />}
          <p class="cap2">{tl.length} {tl.length === 1 ? 'record' : 'records'} set so far. Each point is a new best on the day it happened.</p>
        </section>
        {lo && <section class="card"><div class="kv">
          <div><span class="num">{num((lo.distance_m ?? 0) / 1000, 1)}<small> km</small></span><span class="lab">Longest run</span></div>
          <div><span class="num">{num(lo.elev_gain_m)}<small> m</small></span><span class="lab">Climb on it</span></div>
          {cl && <><div><span class="num">{num(cl.elev_gain_m)}<small> m</small></span><span class="lab">Biggest climb</span></div><div><span class="num">{num((cl.distance_m ?? 0) / 1000, 1)}<small> km</small></span><span class="lab">Distance of it</span></div></>}</div>
          <p class="cap2">Longest: {short(lo.date)}.{cl && <> Biggest climb: {short(cl.date)}.</>} <a href={`#/activities/${lo.id}`}>Open longest run</a></p></section>}
      </div>
    </div></>}
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
