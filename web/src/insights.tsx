import { useContext, useState } from 'preact/hooks'
import type { ComponentChildren } from 'preact'
import { CoachOn, useApi } from './api'
import { LineChart, StackedBars, summarize } from './chart'
import { DASH, STATUS_KEY, clock, readinessWord, day, dur, num, sgn, sleepLabel, statusReason } from './fmt'
import { ForecastView, LoadPage, RulesCard, StatusBody } from './load'
import { IntensityPage } from './intensity'
import { CorrView, type CorrResp } from './correlations'
import { DynamicsPage } from './dynamics'
import { RecoveryView, STAGE } from './recovery'
import { Page, Pill, StatusStrip } from './today'
import { mean } from '../../src/metrics/dates'
import type { IntensityResp, LoadResp, RecDay, RecoveryResp, Today } from './types'

type Num = number | null | undefined
const nums = (xs: Num[]) => xs.filter((x): x is number => typeof x === 'number')
const avg = (xs: Num[]) => { const v = nums(xs); return v.length ? mean(v) : null }
const hi = (xs: Num[]) => { const v = nums(xs); return v.length ? Math.max(...v) : null }
const lo = (xs: Num[]) => { const v = nums(xs); return v.length ? Math.min(...v) : null }

/** The card with the "Explain this" button. The text is fixed wording filled with today's numbers. With the coach on, the Worker rewrites it in plain words (cached per day) and the fixed text stays as the fallback. */
export function Explain({ title, items, style, children }: { title: string; items: [string, string][]; style?: string; children?: ComponentChildren }) {
  const [open, setOpen] = useState(false), [ai, setAi] = useState<string | null>(null), [lim, setLim] = useState(false), on = useContext(CoachOn), id = 'x-' + title.replace(/\W+/g, '-').toLowerCase()
  const ask = async (regenerate: boolean) => {
    const metric = `${location.hash.replace(/^#\/?/, '')}:${title}`.slice(0, 80), template = items.map(([h, p]) => `${h}. ${p}`).join('\n')
    const r = await fetch('/api/explain', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ metric, date: new Date().toISOString().slice(0, 10), template, regenerate }) }).then((x) => (x.ok ? x.json() : null)).catch(() => null)
    setAi(r?.text && r.source !== 'template' ? r.text : null); setLim(!!r?.limited)
  }
  const toggle = () => { setOpen(!open); if (!open && on && ai === null) ask(false) }
  return <section class="card" style={style}>
    <div class="k"><b>{title}</b><button type="button" class="xp" aria-expanded={open} aria-controls={id} onClick={toggle}>Explain this</button></div>
    {open && <div class="ex" id={id}>{ai ? <p>{ai}</p> : items.map(([h, p]) => <><h4>{h}</h4><p>{p}</p></>)}
      <div class="exf"><span>{lim ? 'Regenerate limit reached for today (5 per card).' : ai ? "Rewritten by the coach model from today's numbers." : "Written from today's numbers."}</span>{on && <button type="button" class="xp" onClick={() => ask(true)}>Regenerate</button>}</div></div>}
    {children}
  </section>
}
const Kv = ({ rows }: { rows: [string, string, string][] }) => <div class="kv">{rows.map(([v, u, l]) => <div><span class="num">{v}{u && <small>{u}</small>}</span><span class="lab">{l}</span></div>)}</div>
const Empty = () => <section class="card"><p class="k">Nothing here yet</p><p class="t0">No data has synced for this page. Run a sync from Settings and come back.</p><a class="btn" href="#/settings">Open Settings</a></section>
const Back = () => <a class="crumb" href="#/insights">← Insights</a>

/** Back link, title, one line of purpose, then the page. */
function Sub<T>({ title, sub, st, retry, children }: { title: string; sub: string; st: ReturnType<typeof useApi<T>>[0]; retry: () => void; children: (d: T) => ComponentChildren }) {
  return <><Back /><Page title={title} st={st} retry={retry}>{(d) => <><p class="sub">{sub}</p>{children(d)}</>}</Page></>
}

