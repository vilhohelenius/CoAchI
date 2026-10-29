import { useContext } from 'preact/hooks'
import { routePath } from './activities'
import { CoachOn, useApi } from './api'
import { pairs } from './heatmap'
import { Carousel } from './carousel'
import { DASH, STATUS_KEY, clock, day, dur, km, num, pace, paceWord, pct, readinessWord, sgn, sleepLabel, statusReason, stressLabel } from './fmt'
import type { GoalProgress, LoadResp, RouteRun, RoutesResp, Today } from './types'

/** Loading skeleton, calm error card with retry, or the view. Every data page goes through this. */
export function Page<T>({ title, st, retry, children }: { title: string; st: ReturnType<typeof useApi<T>>[0]; retry: () => void; children: (d: T) => preact.ComponentChildren }) {
  return <>
    <h1>{title}</h1>
    {st.s === 'loading' ? <div aria-busy="true" aria-label="Loading"><section class="card sk" /></div> : st.s === 'error' ? <Err msg={st.msg} retry={retry} /> : children(st.data)}
  </>
}

export function Err({ msg, retry }: { msg: string; retry: () => void }) {
  return <section class="card err" role="alert"><p class="k">Could not load</p><p class="t0">{msg}</p><button class="btn g" onClick={retry}>Try again</button></section>
}
export const Pill = ({ tone = 'mute', children }: { tone?: string; children: preact.ComponentChildren }) => <span class={`pill ${tone}`}>{children}</span>

export function StatusStrip({ days }: { days: LoadResp['days'] }) {
  const last = days.slice(-28)
  return <div style="margin-top:16px"><div class="strip" role="img" aria-label={`Training status over the last ${last.length} days, now ${last[last.length - 1].status ?? 'unknown'}`}>
    {last.map((x) => <i class={x.warming_up || x.status === 'Not enough data' ? 'w' : ''} title={`${day(x.date, { day: 'numeric', month: 'short' })}: ${x.status ?? DASH}`} style={x.status && STATUS_KEY[x.status] ? `--c:var(--s-${STATUS_KEY[x.status]})` : ''} />)}
  </div><span class="lab" style="margin-top:6px">Status over the last {last.length} days. Faded days had too little history.</span></div>
}

function StatusCard({ d, load }: { d: Today; load?: LoadResp }) {
  const s = d.status
  if (!s) return <section class="card"><p class="k">Training status</p><p class="empty">Not enough data yet.</p></section>
  const ds = load?.days.slice(-28) ?? []
  let i = ds.length; while (i > 0 && ds[i - 1].status === s.label) i--
  const since = ds.length ? day(ds[Math.min(i, ds.length - 1)].date, { day: 'numeric', month: 'short' }) : ''
  return <section class="card" style={`--c:var(--s-${STATUS_KEY[s.label] ?? 'recov'})`}>
    <p class="k"><a class="cl" href="#/insights/status">Training status</a></p>
    <h2 class="ts">{s.label}</h2>
    <p class="why2">{s.reason || statusReason(s)}</p>
    <div class="facts">
      <div><b>{num(s.ctl)}{s.ramp7 != null && <small> {sgn(s.ramp7, 1)}</small>}</b><span>Fitness, change over 7 days</span></div>
      <div><b>{sgn(s.tsb)}</b><span>Form</span></div>
      <div><b>{num(s.acwr, 2)}</b><span>Load ratio</span></div>
    </div>
    {load && load.days.length > 0 && <StatusStrip days={load.days} />}
    {since && <p class="cap"><span>Last 4 weeks</span><span>{s.label} since {since}</span></p>}
  </section>
}

/** Route outline on the map background, or a calm dashed stamp when the activity has no GPS. */
function RouteStamp({ pts }: { pts?: [number, number][] | null }) {
  const r = pts && routePath(pts, 300, 150, 18)
  return <svg class="map" viewBox="0 0 300 150" preserveAspectRatio="xMidYMid slice" role="img" aria-label={r ? 'Route of the latest activity' : 'No route for this activity'}>
    <rect width="300" height="150" fill="var(--m-bg)" />
    {r ? <><path d={r.d} fill="none" stroke="var(--route-case)" stroke-width="7" stroke-linejoin="round" stroke-linecap="round" /><path d={r.d} fill="none" stroke="var(--route)" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round" /></>
      : <path d="M30 100C70 40 110 115 150 70S230 30 270 62" fill="none" stroke="var(--mute)" stroke-width="3" stroke-dasharray="3 9" stroke-linecap="round" opacity=".6" />}
  </svg>
}

