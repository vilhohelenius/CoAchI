import { useEffect, useState } from 'preact/hooks'
import { useApi } from './api'
import { LineChart, StackedBars } from './chart'
import { DASH, day, dur, km, num, pace } from './fmt'
import { DynamicsCard } from './dynamics'
import { ShoeCard } from './shoes'
import { Err, Page, Pill, Tile } from './today'
import type { ActDetail, ActList, ActResp, ActRow, Lap } from './types'

const SPORT: Record<string, string> = { run: 'Running', bike: 'Cycling', ski: 'Skiing', strength: 'Strength', other: 'Other' }
const sportName = (s?: string) => SPORT[s ?? 'other'] ?? 'Other'
const FILTERS: [string, string][] = [['all', 'All'], ['run', 'Run'], ['bike', 'Bike'], ['ski', 'Ski'], ['strength', 'Strength']]
const footed = (s?: string, t?: string | null) => s === 'run' || /walk|hik/i.test(t ?? '')
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`
const clockOf = (s: number) => (s >= 3600 ? `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(Math.round(s % 60)).padStart(2, '0')}` : mmss(s))
const paceOf = (mps: number | null | undefined) => (mps && mps > 0.3 ? mmss(1000 / mps) : DASH)

// ---- list ----
function Row({ a }: { a: ActRow }) {
  const run = footed(a.sport, a.type), has = (a.distance_m ?? 0) > 0
  return <a class="arow" href={`#/activities/${a.id}`}>
    <span class="at"><b>{a.name || sportName(a.sport)}</b><small>{day(a.start_local, { weekday: 'short', day: 'numeric', month: 'short' })} · {sportName(a.sport)}</small></span>
    <span class="av">{has && <b>{km(a.distance_m)}<small> km</small></b>}<small>{dur(a.duration_s)}{run && has ? ` · ${pace(a.distance_m, a.duration_s)} /km` : ''}{a.avg_hr != null ? ` · ${num(a.avg_hr)} bpm` : ''}</small></span>
  </a>
}

export function ActivitiesView({ items, sport, setSport, more, onMore, busy, err }: { items: ActRow[]; sport: string; setSport: (s: string) => void; more: boolean; onMore: () => void; busy: boolean; err: string | null }) {
  return <>
    <p class="sub">Everything you have recorded, newest first.</p>
    <div class="tools"><div class="seg" role="group" aria-label="Sport">{FILTERS.map(([k, l]) => <button type="button" aria-pressed={sport === k} onClick={() => setSport(k)}>{l}</button>)}</div></div>
    {!items.length && !err ? <section class="card"><p class="k">Nothing here yet</p><p class="t0">{sport === 'all' ? 'No activities have synced.' : `No ${sportName(sport).toLowerCase()} activities have synced.`}</p><a class="btn" href="#/settings">Open Settings</a></section>
      : <section class="card alist">{items.map((a) => <Row a={a} />)}</section>}
    {err && <Err msg={err} retry={onMore} />}
    {more && !err && <p style="text-align:center;margin:14px 0"><button class="btn g" disabled={busy} onClick={onMore}>{busy ? 'Loading' : 'Load more'}</button></p>}
  </>
}

export function ActivitiesPage() {
  const [sport, setSport] = useState('all'), [items, setItems] = useState<ActRow[]>([]), [next, setNext] = useState<string | null>(null)
  const [busy, setBusy] = useState(true), [err, setErr] = useState<string | null>(null), [tick, setTick] = useState(0)
  const load = (before: string | null, reset: boolean) => {
    setBusy(true); setErr(null)
    fetch(`/api/activities?limit=30&sport=${sport}${before ? `&before=${encodeURIComponent(before)}` : ''}`)
      .then(async (r) => { if (!r.ok) throw new Error(r.status === 401 ? 'Your session expired. Reload the page to sign in again.' : `The server answered ${r.status}.`); return (await r.json()) as ActList })
      .then((d) => { setItems((x) => (reset ? d.activities : [...x, ...d.activities])); setNext(d.next_before) })
      .catch((e: Error) => setErr(e.message === 'Failed to fetch' ? 'The server did not answer.' : e.message))
      .finally(() => setBusy(false))
  }
  useEffect(() => { setItems([]); setNext(null); load(null, true) }, [sport, tick])
  return <>
    <h1>Activities</h1>
    {busy && !items.length && !err ? <><div class="tools"><div class="seg" /></div><div aria-busy="true" aria-label="Loading"><section class="card sk" /></div></>
      : <ActivitiesView items={items} sport={sport} setSport={setSport} more={next != null} busy={busy} err={err} onMore={() => (err && !items.length ? setTick((t) => t + 1) : load(next, false))} />}
  </>
}