// ---- hub ----
const IX: [string, string, string][] = [['status', 'Training status', 'Why the label is what it is'], ['sleep', 'Sleep', 'Score, stages and consistency'], ['recovery', 'Recovery', 'What goes into readiness'], ['hrv', 'HRV', 'Against your normal range'],
  ['rhr', 'Resting heart rate', 'Last 30 days'], ['battery', 'Body battery', 'Peak and low each day'], ['load', 'Load and form', 'Fitness, fatigue and load ratio'], ['intensity', 'Intensity', 'Time in each heart rate zone'],
  ['forecast', 'Forecast', 'Where fitness goes at a given load'], ['dynamics', 'Running dynamics', 'Stride, contact time and cadence by week'], ['correlations', 'Correlations', 'What moves with what, and how sure we are']]

export function InsightsHub({ d, i }: { d: Today; i?: IntensityResp }) {
  const t = d.tiles, s = d.sleep, r = d.readiness, h = t?.hrv, easy = i?.share_28d?.all?.easy
  const w = (v: string, u: string, ok: boolean) => (ok ? v + u : DASH)
  const v: Record<string, string> = {
    status: d.status?.label ?? DASH, sleep: s?.total_s == null ? DASH : `${s.score != null ? s.score + ' · ' : ''}${dur(s.total_s)}`, recovery: r?.score == null || r.confidence === 'none' ? DASH : `${Math.round(r.score)} of 100`,
    hrv: w(num(h?.last ?? t?.hrv_last_night), ' ms', (h?.last ?? t?.hrv_last_night) != null), rhr: w(num(t?.rhr), ' bpm', t?.rhr != null), battery: num(t?.body_battery_max), load: `Form ${sgn(d.status?.tsb)}`,
    intensity: easy == null ? DASH : `${num(easy * 100)}% easy`, forecast: '21 days', dynamics: 'Weekly', correlations: 'Fixed checks' }
  const note = (k: string, n: string) => (k === 'hrv' && h?.range_ok ? `Normal range ${num(h.low)} to ${num(h.high)} ms` : n)
  return <>
    <p class="sub">Everything behind the numbers on Today.</p>
    <div class="g2">{IX.map(([k, l, n]) => <a class="card ixc" href={`#/insights/${k}`}><span class="lab">{l}</span><b class="bst">{v[k]}</b><span class="lab">{note(k, n)}</span></a>)}</div>
  </>
}

// ---- sub pages ----
function StatusInsight() {
  const [st, retry] = useApi<LoadResp>('/api/load?days=120'), [td] = useApi<Today>('/api/today'), hrv = td.s === 'ok' ? td.data.tiles?.hrv : null
  return <Sub title="Training status" sub="One label, computed from a few numbers with fixed rules." st={st} retry={retry}>{(d) => {
    if (!d.days.length) return <Empty />
    const last = d.days[d.days.length - 1], label = last.status ?? 'Not enough data', dates = d.days.map((x) => x.date)
    let n = 0; while (n < d.days.length && d.days[d.days.length - 1 - n].status === last.status) n++
    const since = d.days[d.days.length - n].date
    return <div class="g2">
      <div class="stk"><Explain title="Today" style={`--c:var(--s-${STATUS_KEY[last.status ?? ''] ?? 'recov'})`} items={[
        ['What it says', 'The label comes from fixed rules, not from a model. A few numbers go in and the first rule that fits wins.'],
        [`Why ${label}`, last.status ? statusReason({ label, acwr: last.acwr, ramp7: last.ramp7, tsb: last.tsb, warming_up: !!last.warming_up }) : 'There is not enough history yet.'],
        ['What would change it', 'Form far below zero moves you to Overreaching. Fitness slipping while load stays low moves you to Detraining. The rules are listed on this page.']]}>
        <StatusBody last={last}>{hrv?.last != null && <div><b>{num(hrv.last)}<small> ms</small></b><span>HRV{hrv.range_ok ? `, normal ${num(hrv.low)} to ${num(hrv.high)}` : ''}</span></div>}</StatusBody>
        {last.status && <p class="cap2">{label} since {day(since, { day: 'numeric', month: 'short' })}.</p>}
      </Explain>
        <section class="card"><h3 class="ch">Last 28 days</h3><StatusStrip days={d.days} /></section></div>
      <RulesCard status={last.status} />
        <section class="card wide"><h3 class="ch">Fitness and fatigue, {d.days.length} days</h3>
          <LineChart dates={dates} h={210} label="Fitness and fatigue" summary={summarize('Fitness', dates, d.days.map((x) => x.ctl), (v) => num(v, 1))}
            series={[{ name: 'Fitness', v: d.days.map((x) => x.ctl), c: 'var(--link)', w: 2.8 }, { name: 'Fatigue', v: d.days.map((x) => x.atl), c: 'var(--warn)' }]} /></section>
    </div>
  }}</Sub>
}

