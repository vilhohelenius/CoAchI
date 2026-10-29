import { useApi } from './api'
import { StackedBars } from './chart'
import { day, num, pct } from './fmt'
import { Page } from './today'
import type { StepsResp } from './types'

export function StepsView({ d }: { d: StepsResp }) {
  const g = d.goal, s = d.summary, days = d.days
  if (!g || !days.some((x) => x.steps != null)) return <section class="card"><p class="k">No steps yet</p><p class="t0">Daily steps appear here once a sync has run.</p><a class="btn" href="#/settings">Open Settings</a></section>
  const last = days[days.length - 1], today = last.date === d.as_of.slice(0, 10), hit = days.filter((x) => x.steps != null && x.steps >= g).length
  return <>
    <p class="sub">Goal is {num(g)} a day. Change it in <a href="#/goals">Goals</a>.</p>
    <div class="g2"><div class="stk">
      <section class="card"><p class="k">{today ? 'Today so far' : 'Latest day'}<span>{day(last.date, { weekday: 'short', day: 'numeric', month: 'short' })}</span></p>
        <div class="bigrow"><span class="big">{num(last.steps)}</span>{last.steps != null && <span class="bst">{Math.round((last.steps / g) * 100)}%<small>of {num(g)}</small></span>}</div>
        <div class="bar"><i style={`width:${pct(last.steps ?? 0, 0, g)}%`} /></div>
        {today && last.steps != null && <p class="t0" style="margin:0">{last.steps >= g ? 'Goal reached.' : `${num(g - last.steps)} left.`}</p>}</section>
      {s && <section class="card"><p class="k">Streak<span>calendar days at goal</span></p>
        <div class="big">{s.streak_days}<small> days</small></div>
        <p class="cap2">{s.today_pending ? 'Today does not break it until midnight.' : 'Today is at goal as well.'}</p></section>}
      <section class="card"><div class="kv">
        {s && <><div><span class="num">{num(s.avg_7d)}</span><span class="lab">7-day average</span></div><div><span class="num">{num(s.avg_30d)}</span><span class="lab">30-day average</span></div></>}
        <div><span class="num">{hit}<small> of {days.length}</small></span><span class="lab">Days at goal</span></div></div></section>
    </div>
    <section class="card"><p class="k">Last {days.length} days<span>dashed is the goal</span></p>
      <StackedBars dates={days.map((x) => x.date)} h={240} goal={g} legend={false} label="Steps per day against the goal" unit=" steps"
        summary={`Steps per day for ${days.length} days, ${hit} at or above the goal of ${num(g)}.`}
        stacks={[{ name: 'Below goal', c: 'var(--link)' }, { name: 'At goal', c: 'var(--ok)' }]}
        vals={days.map((x) => (x.steps == null ? [null, null] : x.steps >= g ? [0, x.steps] : [x.steps, 0]))}
        tip={(i) => [day(days[i].date, { weekday: 'short', day: 'numeric', month: 'short' }), `${num(days[i].steps)} steps`]} />
      <p class="cap2">Bars under the goal are not failures, they are often rest days.</p></section></div>
  </>
}

export function StepsPage() {
  const [st, retry] = useApi<StepsResp>('/api/steps?days=28')
  return <Page title="Steps" st={st} retry={retry}>{(d) => <StepsView d={d} />}</Page>
}