function ActivityCard({ d, route }: { d: Today; route?: [number, number][] | null }) {
  const a = d.last_activity
  if (!a) return <section class="card"><p class="k">Latest activity</p><p class="empty">No activities synced yet.</p></section>
  const run = /run|walk|hik/i.test(a.type ?? '')
  const stats: [string, string, string][] = [['Distance', km(a.distance_m), ' km'], ['Time', dur(a.duration_s), '']]
  if (run) stats.push(['Pace', pace(a.distance_m, a.duration_s), ' /km'])
  stats.push(['Avg heart rate', a.avg_hr == null ? DASH : num(a.avg_hr), a.avg_hr == null ? '' : ' bpm'])
  return <section class="card act">
    <p class="k"><a class="cl" href={`#/activities/${a.id}`}>Latest activity</a><span>{day(a.start_local, { weekday: 'short', day: 'numeric', month: 'short' })}</span></p>
    <RouteStamp pts={route} />
    <div class="st">{stats.map(([l, v, u]) => <div><b>{v}<small>{u}</small></b><span>{l}</span></div>)}</div>
    <p class="mu">{a.name ?? 'Activity'}{a.load != null && <> with a load of {num(a.load)}</>}{a.elev_gain_m ? `, ${num(a.elev_gain_m)} m climbed` : ''}</p>
  </section>
}

const STAGES = [['deep_s', 'Deep', 'var(--b5)'], ['rem_s', 'REM', 'var(--s-peak)'], ['light_s', 'Light', 'var(--b3)'], ['awake_s', 'Awake', 'var(--b2)']] as const
function SleepCard({ d }: { d: Today }) {
  const s = d.sleep
  if (!s || s.total_s == null) return <section class="card"><p class="k">Sleep</p><p class="empty">No sleep recorded for last night.</p></section>
  const lab = sleepLabel(s.score), have = STAGES.filter(([k]) => s[k] != null)
  return <section class="card">
    <p class="k"><a class="cl" href="#/insights/sleep">Sleep</a>{lab && <Pill tone={lab === 'Poor' ? 'warn' : 'ok'}>{lab}</Pill>}</p>
    <div class="sleepn">
      {s.score != null ? <span class="sc2">{s.score}</span> : <span class="sc2 dur">{dur(s.total_s)}</span>}
      <span class="st2">{s.score != null ? 'Score' : 'Asleep'}<small>{s.score != null ? `${dur(s.total_s)} asleep` : 'No score for this night'}{s.start_ts && s.end_ts ? `, ${clock(s.start_ts)} to ${clock(s.end_ts)}` : ''}</small></span>
    </div>
    {have.length > 0 ? <>
      <div class="stages" role="img" aria-label="Sleep stages">{have.map(([k, , c]) => <i style={`flex:${s[k]};background:${c}`} />)}</div>
      <div class="legend">{have.map(([k, l, c]) => <span><i style={`background:${c}`} />{l} {dur(s[k])}</span>)}</div>
    </> : <p class="empty">Stage breakdown is not available for this night.</p>}
  </section>
}