type SpreadNight = { start_ts?: number | null; end_ts?: number | null }
/** Standard deviation in minutes of the clock time of bedtime or wake-up. Bedtimes before noon count as past midnight so 23:30 and 00:30 sit one hour apart. */
function spread(ns: SpreadNight[], k: 'start_ts' | 'end_ts') {
  const m = ns.flatMap((x) => { const t = x[k]; if (t == null) return []; const d = new Date(t), v = d.getHours() * 60 + d.getMinutes(); return [k === 'start_ts' && v < 720 ? v + 1440 : v] })
  if (m.length < 5) return null
  const a = mean(m); return Math.sqrt(mean(m.map((v) => (v - a) ** 2)))
}
function SleepInsight() {
  const [st, retry] = useApi<RecoveryResp>('/api/recovery?days=90')
  return <Sub title="Sleep" sub="Last night and the nights before it." st={st} retry={retry}>{(d) => {
    const ns = (d.sleep_nights ?? []).slice(-14), l = ns[ns.length - 1], sl = d.days.findLast((x) => x.sleep)?.sleep
    if (!l || l.total_s == null) return <Empty />
    const have = STAGE.filter(([k]) => l[k] != null), a = avg(ns.map((x) => (x.total_s == null ? null : x.total_s / 3600))), dates = ns.map((x) => x.date), need = sl?.need_h
    const mins = (s: number | null) => (s == null ? DASH : `${num(s / 60)} min`), sp = (k: 'start_ts' | 'end_ts') => spread(ns as SpreadNight[], k), bs = sp('start_ts'), ws = sp('end_ts'), lt = l as typeof l & SpreadNight
    return <div class="g2">
      <div class="pg"><Explain title="Last night" items={[
        ['The score', "The score blends duration, deep sleep, REM and how often you woke. It is Garmin's number, shown as it comes."],
        ['This week', `You slept ${dur(l.total_s)}. Your average over the last ${ns.length} nights is ${a == null ? DASH : dur(a * 3600)}${need ? `, against the ${need} h you need` : ''}.`],
        ['What helps', 'A steady bedtime and wake time. The consistency card shows how much yours moves.']]}>
        <div class="bigrow"><span class="big">{l.score ?? dur(l.total_s)}</span><span class="bst">{l.score != null ? sleepLabel(l.score) : 'Asleep'}<small>{l.score != null ? 'score out of 100' : 'No score for this night'}</small></span></div>
        <p class="t0" style="margin:10px 0">{dur(l.total_s)} asleep{lt.start_ts != null && lt.end_ts != null ? `, from ${clock(lt.start_ts)} to ${clock(lt.end_ts)}` : ''}.{l.awake_s ? ` You were awake for ${num(l.awake_s / 60)} minutes.` : ''}</p>
        {have.length > 0 && <><div class="stages" role="img" aria-label="Sleep stages">{have.map(([k, , c]) => <i style={`flex:${l[k]};background:${c}`} />)}</div>
          <div class="legend">{have.map(([k, n, c]) => <span><i style={`background:${c}`} />{n} {dur(l[k])}</span>)}</div></>}
      </Explain>
        <section class="card"><h3 class="ch">Consistency, {ns.length} nights</h3>
          <Kv rows={[[bs == null ? DASH : '±' + num(bs), ' min', 'Bedtime spread'], [ws == null ? DASH : '±' + num(ws), ' min', 'Wake spread'], [a == null ? DASH : num(a, 1), ' h', 'Average sleep']]} />
          <p class="cap2">{sl?.social_jetlag_min != null ? `Weekends shift your sleep by about ${num(sl.social_jetlag_min)} min. ` : ''}{sl?.debt_h != null ? `Sleep debt is ${num(sl.debt_h, 1)} h over the last ${sl.n_debt} nights.` : 'Not enough nights to work out a sleep debt.'}</p></section></div>
      <div class="pg"><section class="card"><h3 class="ch">Hours per night, last bar is last night</h3>
        <StackedBars dates={dates} h={200} unit=" h" yfmt={(v) => num(v, 0)} band={[7, 9]} top={10} sel={ns.length - 1} legend={false} label="Hours of sleep per night" stacks={[{ name: 'Asleep', c: 'var(--link)' }]} vals={ns.map((x) => [x.total_s == null ? null : x.total_s / 3600])}
          summary={summarize('Sleep', dates, ns.map((x) => (x.total_s == null ? null : x.total_s / 3600)), (v) => num(v, 1), ' h')} />
        <p class="cap2">The green band is 7 to 9 hours.</p></section>
        <section class="card"><h3 class="ch">Last 7 nights</h3><div class="tw"><table class="tbl"><thead><tr><th scope="col">Night</th><th scope="col" class="r">Hours</th><th scope="col" class="r">Score</th><th scope="col" class="r">Deep</th><th scope="col" class="r">REM</th></tr></thead>
          <tbody>{ns.slice(-7).reverse().map((x) => <tr><td>{day(x.date, { weekday: 'short', day: 'numeric', month: 'short' })}</td><td class="r">{x.total_s == null ? DASH : num(x.total_s / 3600, 1)}</td><td class="r">{num(x.score)}</td><td class="r">{mins(x.deep_s)}</td><td class="r">{mins(x.rem_s)}</td></tr>)}</tbody></table></div></section></div>
    </div>
  }}</Sub>
}

