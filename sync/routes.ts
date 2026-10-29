import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { Store } from './store.js'
import { route } from '../src/metrics/activity.js'
import { log } from './log.js'
import { R2 } from './r2.js'

const PTS = 80 // points per run in routes/all.json
const r4 = (x: number) => Math.round(x * 1e4) / 1e4

/** One file for the heatmap and route list: { v, runs: [[id, date, distance_m, duration_s, [startLat, startLon], [lat, lon, lat, lon, ...], sport 'run'|'bike'|'other']] }. Built from exports/detail/*.json, so run it where the detail files are. */
/** With `r2` (the Action run) the existing routes/all.json is kept and only activities missing from it are added, their detail read from the local exports or from R2. Without it, everything is rebuilt from exports/detail. */
export async function routesStage(db: Store, outDir: string, r2?: R2) {
  const runs = await db.all<{ id: number; type: string | null; start_local: string; distance_m: number | null; duration_s: number | null }>(
    `SELECT id, type, start_local, distance_m, duration_s FROM activities WHERE fit_status='ok' ORDER BY start_local`)
  const old = r2 ? await r2.get('routes/all.json').then((b) => (b ? (JSON.parse(Buffer.from(b).toString()).runs as unknown[][]) : [])) : []
  const have = new Map(old.map((r) => [r[0] as number, r]))
  const out: unknown[] = []
  for (const a of runs) {
    if (have.has(a.id)) { out.push(have.get(a.id)); continue }
    const f = `${outDir}/detail/${a.id}.json`
    const raw = existsSync(f) ? readFileSync(f, 'utf8') : r2 ? await r2.get(`detail/${a.id}.json`).then((b) => (b ? Buffer.from(b).toString() : null)) : null
    if (!raw) continue
    const full: [number, number][] = JSON.parse(raw).route ?? []
    if (full.length < 2) continue
    const pts = route(full.map((p) => p[0]), full.map((p) => p[1]), PTS)
    out.push([a.id, a.start_local.slice(0, 10), Math.round(a.distance_m ?? 0), Math.round(a.duration_s ?? 0), [r4(full[0][0]), r4(full[0][1])], pts.flatMap((p) => [r4(p[0]), r4(p[1])]), /running|walking|hiking/.test(a.type ?? '') ? 'run' : /cycl|biking/.test(a.type ?? '') ? 'bike' : 'other'])
  }
  mkdirSync(`${outDir}/routes`, { recursive: true })
  const body = JSON.stringify({ v: 1, runs: out })
  writeFileSync(`${outDir}/routes/all.json`, body)
  if (r2) await r2.put('routes/all.json', Buffer.from(body))
  log('routes', { runs: out.length, bytes: body.length })
}
