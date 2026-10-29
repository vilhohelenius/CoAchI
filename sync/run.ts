// Usage: tsx sync/run.ts steady|backfill|fit|detail|recompute|report|upload [--target remote] [--full]
// Env: GARMIN_API_KEY (or .dev.vars locally). Remote adds CF_ACCOUNT_ID, D1_DATABASE_ID, CF_API_TOKEN, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET.
import { mkdirSync } from 'node:fs'
import { Garmin, localToday } from './garmin.js'
import { log, logError, mask } from './log.js'
import { D1Store, LocalStore, Store, setState } from './store.js'
import { R2 } from './r2.js'
import { uploadDb, uploadFiles } from './upload.js'
import { recompute } from './recompute.js'
import { Ctx, backfill, detailStage, fitStage, steadyActivities, steadyWellness, zones } from './stages.js'

const args = process.argv.slice(2)
const mode = args[0] ?? 'steady'
const remote = args[args.indexOf('--target') + 1] === 'remote' && args.includes('--target')
const outDir = 'exports'
mkdirSync(outDir, { recursive: true })
try { process.loadEnvFile('.dev.vars') } catch {}
const local = new LocalStore(`${outDir}/local.sqlite`)
local.migrate('migrations')
const need = (k: string) => { const v = process.env[k]; if (!v) { log('config', { error: 'missingenv' }); process.exit(1) } return v }
const r2 = remote || mode === 'upload' ? new R2({ accountId: need('CF_ACCOUNT_ID'), bucket: need('R2_BUCKET'), accessKeyId: need('R2_ACCESS_KEY_ID'), secretAccessKey: need('R2_SECRET_ACCESS_KEY') }) : undefined
const d1: Store | undefined = remote || mode === 'upload' ? new D1Store({ accountId: need('CF_ACCOUNT_ID'), dbId: need('D1_DATABASE_ID'), token: need('CF_API_TOKEN') }) : undefined
const db: Store = remote ? d1! : local

if (mode === 'upload') {
  await uploadDb(local, d1!)
  await uploadFiles(outDir, r2!)
  process.exit(0)
}

if (mode === 'report') {
  const tables: [string, string][] = [['activities', 'substr(start_local,1,10)'], ['activity_steps', 'NULL'], ['daily_summary', 'date'], ['sleep', 'date'], ['hrv_daily', 'date'],
    ['body_battery', 'date'], ['stress', 'date'], ['steps', 'date'], ['hr_zones', 'effective_date'], ['goals', 'NULL']]
  for (const [t, d] of tables) {
    const [r] = await local.all<{ n: number; a: string; b: string }>(`SELECT COUNT(*) n, MIN(${d}) a, MAX(${d}) b FROM ${t}`)
    console.log(`${t}: ${r.n}${r.a ? ` ${r.a}..${r.b}` : ''}`)
  }
  console.log('runs:', (await local.all<any>(`SELECT COUNT(*) n FROM activities WHERE type LIKE '%running%'`))[0].n,
    'fit ok/error/none:', (await local.all<any>(`SELECT fit_status s, COUNT(*) n FROM activities WHERE type LIKE '%running%' GROUP BY s`)).map((r) => `${r.s}=${r.n}`).join(' '))
  const y = new Date(Date.now() - 365 * 864e5).toLocaleDateString('sv-SE')
  console.log('last 12 months activities/runs:', ...(await local.all<any>(`SELECT COUNT(*) n, SUM(type LIKE '%running%') r FROM activities WHERE start_local >= ?`, [y])).map((r) => `${r.n}/${r.r}`))
  process.exit(0)
}

if (mode === 'recompute') {
  await recompute(db, localToday(), args.includes('--full'))
  process.exit(0)
}

if (mode === 'detail') {
  await detailStage({ outDir, db: local } as unknown as Ctx) // offline: re-derives detail/*.json from exports/fit and the local dynamics columns
  process.exit(0)
}

const apiKey = process.env.GARMIN_API_KEY
if (!apiKey) { log('config', { error: 'missingkey' }); process.exit(1) }
mask(apiKey)
// Hide the minted JWT from GitHub logs before anything can print it.
const onSecret = (s: string) => { mask(s); if (process.env.GITHUB_ACTIONS) console.log(`::add-mask::${s}`) }
const g = new Garmin({ apiKey, onSecret, gapMs: Number(process.env.GAP_MS ?? 1000) })
const budgetMin = Number(process.env.BUDGET_MIN ?? 40)
const c: Ctx = { g, db, today: localToday(), outDir, deadline: Date.now() + budgetMin * 60e3,
  put: r2 && (async (k, b) => { await r2.put(k, b) }) }

try {
  await setState(db, 'run_started_at', String(Date.now()))
  if (mode === 'steady') { await steadyActivities(c); await steadyWellness(c, Number(process.env.DAYS ?? 3)); await zones(c); await fitStage(c); await recompute(db, c.today, args.includes('--full')) }
  else if (mode === 'backfill') { const r = await backfill(c); log('backfill', { status: r }); if (r === 'done') { await fitStage(c); await recompute(db, c.today, true) } }
  else if (mode === 'fit') await fitStage(c)
  else throw new Error('mode')
  await setState(db, 'last_sync_ok', String(Date.now()))
  await setState(db, 'last_error', '')
  log('done', { limited: g.rateLimited, gapms: g.gapMs, mints: g.mints })
} catch (e) {
  logError(mode, e)
  const x = e as { endpoint?: string; status?: number }
  const code = x?.endpoint === 'token' && (x.status === 401 || x.status === 403) ? 'KEY_INVALID' : x?.endpoint ? `${x.endpoint} ${x.status}` : 'error'
  await setState(db, 'last_error', code)
  await setState(db, 'last_error_at', String(Date.now()))
  process.exit(1)
}