type RdDay = RecDay & { readiness?: { score: number | null } | null }
function RecoveryInsight() {
  const [t, r1] = useApi<Today>('/api/today'), [st, retry] = useApi<RecoveryResp>('/api/recovery?days=90')
  const r = t.s === 'ok' ? t.data.readiness : null, scored = r?.score != null && r.confidence !== 'none'
  return <Sub title="Recovery" sub="Readiness blends several overnight signals into one number out of 100." st={st} retry={retry}>{(d) => {
    const rd = (d.days as RdDay[]).slice(-30), dates = rd.map((x) => x.date), v = rd.map((x) => x.readiness?.score), flat = (n: number) => rd.map(() => n)
    return <>
      <div class="g2 eq">
        <Explain title="Readiness" items={[
          ['What readiness is', 'A 0 to 100 estimate of how ready you are to train, built from HRV, sleep, resting heart rate, form and recent load.'],
          ['Today', r?.score == null ? 'There is not enough data to score today.' : `Your score is ${Math.round(r.score)}, which is ${r.label}.${r.drivers.length ? ` Mostly driven by ${r.drivers.map((k) => r.components.find((c) => c.key === k)?.label ?? k).join(' and ')}.` : ''}`],
          ['Not a verdict', 'It guides the day. It does not cancel a plan.']]}>
          {scored ? <><div class="bigrow"><span class="big">{Math.round(r!.score!)}</span><span class="bst">{readinessWord(r!.label)}<small>out of 100</small></span>{r!.capped && <Pill tone="warn">Held down</Pill>}</div>
            <p class="t0" style="margin:10px 0 0">{r!.label === 'high' ? 'Train as planned. Nothing here asks for a change.' : r!.label === 'moderate' ? 'Fine for the plan. Keep hard efforts measured.' : 'Take it easy today and let the signals recover.'}</p></>
            : t.s === 'error' ? <><p class="t0">{t.msg}</p><button class="btn g" onClick={r1}>Try again</button></> : <p class="t0" style="margin:0">Not enough data yet to score today.</p>}
        </Explain>
        <section class="card"><h3 class="ch">What went in</h3>
          {r?.components.map((c) => <div class={`rr ${c.available ? '' : 'off'}`}><span><b style="font:inherit;font-weight:600">{c.label}</b><small>{c.available ? `${c.value ?? DASH}, weight ${c.weight}%` : 'No data today'}</small></span>
            <b>{c.score == null ? DASH : Math.round(c.score)}</b><div class="bar"><i style={`width:${c.score ?? 0}%`} /></div></div>) ?? <p class="empty">No signals yet.</p>}
        </section>
      </div>
      <section class="card" style="margin-top:10px"><h3 class="ch">Readiness, last {rd.length} days</h3>
        <LineChart dates={dates} h={200} label="Readiness over time with the training band" include={[0, 100]} band={{ lo: flat(60), hi: flat(100) }} yfmt={(n) => num(n)} dots={rd.length < 20} summary={summarize('Readiness', dates, v, (n) => num(n))}
          series={[{ name: 'Readiness', v, c: 'var(--link)' }]} />
        <span class="lab">The green band is 60 and above, where training as planned is fine.</span></section>
      <div style="margin-top:10px"><RecoveryView d={d} /></div>
    </>
  }}</Sub>
}

