import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { Store } from './store.js'
import { route } from '../src/metrics/activity.js'
import { log } from './log.js'

const PTS = 80 // points per run in routes/all.json
const r4 = (x: number) => Math.round(x * 1e4) / 1e4

/** One file for the heatmap and route list: { v, runs: [[id, date, distance_m, duration_s, [startLat, startLon], [lat, lon, lat, lon, ...]]] }. Built from exports/detail/*.json, so run it where the detail files are. */
export async function routesStage(db: Store, outDir: string) {
  const runs = await db.all<{ id: number; start_local: string; distance_m: number | null; duration_s: number | null }>(
    `SELECT id, start_local, distance_m, duration_s FROM activities WHERE type LIKE '%running%' AND fit_status='ok' ORDER BY start_local`)
  const out: unknown[] = []
  for (const a of runs) {
    const f = `${outDir}/detail/${a.id}.json`
    if (!existsSync(f)) continue
    const full: [number, number][] = JSON.parse(readFileSync(f, 'utf8')).route ?? []
    if (full.length < 2) continue
    const pts = route(full.map((p) => p[0]), full.map((p) => p[1]), PTS)
    out.push([a.id, a.start_local.slice(0, 10), Math.round(a.distance_m ?? 0), Math.round(a.duration_s ?? 0), [r4(full[0][0]), r4(full[0][1])], pts.flatMap((p) => [r4(p[0]), r4(p[1])])])
  }
  mkdirSync(`${outDir}/routes`, { recursive: true })
  const body = JSON.stringify({ v: 1, runs: out })
  writeFileSync(`${outDir}/routes/all.json`, body)
  log('routes', { runs: out.length, bytes: body.length })
}
