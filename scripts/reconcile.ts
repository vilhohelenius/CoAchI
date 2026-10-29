// Proves the mileage endpoints agree with a plain SUM(distance_m) of the activities table.
// Usage: npx tsx scripts/reconcile.ts [path/to/local.sqlite]   (default exports/local.sqlite, opened read-only)
// Prints only pass/fail per year and the largest difference in metres, never activity data or totals.
import { DatabaseSync } from 'node:sqlite'
import { pathToFileURL } from 'node:url'
import { Hono } from 'hono'
import { metricRoutes } from '../src/worker/api.js'
import type { Env } from '../src/worker/index.js'
import { addDays, weekStart } from '../src/metrics/dates.js'
import { sportOf } from '../src/metrics/load.js'

const SPORTS = ['all', 'run', 'bike', 'ski', 'strength']
const km1 = (m: number) => Math.round(m / 100) / 10 // same rounding as the endpoints, so the expected value is exact

/** Returns one { label, diff } per check (diff in metres, 0 when exact). Label is a year or 'rolling'. */
export async function reconcile(db: DatabaseSync, now = Date.now()) {
  const acts = db.prepare('SELECT start_local d, type t, distance_m m FROM activities').all() as { d: string; t: string | null; m: number | null }[]
  const app = new Hono<{ Bindings: Env }>(); metricRoutes(app, () => now)
  const env = { DB: { prepare: (sql: string) => ({ bind: (...a: unknown[]) => ({ all: async () => ({ results: db.prepare(sql).all(...(a as never[])) }), run: async () => {} }) }) } } as unknown as Env
  const get = async (p: string) => (await app.request(p, {}, env)).json() as Promise<any>
  const out: { label: string; diff: number }[] = []
  const chk = (label: string, got: number | null | undefined, sum: number) => out.push({ label, diff: Math.abs(((got ?? 0) - km1(sum)) * 1000) })
  const today = new Date(now).toISOString().slice(0, 10)
  for (const sp of SPORTS) {
    const rows = acts.filter((a) => sp === 'all' || sportOf(a.t ?? '') === sp)
    const sums = (key: (d: string) => string) => { const s = new Map<string, number>(); for (const a of rows) s.set(key(a.d), (s.get(key(a.d)) ?? 0) + (a.m ?? 0)); return s }
    const q = sp === 'all' ? '' : `&sport=${sp}`
    const byYear = sums((d) => d.slice(0, 4))
    for (const p of (await get(`/api/mileage?by=year${q}`)).periods) chk(p.key, p.km, byYear.get(p.key) ?? 0)
    const cmp = await get(`/api/mileage/compare?${q.slice(1)}`)
    for (const y of cmp.years) { chk(String(y.year), y.total_km, byYear.get(String(y.year)) ?? 0); chk(String(y.year), y.points.at(-1)[1], byYear.get(String(y.year)) ?? 0) }
    for (const [y, s] of byYear) if (s > 0 && !cmp.years.some((c: any) => String(c.year) === y)) out.push({ label: y, diff: s }) // year missing from compare
    const mo = sums((d) => d.slice(0, 7)), wk = sums((d) => weekStart(d.slice(0, 10)))
    for (const p of (await get(`/api/mileage?by=month${q}`)).periods) chk(p.key.slice(0, 4), p.km, mo.get(p.key) ?? 0)
    for (const p of (await get(`/api/mileage?by=week${q}`)).periods) chk(p.key.slice(0, 4), p.km, wk.get(p.key) ?? 0)
    const win = (days: number) => rows.reduce((s, a) => s + (a.d.slice(0, 10) > addDays(today, -days) && a.d.slice(0, 10) <= today ? (a.m ?? 0) : 0), 0)
    // null = less history than the window, by design
    if (cmp.rolling.km30.at(-1) != null) chk('rolling', cmp.rolling.km30.at(-1), win(30))
    if (cmp.rolling.km365.at(-1) != null) chk('rolling', cmp.rolling.km365.at(-1), win(365))
  }
  return out
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const out = await reconcile(new DatabaseSync(process.argv[2] ?? 'exports/local.sqlite', { readOnly: true }))
  const by = new Map<string, number>()
  for (const { label, diff } of out) by.set(label, Math.max(by.get(label) ?? 0, diff))
  const tol = 0.5 // metres, float noise only
  for (const [label, d] of [...by].sort()) console.log(`${label}: ${d <= tol ? 'pass' : 'FAIL'}`)
  const max = Math.max(0, ...by.values())
  console.log(`max abs diff: ${max.toFixed(1)} m`)
  process.exit(max <= tol ? 0 : 1)
}