function HrvInsight() {
  const [st, retry] = useApi<RecoveryResp>('/api/recovery?days=90')
  return <Sub title="HRV" sub="Overnight average of the variation between heartbeats." st={st} retry={retry}>{(d) => {
    const ds = d.days.slice(-30), h = d.days[d.days.length - 1]?.hrv, v28 = d.days.slice(-28).map((x) => x.hrv?.last), dates = ds.map((x) => x.date), ok = (x: (typeof ds)[number]) => !!x.hrv?.range_ok
    const [lab, tn] = h?.status === 'below' ? ['Below your normal', 'warn'] : h?.status === 'above' ? ['Above your range', 'ok'] : h?.status === 'in_range' ? ['In your range', 'ok'] : ['', 'mute']
    if (h?.last == null && !nums(v28).length) return <Empty />
    return <div class="g2 eq">
      <Explain title="Today" items={[
        ['What HRV is', 'The small timing changes between heartbeats while you sleep. Higher usually means you are well recovered.'],
        ['Where you are', h?.last == null ? 'There is no reading for last night.' : h.range_ok ? `${num(h.last)} ms against a normal range of ${num(h.low)} to ${num(h.high)} ms.` : `${num(h.last)} ms. Your normal range is still being built from ${h.n_base} nights.`],
        ['Be careful', `One night proves little. Look at the 7-day average, which is ${num(h?.h7)} ms.`]]}>
        <div class="bigrow"><span class="big">{num(h?.last)}<small>ms</small></span>{lab && <Pill tone={tn}>{lab}</Pill>}</div>
        <p class="t0" style="margin:10px 0">{h?.range_ok ? `Your normal range is ${num(h.low)} to ${num(h.high)} ms. ` : ''}Seven-day average {num(h?.h7)} ms.</p>
        <Kv rows={[[num(avg(v28)), ' ms', '28-day average'], [num(hi(v28)), ' ms', '28-day high'], [num(lo(v28)), ' ms', '28-day low']]} />
      </Explain>
      <section class="card"><h3 class="ch">Last {ds.length} days</h3>
        <LineChart dates={dates} h={210} unit=" ms" label="Overnight HRV with your normal range" band={{ lo: ds.map((x) => (ok(x) ? x.hrv!.low : null)), hi: ds.map((x) => (ok(x) ? x.hrv!.high : null)) }} summary={summarize('Overnight HRV', dates, ds.map((x) => x.hrv?.last), (n) => num(n), ' ms')}
          series={[{ name: '7-day average', v: ds.map((x) => x.hrv?.h7), c: 'var(--link)', w: 2.8 }]} />
        <span class="lab">The band is your normal range.</span></section>
    </div>
  }}</Sub>
}

