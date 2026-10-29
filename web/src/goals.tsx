import { useApi } from './api'
import { LineChart } from './chart'
import { day, num, paceWord, pct } from './fmt'
import { Page, Pill } from './today'
import { addDays, diffDays } from '../../src/metrics/dates'
import type { Goals } from './types'

const BAND: Record<string, string> = { below_band: 'below the band', in_band: 'in the band', above_band: 'above the band' }
const tone = (s: string) => (s === 'behind' || s === 'below_band' ? 'warn' : s === 'ahead' || s === 'on_pace' || s === 'in_band' ? 'ok' : 'mute')

export function GoalsView({ g }: { g: Goals }) {
  const p = g.progress, y = p?.year, w = p?.week, s = p?.steps
  if (!y && !w && !s) return <section class="card"><p class="k">No goals yet</p><p class="t0">Goals appear here once they are set and a sync has run.</p><a class="btn" href="#/settings">Open Settings</a></section>
  const yr = (g.data_date ?? '').slice(0, 4), n = yr ? diffDays(`${yr}-01-01`, `${+yr + 1}-01-01`) : 0, t = g.data_date && yr ? diffDays(`${yr}-01-01`, g.data_date) : -1
  const dates = Array.from({ length: n }, (_, i) => addDays(`${yr}-01-01`, i))
  const weeks = w ? [...(w.previous ?? []).slice(0, 4).reverse().map((x) => ({ ...x, word: BAND[x.status] ?? x.status })), { week_start: w.week_start ?? '', km: w.km, status: w.status, word: paceWord(w.status) ?? 'just started' }] : []
  const wmax = w ? Math.max(w.band_hi * 1.25, ...weeks.map((x) => x.km)) : 1
  return <>
    <p class="sub">Soft goals, measured against pace. Falling behind just means the plan needs a nudge.</p>
    {y && <section class="card"><p class="k">Yearly distance, running{paceWord(y.status) && <Pill tone={tone(y.status)}>{paceWord(y.status)}</Pill>}</p>
      <div class="big">{num(y.ytd_km)}<small> km of {num(y.target_km)}</small></div>
      <p class="cap2" style="margin-bottom:10px">Pace for today is {num(y.expected_km)} km, so you are {num(Math.abs(y.diff_km))} km {y.diff_km < 0 ? 'under' : 'over'}.{y.projected_km != null ? ` At your 8-week average of ${num(y.avg_week_km_8w)} km a week you finish near ${num(y.projected_km)} km.` : ' There is not enough recent running to project a finish.'}</p>
      {n > 0 && t >= 0 && <LineChart dates={dates} h={210} unit=" km" label="Yearly distance against pace" include={[0, y.target_km]}
        summary={`Yearly distance: ${num(y.ytd_km)} km so far against a pace of ${num(y.expected_km)} km${y.projected_km != null ? `, projected to finish near ${num(y.projected_km)} km` : ''}. Target ${num(y.target_km)} km.`}
        series={[{ name: 'Pace line', v: dates.map((_, i) => (y.target_km * (i + 1)) / n), c: 'var(--mute)', dash: '4 5', w: 1.6 },
          ...(y.projected_km != null ? [{ name: 'Projection', v: dates.map((_, i) => (i < t ? null : y.ytd_km + ((y.projected_km! - y.ytd_km) * (i - t)) / Math.max(1, n - 1 - t))), c: 'var(--s-maint)', dash: '2 5', w: 2 }] : []),
          { name: 'Distance so far', v: dates.map((_, i) => (i === t ? y.ytd_km : null)), c: 'var(--link)', w: 7 }]} />}
    </section>}

    {w && <><h2 class="sh">Weekly running</h2>
      <section class="card"><p class="k">Aiming for {num(w.band_lo)} to {num(w.band_hi)} km a week<span>This week {paceWord(w.status) ?? 'has just started'}</span></p>
        <div class="rows" style="display:block">{weeks.map((x, i) => <div class="rowb" style="grid-template-columns:5em 1fr 11em">
          <span>{i === weeks.length - 1 ? 'This week' : day(x.week_start, { day: 'numeric', month: 'short' })}</span>
          <div class="bar" style="margin:0"><span class="band" style={`left:${pct(w.band_lo, 0, wmax)}%;width:${pct(w.band_hi, 0, wmax) - pct(w.band_lo, 0, wmax)}%`} /><i style={`width:${pct(x.km, 0, wmax)}%`} /></div>
          <span><b>{num(x.km, 1)}</b> <small class="lab" style="display:inline">km, {x.word}</small></span></div>)}</div>
        {weeks.length < 2 && <p class="cap2">Earlier weeks will show here as they finish.</p>}
      </section></>}

    {s && <><h2 class="sh">Steps</h2>
      <section class="card"><p class="k">Daily goal {num(s.goal)}{paceWord(s.status) && <Pill tone={tone(s.status)}>{paceWord(s.status)}</Pill>}</p>
        <div class="kv">
          <div><span class="num">{s.streak_days}<small> days</small></span><span class="lab">In a row at goal{s.today_pending ? ', today still counts' : ''}</span></div>
          <div><span class="num">{num(s.avg_7d)}</span><span class="lab">7-day average</span></div>
          <div><span class="num">{num(s.avg_30d)}</span><span class="lab">30-day average</span></div>
          <div><span class="num">{s.hit_30d}<small> of 30</small></span><span class="lab">Days at goal</span></div>
        </div>
        <div class="bar"><i style={`width:${pct(s.today ?? 0, 0, s.goal)}%`} /></div>
        <p class="cap2">{s.today == null ? 'No steps recorded yet today.' : `${num(s.today)} steps so far today.`}</p>
      </section></>}
  </>
}

export function GoalsPage() {
  const [st, retry] = useApi<Goals>('/api/goals')
  return <Page title="Goals" st={st} retry={retry}>{(d) => <GoalsView g={d} />}</Page>
}