const SEGS = ['Poor', 'Low', 'Moderate', 'High']
export function ReadinessCard({ d }: { d: Today }) {
  const r = d.readiness
  if (!r || r.score == null || r.confidence === 'none') return <section class="card"><p class="k">Readiness</p><p class="empty">Not enough data yet to score today.</p></section>
  const on = r.label === 'high' ? 3 : r.label === 'moderate' ? 2 : r.label === 'low' ? 1 : 0, avail = r.components.filter((c) => c.available)
  return <section class="card">
    <p class="k"><a class="cl" href="#/insights/recovery">Readiness</a>{r.capped && <Pill tone="warn">Held down</Pill>}</p>
    <div class="rn"><span class="sc">{Math.round(r.score)}</span><span class="st">{readinessWord(r.label)}<small>out of 100</small></span></div>
    <div class="scale" role="img" aria-label={`Readiness ${Math.round(r.score)} of 100, ${r.label}`}><i /><i /><i /><i /><span class="mk" style={`left:${r.score}%`} /></div>
    <div class="sl">{SEGS.map((b, i) => <span class={i === on ? 'on' : ''}>{b}</span>)}</div>
    <p class="why">{r.confidence === 'low' ? `Only ${avail.length} of ${r.components.length} signals were available, so treat this as a rough guide. ` : ''}{r.drivers.length ? `Mostly driven by ${r.drivers.map((k) => (r.components.find((c) => c.key === k)?.label ?? k)).join(' and ')}.` : ''}</p>
    <details class="parts"><summary>{avail.length} of {r.components.length} signals used</summary>
      {r.components.map((c) => <div class={`rr ${c.available ? '' : 'off'}`}>
        <span>{c.label}<small>{c.available ? `${c.value ?? DASH}, ${num(c.n)} readings` : 'No data today'}</small></span>
        <b>{c.score == null ? DASH : Math.round(c.score)}</b>
        <div class="bar"><i style={`width:${c.score ?? 0}%`} /></div>
      </div>)}
    </details>
  </section>
}

function CoachCard() {
  if (!useContext(CoachOn)) return <section class="card coachc"><p class="k">Coach<Pill>Later</Pill></p><h2>Coach arrives in a later phase</h2><p>Suggestions for your day will show up here once the coach is connected.</p></section>
  return <section class="card coachc"><p class="k">Coach<Pill tone="ok">On</Pill></p><h2>Ask what to do today</h2><p>The coach reads your sleep, HRV, load and notes, then suggests a session.</p>
    <div class="acts"><a class="btn" href="#/coach">Open Coach</a><a class="btn g" href="#/coach">Should I run tomorrow?</a></div></section>
}

export function Gauge({ min, max, lo, hi, v }: { min: number; max: number; lo?: number | null; hi?: number | null; v: number }) {
  return <span class="gs" aria-hidden="true">{lo != null && hi != null && <i class="b" style={`left:${pct(lo, min, max)}%;width:${pct(hi, min, max) - pct(lo, min, max)}%`} />}<i class="m" style={`left:${pct(v, min, max)}%`} /></span>
}
export function Tile({ href, l, v, u, tone, lab, g, n }: { href?: string; l: string; v: string; u?: string; tone?: string; lab?: string; g?: preact.ComponentChildren; n: string }) {
  const body = <><p class="k">{l}{lab && <Pill tone={tone}>{lab}</Pill>}</p><div class="v">{v}{u && <small>{u}</small>}</div>{g}<span class="n">{n}</span></>
  return href ? <a class="t" href={href}>{body}</a> : <div class="t">{body}</div>
}
function Glances({ d }: { d: Today }) {
  const t = d.tiles, h = t?.hrv, rc = t?.recovery, s = d.status
  const hl = h?.status === 'below' ? ['Below baseline', 'warn'] : h?.status === 'above' ? ['Above baseline', 'ok'] : h?.status === 'in_range' ? ['Normal', 'ok'] : []
  const z = rc?.z_rhr, ac = s?.acwr, bb = t?.body_battery_max, ts = s?.tsb
  return <div class="glance">
    <Tile href="#/insights/hrv" l="HRV" v={num(h?.last ?? t?.hrv_last_night)} u=" ms" lab={h?.range_ok ? hl[0] : undefined} tone={hl[1]}
      g={(h?.last ?? t?.hrv_last_night) != null && <Gauge min={30} max={100} lo={h?.range_ok ? h.low : null} hi={h?.range_ok ? h.high : null} v={(h?.last ?? t?.hrv_last_night)!} />}
      n={h?.range_ok ? `Baseline ${num(h.low)} to ${num(h.high)}, from ${h.n_base} nights` : h ? `Still building your baseline, ${h.n_base} nights so far` : 'No overnight reading'} />
    <Tile href="#/insights/rhr" l="Resting HR" v={num(t?.rhr)} u=" bpm" lab={z == null ? undefined : z >= 1 ? 'Above normal' : z <= -1 ? 'Below normal' : 'Normal'} tone={z != null && z >= 1 ? 'warn' : 'ok'}
      n={rc?.rhr7 != null ? `7-day average ${num(rc.rhr7)}` : 'No 7-day average yet'} />
    <Tile href="#/insights/battery" l="Body battery" v={num(t?.body_battery_max)} u=" / 100" lab={bb == null ? undefined : bb >= 60 ? 'High' : bb >= 30 ? 'Moderate' : 'Low'} tone={bb != null && bb < 30 ? 'warn' : 'ok'} g={t?.body_battery_max != null && <Gauge min={0} max={100} v={t.body_battery_max} />} n={t?.body_battery_max != null ? 'Highest level today' : 'No reading today'} />
    <Tile l="Stress" v={num(t?.stress_avg)} u=" avg" lab={t?.stress_avg == null ? undefined : stressLabel(t.stress_avg)} tone="mute" g={t?.stress_avg != null && <Gauge min={0} max={100} v={t.stress_avg} />} n="Daily average out of 100" />
    <Tile href="#/insights/load" l="Form" v={sgn(ts)} lab={ts == null ? undefined : ts < -30 ? 'Very tired' : ts < -10 ? 'Building' : ts <= 5 ? 'Near neutral' : 'Fresh'} tone={ts == null || (ts >= -10 && ts <= 5) ? 'mute' : ts < -30 ? 'warn' : 'ok'}
      g={ts != null && <Gauge min={-30} max={15} lo={-30} hi={-10} v={ts} />} n={ts == null ? 'Not enough data yet' : 'Hard training builds best from −30 to −10'} />
    <Tile href="#/insights/load" l="Load ratio" v={num(ac, 2)} lab={ac == null ? undefined : ac < 0.8 ? 'Light' : ac <= 1.3 ? 'Optimal' : 'High'} tone={ac != null && ac > 1.3 ? 'warn' : 'ok'}
      g={ac != null && <Gauge min={0.4} max={1.8} lo={0.8} hi={1.3} v={ac} />} n="Safe range is 0.8 to 1.3" />
  </div>
}