// ---- detail ----
const LOAD_SRC: Record<string, string> = { zones: 'From time in heart rate zones', avg_hr: 'From average heart rate', rpe: 'From perceived effort' }
const ZC = ['var(--b5)', 'var(--b3)', 'var(--b2)', 'var(--b1)', 'var(--s-over)']
const STEP: Record<string, string> = { warmup: 'Warm-up', active: 'Interval', recovery: 'Recovery', rest: 'Rest', cooldown: 'Cool-down', other: 'Other' }

/** Projection of lat/lon into a w x h box, keeping the aspect ratio. `q` clips that share of the extremes off each side of the bounds, so a far-off trip does not shrink the rest. */
export function fitter(pts: [number, number][], w = 300, h = 190, pad = 14, q = 0) {
  const k = Math.cos((pts[0][0] * Math.PI) / 180)
  const span = (v: number[]) => { const o = v.sort((a, b) => a - b); return [o[Math.floor(q * (o.length - 1))], o[Math.ceil((1 - q) * (o.length - 1))]] }
  const [x0, x1] = span(pts.map((p) => p[1] * k)), [y0, y1] = span(pts.map((p) => -p[0]))
  const s = Math.min((w - 2 * pad) / (x1 - x0 || 1e-9), (h - 2 * pad) / (y1 - y0 || 1e-9)), ox = pad + (w - 2 * pad - (x1 - x0) * s) / 2, oy = pad + (h - 2 * pad - (y1 - y0) * s) / 2
  return (p: [number, number]) => [ox + (p[1] * k - x0) * s, oy + (-p[0] - y0) * s] as [number, number]
}
/** SVG path of one route fitted to its own box, with the start and end points. */
export function routePath(pts: [number, number][], w = 300, h = 190, pad = 14) {
  if (pts.length < 2) return null
  const P = pts.map(fitter(pts, w, h, pad))
  return { d: 'M' + P.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join('L'), a: P[0], b: P.at(-1)! }
}

function Route({ pts }: { pts: [number, number][] }) {
  const r = routePath(pts)
  return <section class="card act"><p class="k">Route</p>
    {r ? <svg class="map" style="height:auto" viewBox="0 0 300 190" role="img" aria-label="Route of this activity, start and finish marked"><rect width="300" height="190" fill="var(--m-bg)" />
      <path d={r.d} fill="none" stroke="var(--link)" stroke-width="3" stroke-linejoin="round" stroke-linecap="round" />
      <circle cx={r.a[0]} cy={r.a[1]} r="5" fill="var(--ok)" /><circle cx={r.b[0]} cy={r.b[1]} r="5" fill="var(--s-over)" /></svg> : null}
    <p class="mu">Green is the start, red is the finish.</p></section>
}

function Charts({ d, run, type }: { d: ActDetail; run: boolean; type: 'pace' | 'speed' }) {
  const n = d.hr.length || d.speed.length, step = d.duration_s / Math.max(1, n - 1), dates = Array.from({ length: n }, (_, i) => clockOf(i * step))
  const spd = d.speed.map((v) => (v != null && v > 0.5 ? v : null))
  const defs: { t: string; v: (number | null)[]; c: string; f: (x: number) => string; u: string }[] = [
    { t: 'Heart rate', v: d.hr, c: 'var(--s-over)', f: (x) => num(x), u: ' bpm' },
    type === 'pace' ? { t: 'Pace', v: spd.map((v) => (v == null ? null : -Math.min(900, 1000 / v))), c: 'var(--link)', f: (x) => mmss(-x), u: ' /km' }
      : { t: 'Speed', v: spd.map((v) => (v == null ? null : v * 3.6)), c: 'var(--link)', f: (x) => num(x, 1), u: ' km/h' },
    { t: 'Cadence', v: d.cad.map((v) => (v != null && v > 0 ? v : null)), c: 'var(--b5)', f: (x) => num(x), u: run ? ' steps/min' : ' rpm' },
    { t: 'Elevation', v: d.alt ?? [], c: 'var(--ink)', f: (x) => num(x), u: ' m' },
  ]
  const shown = defs.filter((s) => s.v.some((x) => x != null))
  if (!shown.length || n < 2) return null
  return <>{shown.map((s) => {
    const vs = s.v.filter((x): x is number => x != null), avg = vs.reduce((a, x) => a + x, 0) / vs.length
    return <section class="card"><h3 class="ch">{s.t}</h3>
      <LineChart dates={dates} xf={(x) => x} h={170} yfmt={s.f} unit={s.u} label={`${s.t} over the activity`} series={[{ name: s.t, v: s.v, c: s.c, w: 1.8 }]}
        summary={`${s.t}: average ${s.f(avg)}${s.u} over ${clockOf(d.duration_s)}.`} tip={(i) => [dates[i], `${s.t} ${s.v[i] == null ? DASH : s.f(s.v[i] as number) + s.u}`]} />
    </section>
  })}</>
}

