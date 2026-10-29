import { useApi } from './api'
import { LineChart, StackedBars, summarize } from './chart'
import { DASH, day, num } from './fmt'
import { Page, Pill } from './today'
import { mean } from '../../src/metrics/dates'
import type { RecoveryResp } from './types'

const NOTE: Record<string, string> = {
  strain: 'Resting heart rate is up and HRV is down. Your body is under strain, so keep today easy.',
  hrv_dip: 'HRV dipped while resting heart rate held. Watch the next few days.',
  rhr_rise: 'Resting heart rate rose while HRV held steady. This often follows a hard day or a poor night.',
  recovered: 'HRV is up and resting heart rate is down. You look well recovered.',
  hrv_high: 'HRV is high while resting heart rate is normal.',
  normal: 'HRV and resting heart rate agree, nothing unusual.',
}
const avg = (xs: (number | null | undefined)[]) => { const v = xs.filter((x): x is number => typeof x === 'number'); return { m: v.length ? mean(v) : null, n: v.length } }
const STAGE = [['deep_s', 'Deep', 'var(--b5)'], ['rem_s', 'REM', 'var(--s-peak)'], ['light_s', 'Light', 'var(--b3)'], ['awake_s', 'Awake', 'var(--b2)']] as const

export function RecoveryView({ d }: { d: RecoveryResp }) {
  if (!d.days.length) return <section class="card"><p class="k">Nothing here yet</p><p class="t0">No recovery data has synced. Run a sync from Settings and come back.</p><a class="btn" href="#/settings">Open Settings</a></section>
  const last = d.days[d.days.length - 1], h = last.hrv, rc = last.recovery, sl = d.days.findLast((x) => x.sleep)?.sleep
  const dates = d.days.map((x) => x.date), ok = (x: (typeof d.days)[number]) => !!x.hrv?.range_ok
  const hrv30 = avg(d.days.slice(-30).map((x) => x.hrv?.last)), rhr30 = avg((d.rhr ?? []).slice(-30).map((x) => x.rhr))
  const hl = h?.status === 'below' ? ['Below your normal', 'warn'] : h?.status === 'above' ? ['Above your range', 'ok'] : h?.status === 'in_range' ? ['In your range', 'ok'] : ['', 'mute']
  const z = rc?.z_rhr, rl = z == null ? ['', 'mute'] : z >= 1 ? ['Above usual', 'warn'] : z <= -1 ? ['Below usual', 'ok'] : ['Usual', 'ok']
  const nights = (d.sleep_nights ?? []).slice(-30), nd = nights.map((x) => x.date)
  const bb = (d.body_battery ?? []).slice(-30).filter((x) => x.min_level != null && x.max_level != null), bd = bb.map((x) => x.date)
  const hasStages = (x: (typeof nights)[number]) => STAGE.every(([k]) => x[k] != null)
  const comp = d.sleep_composition
  return <>
    <p class="sub">Your body's own signals. HRV is read overnight and resting heart rate over the day.</p>
    <section class="card">
      <h3 class="ch">HRV against your normal</h3>
      <LineChart dates={dates} h={220} unit=" ms" label="Overnight HRV with your normal range" band={{ lo: d.days.map((x) => (ok(x) ? x.hrv!.low : null)), hi: d.days.map((x) => (ok(x) ? x.hrv!.high : null)) }}
        summary={summarize('Overnight HRV', dates, d.days.map((x) => x.hrv?.last), (n) => num(n), ' ms') + (h?.range_ok ? ` Your normal range is ${num(h.low)} to ${num(h.high)} ms.` : ' Your normal range is still being built.')}
        series={[{ name: 'Last night', v: d.days.map((x) => x.hrv?.last), c: 'var(--mute)', w: 1.4 }, { name: '7-day average', v: d.days.map((x) => x.hrv?.h7), c: 'var(--link)', w: 2.8 }]} />
      <span class="lab">The green band is your 60-day average plus or minus one standard deviation{h ? `, from ${h.n_base} nights` : ''}. It appears once there are enough nights.</span>
    </section>

    <h2 class="sh">HRV and resting heart rate</h2>
    <div class="g2">
      <section class="card"><p class="k">Last 7 days{rc?.balance?.balanced != null && <Pill tone={rc.balance.balanced ? 'ok' : 'warn'}>{rc.balance.balanced ? 'In balance' : 'Out of balance'}</Pill>}</p>
        <div class="kv">
          <div><span class="num">{num(h?.h7)}<small> ms</small></span><span class="lab">HRV average{h?.status ? `, ${hl[0].toLowerCase()}` : ''}, {h?.n7 ?? 0} nights</span></div>
          <div><span class="num">{num(rc?.rhr7, 1)}<small> bpm</small></span><span class="lab">Resting heart rate{rl[0] ? `, ${rl[0].toLowerCase()}` : ''}</span></div>
          <div><span class="num">{rc?.streak_days ? num(rc.streak_days) : '0'}<small> days</small></span><span class="lab">In balance in a row</span></div>
        </div>
        <p class="cap2">{rc?.divergence ? NOTE[rc.divergence] ?? '' : 'Not enough readings to compare the two yet.'}</p>
      </section>
      <section class="card"><p class="k">Last 30 days</p>
        <div class="kv">
          <div><span class="num">{num(hrv30.m)}<small> ms</small></span><span class="lab">HRV average, {hrv30.n} nights</span></div>
          <div><span class="num">{num(rhr30.m, 1)}<small> bpm</small></span><span class="lab">Resting heart rate average, {rhr30.n} days</span></div>
        </div>
        <p class="cap2">{hrv30.n < 10 ? 'Fewer than 10 readings, so treat these averages as rough.' : 'Compare these with the 7-day figures to see which way you are drifting.'}</p>
      </section>
    </div>

    <h2 class="sh">Sleep</h2>
    <div class="g2">
      <section class="card wide"><h3 class="ch">Last {nights.length} nights, hours asleep by stage</h3>
        <StackedBars dates={nd} h={210} unit=" h" yfmt={(v) => num(v, 0)} label="Hours of sleep per night by stage"
          summary={summarize('Sleep', nd, nights.map((x) => (x.total_s == null ? null : x.total_s / 3600)), (n) => num(n, 1), ' h')}
          stacks={[...STAGE.map(([, l, c]) => ({ name: l, c })), { name: 'Total, no stage detail', c: 'var(--band)' }]}
          vals={nights.map((x) => (hasStages(x) ? [...STAGE.map(([k]) => (x[k] as number) / 3600), 0] : [0, 0, 0, 0, (x.total_s ?? 0) / 3600]))} />
        {comp && comp.n > 0 ? <p class="cap2">Average night over {comp.n} nights with stages: deep {num(comp.share.deep * 100)}%, REM {num(comp.share.rem * 100)}%, light {num(comp.share.light * 100)}%, awake {num(comp.share.awake * 100)}%.</p> : <p class="cap2">No stage breakdown is available for these nights.</p>}
      </section>
      <section class="card"><p class="k">Consistency</p>
        <div class="big">{sl?.sd_min != null ? `±${num(sl.sd_min)}` : DASH}<small> min</small></div>
        <p class="cap2">{sl?.sd_min != null ? `Your sleep timing varies by about this much, from ${sl.n_nights7} nights this week.` : 'Not enough nights to measure consistency.'}{sl?.social_jetlag_min != null ? ` Weekends shift your sleep by ${num(sl.social_jetlag_min)} min.` : ''}</p>
      </section>
      <section class="card"><p class="k">Sleep debt</p>
        <div class="big">{num(sl?.debt_h, 1)}<small> h</small></div>
        <p class="cap2">{sl?.debt_h != null ? `Hours missed against the ${sl.need_h} h you need, over the last ${sl.n_debt} nights.` : 'Not enough nights to work out a debt.'}</p>
      </section>
    </div>

    <h2 class="sh">Body battery</h2>
    <section class="card"><h3 class="ch">Daily low to high, last {bb.length} days</h3>
      <StackedBars dates={bd} h={190} label="Body battery daily range" yfmt={(v) => num(v)} top={100} legend={false}
        summary={summarize('Daily high', bd, bb.map((x) => x.max_level), (n) => num(n))}
        tip={(i) => [day(bd[i], { weekday: 'short', day: 'numeric', month: 'short' }), `Low ${num(bb[i].min_level)}`, `High ${num(bb[i].max_level)}`]}
        stacks={[{ name: 'Low', c: 'none', hide: true }, { name: 'Range', c: 'var(--b5)' }]} vals={bb.map((x) => [x.min_level, (x.max_level as number) - (x.min_level as number)])} />
      <span class="lab">Each bar runs from the lowest to the highest level of the day.</span>
    </section>
  </>
}

export function RecoveryPage() {
  const [st, retry] = useApi<RecoveryResp>('/api/recovery?days=90')
  return <Page title="Recovery" st={st} retry={retry}>{(d) => <RecoveryView d={d} />}</Page>
}