function Week({ d, runs }: { d: Today; runs?: RouteRun[] }) {
  const w = d.this_week, todayDate = d.data_date
  if (!w || !w.sessions) return <section class="card"><p class="empty">No sessions yet this week.</p></section>
  return <section class="card"><div class="kv wk">
    <div><span class="num">{w.sessions}</span><span class="lab">{w.sessions === 1 ? 'Session' : 'Sessions'}</span></div>
    <div><span class="num">{km(w.distance_m)}<small> km</small></span><span class="lab">Distance</span></div>
    <div><span class="num">{dur(w.duration_s)}</span><span class="lab">Time</span></div>
    <div><span class="num">{num(w.load)}</span><span class="lab">Load</span></div>
  </div>{w.days && <div class="days7" style="margin-top:14px">{w.days.map((x) => {
    const r = runs?.filter((q) => q[1].slice(0, 10) === x.date).sort((p, q) => q[2] - p[2])[0], rp = r && routePath(pairs(r), 60, 44, 4)
    const body = <><span>{day(x.date, { weekday: 'short' })}</span>{rp && <svg class="thumb" viewBox="0 0 60 44" aria-hidden="true"><path d={rp.d} /></svg>}<b>{x.km ? num(x.km, 1) : DASH}</b><span>{x.active_min ? `${num(x.active_min)} min` : 'rest'}</span></>
    return r ? <a class={x.date === todayDate ? 'on' : ''} href={`#/activities/${r[0]}`}>{body}</a> : <div class={x.date === todayDate ? 'on' : ''}>{body}</div>
  })}</div>}<p class="cap2">Since Monday {day(w.start, { day: 'numeric', month: 'short' })}.</p></section>
}