const WHY: Record<string, string> = {
  no_hr: 'This run has no heart rate data, so efficiency cannot be worked out.',
  short: 'Efficiency needs a steady stretch of at least 20 minutes after a 10 minute warm-up. This activity is too short.',
  variable: 'The pace changed too much for a fair reading. Steady, easy runs work best.',
}
function Efficiency({ d }: { d: ActDetail | null }) {
  if (!d || d.ef == null) return <section class="card"><p class="k">Efficiency and drift<Pill>Not enough data</Pill></p><p class="t0">{d ? WHY[d.why] ?? WHY.short : 'This appears once the activity file has synced.'}</p></section>
  const x = d.decoupling, w = x == null ? null : x < 5 ? ['Held steady', 'ok'] : x <= 7 ? ['Some drift', 'mute'] : ['Drifted', 'warn']
  return <section class="card"><p class="k">Efficiency and drift{w && <Pill tone={w[1]}>{w[0]}</Pill>}</p>
    <div class="kv"><div><span class="num">{num(d.ef, 2)}</span><span class="lab">Efficiency, metres per minute per beat</span></div>
      <div><span class="num">{x == null ? DASH : `${x > 0 ? '+' : ''}${num(x, 1)}`}<small>{x == null ? '' : ' %'}</small></span><span class="lab">Heart rate drift</span></div></div>
    <p class="cap2">Efficiency is how fast you move for each heartbeat. Drift compares the first and second half of the steady part. Under 5% on an easy run means your aerobic engine held up.{x == null ? ' Drift needs at least 40 minutes in total.' : ''} Hills and heat both push it up.</p></section>
}

/** Kilometre splits as bars, shorter pace is a longer bar, as in the mock. */
function Splits({ sp }: { sp: NonNullable<ActDetail['splits']> }) {
  const lo = Math.min(...sp.map((x) => x.s)), hi = Math.max(...sp.map((x) => x.s))
  return <section class="card"><h3 class="ch">Kilometre splits, pace and heart rate</h3>
    {sp.map((x) => <div class="spl"><span>{x.km}</span><span>{mmss(x.s)}</span><i style={`width:${40 + ((hi - x.s) / (hi - lo || 1)) * 58}%`} /><span>{num(x.hr)}</span></div>)}</section>
}

const STEP_C: Record<string, string> = { warmup: 'var(--b5)', active: 'var(--b1)', recovery: 'var(--b3)', rest: 'var(--b3)', cooldown: 'var(--b5)', other: 'var(--mute)' }
/** One bar per interval step, taller is faster. Only steps with a speed count. */
function StepBars({ laps, only, title }: { laps: Lap[]; only?: string; title: string }) {
  const ls = laps.filter((l) => l.step_type !== 'lap' && (!only || l.step_type === only) && (l.avg_speed_mps ?? 0) > 0)
  if (ls.length < 2) return null
  const types = [...new Set(ls.map((l) => l.step_type))], sp = ls.map((l) => l.avg_speed_mps! * 3.6), nm = (l: Lap) => `${STEP[l.step_type] ?? 'Step'}${l.rep_no ? ` ${l.rep_no}` : ''}`
  return <section class="card"><h3 class="ch">{title}, taller is faster</h3>
    <StackedBars dates={ls.map(nm)} xf={(x) => x} h={170} yfmt={(v) => (v > 0 ? mmss(3600 / v) : '')} label={`${title}, pace per step`} legend={types.length > 1}
      summary={`${title}: ${ls.length} steps, fastest ${mmss(3600 / Math.max(...sp))} per km, slowest ${mmss(3600 / Math.min(...sp))} per km.`}
      stacks={types.map((t) => ({ name: STEP[t] ?? 'Step', c: STEP_C[t] ?? 'var(--mute)' }))} vals={ls.map((l, i) => types.map((t) => (l.step_type === t ? sp[i] : 0)))}
      tip={(i) => [nm(ls[i]), `${mmss(3600 / sp[i])} /km`, `${num(ls[i].avg_hr)} bpm`]} />
  </section>
}

function Table({ title, head, rows }: { title: string; head: string[]; rows: string[][] }) {
  return <section class="card"><h3 class="ch">{title}</h3><div class="tw"><table class="tbl"><thead><tr>{head.map((h, i) => <th scope="col" class={i ? 'r' : ''}>{h}</th>)}</tr></thead>
    <tbody>{rows.map((r) => <tr>{r.map((c, i) => <td class={i ? 'r' : ''}>{c}</td>)}</tr>)}</tbody></table></div></section>
}

