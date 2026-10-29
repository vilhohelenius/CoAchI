import { useState } from 'preact/hooks'
import { useApi } from './api'
import { fitter } from './activities'
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
  </>
}

export function HeatmapPage() {
  const [st, retry] = useApi<RoutesResp>('/api/routes')
  return <Page title="Heatmap" st={st} retry={retry}>{(d) => <HeatmapView d={d} />}</Page>
}