export function GoalsBlock({ p }: { p: GoalProgress | null | undefined }) {
  const y = p?.year, w = p?.week, s = p?.steps
  if (!y && !w && !s) return <section class="card"><p class="empty">No goals set yet.</p></section>
  return <section class="card"><div class="rows gcols">
    {y && <div><div class="h"><span class="l">Yearly distance</span><b>{num(y.ytd_km)} km<small> aiming for {num(y.target_km)} km</small></b></div>
      <div class="bar"><i style={`width:${pct(y.ytd_km, 0, y.target_km)}%`} /></div>
      <p>{paceWord(y.status) ? `You are ${paceWord(y.status)}` : 'Pace is not clear yet'}{y.projected_km != null ? `. At this rate you finish the year near ${num(y.projected_km)} km.` : '.'}</p></div>}
    {w && <div><div class="h"><span class="l">This week, running</span><b>{num(w.km, 1)} km<small> aiming for {num(w.band_lo)} to {num(w.band_hi)} km</small></b></div>
      <div class="bar"><span class="band" style={`left:${pct(w.band_lo, 0, w.band_hi * 1.25)}%;width:${pct(w.band_hi, 0, w.band_hi * 1.25) - pct(w.band_lo, 0, w.band_hi * 1.25)}%`} /><i style={`width:${pct(w.km, 0, w.band_hi * 1.25)}%`} /></div>
      <p>{paceWord(w.status) ? `For the days so far you are ${paceWord(w.status)}.` : 'The week has only just started.'}</p></div>}
    {s && <div><div class="h"><span class="l">Steps today</span><b>{num(s.today)}<small> aiming for {num(s.goal)}</small></b></div>
      <div class="bar"><i style={`width:${pct(s.today ?? 0, 0, s.goal)}%`} /></div>
      <p>{s.streak_days ? `${s.streak_days} days in a row at goal${s.today_pending ? ' so far, today still counts' : ''}. ` : ''}{paceWord(s.status) ? `You are ${paceWord(s.status)}.` : ''}</p></div>}
  </div></section>
}

const Skeleton = () => <div aria-busy="true" aria-label="Loading"><section class="card sk" /><section class="card sk" style="margin-top:10px" /></div>

function brief(d: Today) {
  const sl = d.sleep?.total_s, wk = d.this_week?.distance_m
  return <>{sl != null && <>You slept <b>{dur(sl)}</b>. </>}{wk ? <span class="w">You have covered <b>{km(wk)} km</b> this week.</span> : null}</>
}
const greet = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening' }

export function TodayView({ d, load, route, runs }: { d: Today; load?: LoadResp; route?: [number, number][] | null; runs?: RouteRun[] }) {
  if (!d.data_date) return <section class="card"><p class="k">Nothing here yet</p><p class="t0">No data has synced. Run a sync from Settings and come back.</p><a class="btn" href="#/settings">Open Settings</a></section>
  const b = d.sleep?.total_s != null || d.this_week?.distance_m
  return <>
    <p class="date">Data for {day(d.data_date)}</p>
    <h1>{greet()}</h1>
    {b && <p class="brief">{brief(d)}</p>}
    <Carousel items={[
      { label: 'Training status', node: () => <StatusCard d={d} load={load} /> },
      { label: 'Latest activity', node: () => <ActivityCard d={d} route={route} /> },
      { label: 'Sleep', node: () => <SleepCard d={d} /> },
      { label: 'Readiness', node: () => <ReadinessCard d={d} /> },
    ]} />
    <div style="margin-top:10px"><CoachCard /></div>
    <h2 class="sh">At a glance <a href="#/insights">All insights</a></h2>
    <Glances d={d} />
    <h2 class="sh">This week <a href="#/mileage">Mileage</a></h2>
    <Week d={d} runs={runs} />
    <h2 class="sh">Goals <a href="#/goals">Edit goals</a></h2>
    <GoalsBlock p={d.goals} />
  </>
}

export function TodayPage() {
  const [t, retry] = useApi<Today>('/api/today'), [l] = useApi<LoadResp>('/api/load?days=28')
  const id = t.s === 'ok' ? t.data.last_activity?.id : undefined
  // Map data is a bonus: both calls may fail quietly. The detail call only runs once the latest activity is known.
  const [det] = useApi<{ detail?: { route?: [number, number][] } | null }>(id ? `/api/activities/${id}` : '/api/config'), [rt] = useApi<RoutesResp>('/api/routes')
  return <>
    {t.s === 'loading' && <><h1>Today</h1><Skeleton /></>}
    {t.s === 'error' && <><h1>Today</h1><Err msg={t.msg} retry={retry} /></>}
    {t.s === 'ok' && <TodayView d={t.data} load={l.s === 'ok' ? l.data : undefined} route={id && det.s === 'ok' ? det.data.detail?.route : null} runs={rt.s === 'ok' ? rt.data.runs : undefined} />}
  </>
}