export function ActivityView({ d }: { d: ActResp }) {
  const a = d.activity, det = d.detail, foot = footed(a.sport, a.type), run = a.sport === 'run', gps = (det?.route.length ?? 0) > 1
  const hasD = (a.distance_m ?? 0) > 0, ride = a.sport === 'bike'
  const rpe = a.rpe == null ? null : a.rpe > 10 ? a.rpe / 10 : a.rpe
  const tiles: [string, string, string, string][] = hasD ? [['Distance', km(a.distance_m), ' km', ''], ['Time', dur(a.duration_s), '', a.moving_s != null ? `${dur(a.moving_s)} moving` : '']] : [['Time', dur(a.duration_s), '', '']]
  if (hasD) tiles.push(foot ? ['Pace', pace(a.distance_m, a.duration_s), ' /km', ''] : ['Speed', a.duration_s ? num(((a.distance_m ?? 0) / a.duration_s) * 3.6, 1) : DASH, ' km/h', ''])
  tiles.push(['Heart rate', num(a.avg_hr), a.avg_hr == null ? '' : ' bpm', a.max_hr != null ? `Highest ${num(a.max_hr)}` : 'Average'])
  if (hasD) tiles.push(['Climbing', num(a.elev_gain_m), a.elev_gain_m == null ? '' : ' m', ''])
  tiles.push(['Load', num(a.load), '', LOAD_SRC[a.load_source ?? ''] ?? 'Training load'])
  if (a.avg_power != null && ride) tiles.push(['Power', num(a.avg_power), ' W', a.norm_power != null ? `Normalised ${num(a.norm_power)} W` : 'Average'])
  if (a.aero_te != null) tiles.push(['Aerobic effect', num(a.aero_te, 1), ' of 5', 'Garmin training effect'])
  if (rpe != null) tiles.push(['Effort', num(rpe), ' of 10', 'Your own rating'])
  const z = [a.hr_z1_s, a.hr_z2_s, a.hr_z3_s, a.hr_z4_s, a.hr_z5_s].map((s) => s ?? 0), zt = z.reduce((s, x) => s + x, 0)
  const split = det?.splits ?? []
  return <>
    <p class="sub"><a href="#/activities">All activities</a> · {day(a.start_local, { weekday: 'long', day: 'numeric', month: 'long' })} · {sportName(a.sport)}</p>
    <div class="glance">{tiles.map(([l, v, u, n]) => <Tile l={l} v={v} u={u || undefined} n={n || ' '} />)}</div>
    <div class="g2" style="margin-top:10px">
      {run && <ShoeCard id={a.id} shoe={a.shoe_id ?? null} />}
      {gps && <Route pts={det!.route} />}
      {zt > 0 && <section class="card"><h3 class="ch">Time in heart rate zones</h3>
        <div class="stages" role="img" aria-label={`Zone minutes: ${z.map((s, i) => `zone ${i + 1} ${Math.round(s / 60)}`).join(', ')}`}>{z.map((s, i) => s > 0 && <i style={`flex:${s};background:${ZC[i]}`} />)}</div>
        <div class="legend">{z.map((s, i) => <span><i style={`background:${ZC[i]}`} />Zone {i + 1}, {num(s / 60)} min</span>)}</div></section>}
      {det ? <Charts d={det} run={foot} type={foot ? 'pace' : 'speed'} />
        : <section class="card"><p class="k">Charts</p><p class="t0">{a.sport === 'strength' ? 'Strength sessions have no route or pace, so only the summary and zones are shown.' : a.fit_status === 'error' ? 'The activity file could not be read, so there are no charts for this one.' : 'Charts, route and splits come from the activity file, which has not synced for this activity.'}</p></section>}
      {run && <Efficiency d={det} />}
      {run && <DynamicsCard a={a} det={det} />}
      {d.laps.length > 1 && <Table title="Laps" head={['Lap', foot ? 'Distance' : 'Distance', 'Time', foot ? 'Pace' : 'Speed', 'Heart rate']}
        rows={d.laps.map((l: Lap) => [l.step_type === 'lap' ? `Lap ${l.lap_idx + 1}` : `${STEP[l.step_type] ?? 'Lap'}${l.rep_no ? ` ${l.rep_no}` : ''}`, `${km(l.distance_m, 2)} km`, dur(l.duration_s), foot ? paceOf(l.avg_speed_mps) : l.avg_speed_mps ? num(l.avg_speed_mps * 3.6, 1) + ' km/h' : DASH, num(l.avg_hr)])} />}
      {split.length > 0 && foot && <Splits sp={split} />}
      {foot && <StepBars laps={d.laps} title="Pace by step" />}
      {foot && <StepBars laps={d.laps} only="active" title="Work reps" />}
    </div>
  </>
}

export function ActivityPage({ id }: { id: string }) {
  const [st, retry] = useApi<ActResp>(`/api/activities/${encodeURIComponent(id)}`)
  return <Page title={st.s === 'ok' ? st.data.activity.name || sportName(st.data.activity.sport) : 'Activity'} st={st} retry={retry}>{(d) => <ActivityView d={d} />}</Page>
}