function RhrInsight() {
  const [st, retry] = useApi<RecoveryResp>('/api/recovery?days=90')
  return <Sub title="Resting heart rate" sub="Your lowest steady heart rate of the day." st={st} retry={retry}>{(d) => {
    const rs = (d.rhr ?? []).slice(-30), t = rs[rs.length - 1], v = rs.map((x) => x.rhr), b = avg(v), z = d.days[d.days.length - 1]?.recovery?.z_rhr, dates = rs.map((x) => x.date)
    if (!t || b == null) return <Empty />
    const [lab, tn] = z == null ? ['', 'mute'] : z >= 1 ? ['Above usual', 'warn'] : z <= -1 ? ['Below usual', 'ok'] : ['Usual', 'ok'], diff = t.rhr - b
    return <div class="g2 eq">
      <Explain title="Today" items={[
        ['What it is', 'Your lowest steady heart rate. It drifts up with illness, alcohol, heat and heavy load.'],
        ['Today', `${num(t.rhr)} bpm against a ${rs.length}-day average of ${num(b, 1)} bpm, ${Math.abs(diff) < 0.05 ? 'the same' : `${num(Math.abs(diff), 1)} ${diff > 0 ? 'above' : 'below'}`}.`],
        ['Rule of thumb', 'Five or more beats above your average for two days in a row is worth an easier day.']]}>
        <div class="bigrow"><span class="big">{num(t.rhr)}<small>bpm</small></span>{lab && <Pill tone={tn}>{lab}</Pill>}</div>
        <p class="t0" style="margin:10px 0">Your {rs.length}-day average is {num(b, 1)} bpm.</p>
        <Kv rows={[[num(lo(v)), ' bpm', `${rs.length}-day low`], [num(hi(v)), ' bpm', `${rs.length}-day high`]]} />
      </Explain>
      <section class="card"><h3 class="ch">Last {rs.length} days</h3>
        <LineChart dates={dates} h={210} unit=" bpm" label="Resting heart rate with its average band" band={{ lo: v.map(() => b - 1.5), hi: v.map(() => b + 1.5) }} summary={summarize('Resting heart rate', dates, v, (n) => num(n), ' bpm')} yfmt={(n) => num(n)}
          series={[{ name: 'Resting heart rate', v, c: 'var(--link)', w: 2.4 }]} />
        <span class="lab">The band is your {rs.length}-day average plus or minus 1.5 bpm.</span></section>
    </div>
  }}</Sub>
}

function BatteryInsight() {
  const [st, retry] = useApi<RecoveryResp>('/api/recovery?days=90')
  return <Sub title="Body battery" sub="Garmin's energy estimate, from 0 to 100." st={st} retry={retry}>{(d) => {
    const bb = (d.body_battery ?? []).slice(-30), t = bb[bb.length - 1], dates = bb.map((x) => x.date), p14 = bb.slice(-14)
    if (!t || t.max_level == null) return <Empty />
    return <div class="g2 eq">
      <Explain title="Today" items={[
        ['How it works', 'Garmin combines heart rate, HRV, stress and activity. Sleep charges it and effort drains it.'],
        ['Today', `${t.charged != null ? `You charged ${num(t.charged)} points overnight and ` : 'You '}reached ${num(t.max_level)}${t.min_level != null ? `, with a low of ${num(t.min_level)}` : ''}.`],
        ['Limit', 'It is an estimate. Use it as a hint and trust how you feel first.']]}>
        <div class="bigrow"><span class="big">{num(t.max_level)}</span>{t.charged != null && <Pill tone="ok">Charged {num(t.charged)}</Pill>}</div>
        <p class="t0" style="margin:10px 0">Highest level of the day{t.min_level != null ? `, lowest ${num(t.min_level)}` : ''}.</p>
        <Kv rows={[[num(avg(p14.map((x) => x.max_level))), '', `${p14.length}-day average peak`], [num(avg(p14.map((x) => x.min_level))), '', `${p14.length}-day average low`]]} />
      </Explain>
      <section class="card"><h3 class="ch">Peak and low, last {bb.length} days</h3>
        <LineChart dates={dates} h={210} label="Body battery peak and low" include={[0, 100]} yfmt={(n) => num(n)} summary={summarize('Daily peak', dates, bb.map((x) => x.max_level), (n) => num(n))}
          series={[{ name: 'Peak', v: bb.map((x) => x.max_level), c: 'var(--link)', w: 2.4 }, { name: 'Low', v: bb.map((x) => x.min_level), c: 'var(--warn)', w: 2 }]} /></section>
    </div>
  }}</Sub>
}

