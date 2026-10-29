import { useState } from 'preact/hooks'
import { useApi } from './api'
import { fitter, routePath } from './activities'
import { day, dur, km, num } from './fmt'
import { groupRoutes } from '../../src/metrics/routes'
import { Page } from './today'
import type { RouteRun, RoutesResp } from './types'

export const pairs = (r: RouteRun) => Array.from({ length: r[5].length >> 1 }, (_, i): [number, number] => [r[5][2 * i], r[5][2 * i + 1]])
const W = 800, H = 500

/** Every run as a faint line on one SVG, fitted to the busiest 98% of the points. No basemap, so nothing leaves the browser. */
export function HeatmapView({ d }: { d: RoutesResp }) {
  const [year, setYear] = useState('all')
  if (!d.runs.length) return <section class="card"><p class="k">No routes yet</p><p class="t0">Routes appear after runs with GPS have synced and the routes file was built.</p></section>
  const years = [...new Set(d.runs.map((r) => r[1].slice(0, 4)))].sort().reverse(), runs = d.runs.filter((r) => year === 'all' || r[1].startsWith(year))
  const all = runs.flatMap(pairs), f = all.length ? fitter(all, W, H, 20, 0.01) : null
  return <>
    <p class="sub">Where you run, drawn from every run with GPS. Brighter lines are the routes you repeat.</p>
    <div class="tools"><div class="seg" role="group" aria-label="Year">{['all', ...years].map((y) => <button type="button" aria-pressed={year === y} onClick={() => setYear(y)}>{y === 'all' ? 'All years' : y}</button>)}</div></div>
    <section class="card act"><p class="k"><span>Heatmap</span><span>{runs.length} {runs.length === 1 ? 'run' : 'runs'}</span></p>
      <svg class="map" style="height:auto" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Heatmap of ${runs.length} runs. Brighter lines are routes you run more often.`}><rect width={W} height={H} fill="var(--m-bg)" />
        {f && runs.map((r) => <path d={'M' + pairs(r).map((p) => f(p).map((x) => x.toFixed(1)).join(' ')).join('L')} fill="none" stroke="var(--link)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" opacity=".16" />)}</svg>
      <p class="mu">The map has no background on purpose: loading map tiles would tell a third party where you run.</p></section>
    <RouteList runs={d.runs} />
  </>
}

/** Repeated routes: same start and about the same distance (docs/metrics.md, Routes). Links to the latest run. */
function RouteList({ runs }: { runs: RouteRun[] }) {
  const gs = groupRoutes(runs).slice(0, 12)
  return <section class="card"><h2 class="ch2">Your routes</h2>
    {gs.length ? <div class="alist" style="padding:0">{gs.map((g) => { const t = routePath(pairs(g.last), 56, 56, 5); return <a class="arow" href={`#/activities/${g.last[0]}`}>
      <svg class="th" viewBox="0 0 56 56" role="img" aria-label="Shape of the latest run on this route"><rect width="56" height="56" rx="8" fill="var(--m-bg)" />{t && <path d={t.d} fill="none" stroke="var(--link)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />}</svg>
      <span class="at"><b>About {km(g.med_m)} km</b><small>Best {dur(g.best[3])} · last {dur(g.last[3])}, {day(g.last[1], { day: 'numeric', month: 'short', year: 'numeric' })}</small></span>
      <span class="av"><b>{num(g.n)}<small> runs</small></b></span></a> })}</div>
      : <p class="empty">Routes you run at least twice show up here, grouped by start point and distance.</p>}
    <p class="cap2">Runs count as one route when they start within 150 m of each other and are within 5% of the same distance.</p></section>
}

export function HeatmapPage() {
  const [st, retry] = useApi<RoutesResp>('/api/routes')
  return <Page title="Heatmap" st={st} retry={retry}>{(d) => <HeatmapView d={d} />}</Page>
}
