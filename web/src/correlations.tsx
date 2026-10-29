import { num, sgn } from './fmt'
import { Pill } from './today'

export type CorrPair = { x: string; y: string; lag: number; label: string; n: number; status: string; need?: number; n_eff?: number; r?: number; ci?: [number, number] }
export type CorrResp = { as_of: string; pairs?: CorrPair[]; min_n?: number; window?: { from: string; to: string } }

const WORD: Record<string, string> = { no_clear_link: 'No clear link', weak: 'Weak link', moderate: 'Moderate link', strong_double_check: 'Strong, double check' }
/** What the numbers support, in plain words. Never more than the status allows. */
function say(p: CorrPair) {
  const r = p.r as number, both = p.ci![0] > 0 || p.ci![1] < 0, dir = r > 0 ? 'tend to rise and fall together' : 'tend to move in opposite directions'
  if (p.status === 'no_clear_link') return `r = ${sgn(r, 2)}. ${both ? 'The link is too weak to matter' : 'The interval includes zero'}, so these data show no clear link between the two.`
  return `r = ${sgn(r, 2)}. The two ${dir}${p.status === 'strong_double_check' ? '. A value this high is unusual for body data, so check the series for gaps before trusting it' : ''}. It is an association and does not show that one causes the other.`
}
/** A -1 to +1 axis with the 95% interval as a bar and r as a mark. */
const Ci = ({ p }: { p: CorrPair }) => {
  const at = (v: number) => (v + 1) * 50
  return <div class="ci" role="img" aria-label={`r ${num(p.r, 2)}, 95 percent interval ${num(p.ci![0], 2)} to ${num(p.ci![1], 2)}`}>
    <i class="rng" style={`left:${at(p.ci![0])}%;width:${at(p.ci![1]) - at(p.ci![0])}%`} /><i class="zero" /><i class="mk" style={`left:${at(p.r as number)}%`} />
    <span class="a0">−1</span><span class="a1">0</span><span class="a2">+1</span></div>
}

export function CorrView({ d }: { d: CorrResp }) {
  const ps = d.pairs ?? [], min = d.min_n ?? 30
  if (!ps.length) return <section class="card"><p class="k">Nothing here yet</p><p class="t0">The correlation report is not available yet. Run a sync from Settings and come back.</p><a class="btn" href="#/settings">Open Settings</a></section>
  const ok = ps.filter((p) => p.r != null).length
  return <>
    <div class="g2 eq">{ps.map((p) => <section class="card">
      <p class="k"><b>{p.label}</b>{p.r != null ? <Pill tone={p.status === 'no_clear_link' ? 'mute' : 'ok'}>{WORD[p.status] ?? p.status}</Pill> : <Pill tone="warn">n = {p.n}, too few</Pill>}</p>
      {p.r != null ? <>
        <div class="bigrow"><span class="big">{sgn(p.r, 2)}<small>r</small></span></div>
        <Ci p={p} />
        <p class="t0" style="margin:22px 0 4px">{say(p)}</p>
        <span class="lab">n = {p.n} paired days{p.n_eff != null && `, about ${num(p.n_eff)} independent`}. 95% interval {sgn(p.ci![0], 2)} to {sgn(p.ci![1], 2)}.</span></>
        : <p class="t0">{p.n} paired {p.n === 1 ? 'day' : 'days'} so far and {p.need ?? min} are needed. Until then no r or line is shown, because a small sample can look convincing and mean nothing. Check again as more days sync.</p>}
    </section>)}</div>
    <p class="cap2">{ok ? `${ok} of ${ps.length} checks have enough days.` : `None of the ${ps.length} checks has ${min} paired days yet.`} Association, not proof of cause. The checks are fixed and not adjusted for trends, and an interval that includes 0 means no clear link.</p>
  </>
}