function ForecastInsight() {
  const [daily, setDaily] = useState<number | null>(null), [st, retry] = useApi<LoadResp>('/api/load?days=60')
  return <Sub title="Forecast" sub="Where fitness, fatigue and form go if you train at one steady load." st={st} retry={retry}>{(d) => {
    const p = d.projection
    if (!p) return <Empty />
    const typ = Math.round(mean(p.typical_week)), load = daily ?? typ
    return <ForecastView p={p} load={load} typ={typ} setDaily={setDaily} hist={d.days} head={<Explain title="How it works" items={[
      ['What this does', "It repeats one daily load for 21 days and applies the same averaging that produced today's numbers."],
      ['What it leaves out', 'Sickness, travel and a missed week. Real plans are uneven, so treat the lines as direction.'],
      ['Try this', `Pick Rest to see how fast fatigue falls and how slowly fitness does. Your typical day is ${num(typ)}.`]]}>
      <p class="t0" style="margin:0">Today: fitness {num(p.ctl)}, fatigue {num(p.atl)}, form {sgn(p.ctl - p.atl)}.</p></Explain>} />
  }}</Sub>
}

function CorrInsight() {
  const [st, retry] = useApi<CorrResp>('/api/correlations')
  return <Sub title="Correlations" sub="What moves with what, and how much the data can support." st={st} retry={retry}>{(d) => <>
    <Explain title="How to read this" style="margin-bottom:10px" items={[
      ['What a correlation is', 'Two numbers that move together. It does not say one causes the other.'],
      ['Sample size', `Each check shows how many paired days it uses. Under ${d.min_n ?? 30} the page shows the count and draws no conclusion.`],
      ['The interval', 'r runs from −1 to +1. The bar is a 95% interval. If it crosses zero, the data cannot tell a link from chance.']]}>
      <p class="t0" style="margin:0">A fixed list of checks over the last 180 days. Nothing is searched for, so a result is not cherry-picked.</p></Explain>
    <CorrView d={d} />
  </>}</Sub>
}

const SUB: Record<string, () => preact.JSX.Element> = {
  status: StatusInsight, sleep: SleepInsight, recovery: RecoveryInsight, hrv: HrvInsight, rhr: RhrInsight, battery: BatteryInsight, forecast: ForecastInsight, correlations: CorrInsight,
  load: () => <><Back /><LoadPage /></>, intensity: () => <><Back /><IntensityPage /></>, dynamics: () => <><Back /><DynamicsPage /></>,
}
export function InsightsPage({ sub }: { sub?: string }) {
  const [t, retry] = useApi<Today>('/api/today'), [i] = useApi<IntensityResp>('/api/intensity?weeks=8'), P = sub ? SUB[sub] : undefined
  if (P) return <P />
  if (sub) return <><Back /><h1>Not found</h1><p class="sub">That insight does not exist.</p></>
  return <Page title="Insights" st={t} retry={retry}>{(d) => <InsightsHub d={d} i={i.s === 'ok' ? i.data : undefined} />}</Page>
}
