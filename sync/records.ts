import { existsSync, readFileSync } from 'node:fs'
import { Store, Stmt, upsertStmt } from './store.js'
import { parseFit, unzipFit, type Streams } from './fit.js'
import { log } from './log.js'
import { bestRows, fitness, runEfforts, type Prof, type Row } from '../src/metrics/records.js'

/** Statements that replace one run's rows in activity_efforts. Also used by the fit stage while the streams are in memory. */
export function effortStmts(id: number, s: Streams): Stmt[] {
  const e = Object.entries(runEfforts(s))
  return [['DELETE FROM activity_efforts WHERE activity_id=?', [id]],
    ...[...e.map(([l, [v, n]]) => [l, v, n] as const), ['done', 1, null] as const].map(([l, v, n]): Stmt => ['INSERT INTO activity_efforts (activity_id,label,value,n) VALUES (?,?,?,?)', [id, l, v, n]])]
}

/** Analyses runs not yet seen (from exports/fit), then rebuilds best_efforts and the stored fitness blob. `full` re-reads every run. */
export async function recordsStage(db: Store, today: string, outDir: string, full = false) {
  if (full) await db.batch([['DELETE FROM activity_efforts']])
  const todo = await db.all<{ id: number }>(`SELECT id FROM activities WHERE type LIKE '%running%' AND type NOT IN ('treadmill_running','indoor_running') AND fit_status='ok' AND id NOT IN (SELECT activity_id FROM activity_efforts WHERE label='done')`)
  let read = 0, missing = 0, failed = 0
  for (const { id } of todo) {
    const f = `${outDir}/fit/${id}.zip`
    if (!existsSync(f)) { missing++; continue }
    try { await db.batch(effortStmts(id, parseFit(unzipFit(readFileSync(f))).streams)); read++ } catch { failed++ }
  }
  const rows = await db.all<Row>(`SELECT e.activity_id id, e.label, e.value, e.n, substr(a.start_local,1,10) date FROM activity_efforts e JOIN activities a ON a.id=e.activity_id WHERE a.type NOT IN ('treadmill_running','indoor_running') AND e.label != 'done'`)
  const man = await db.all<{ id: number; label: string; value: number; date: string }>('SELECT id, label, value, date FROM manual_efforts').catch(() => [])
  for (const m of man) rows.push({ id: -m.id, label: m.label, value: m.value, n: null, date: m.date }) // negative id marks a manual result
  const zr = await db.all<any>('SELECT * FROM hr_zones ORDER BY effective_date')
  const prof = (day: string): Prof | null => {
    const pick = (s: string) => { const r = zr.filter((z) => z.sport === s && z.max_hr && z.rest_hr); return r.filter((z) => z.effective_date <= day).at(-1) ?? r[0] }
    const z = pick('RUNNING') ?? pick('DEFAULT')
    return z ? { rest: z.rest_hr, max: z.max_hr } : null
  }
  const best = bestRows(rows)
  await db.batch([
    ['DELETE FROM best_efforts'],
    ...best.map((b): Stmt => upsertStmt('best_efforts', ['label', 'activity_id'], { label: b.label, activity_id: b.id, value: b.value, date: b.date, rank: b.rank, is_pb: b.is_pb })),
    upsertStmt('metric_daily', ['date', 'key'], { date: today, key: 'fitness', value: null, json: JSON.stringify(fitness(rows, prof, today)) }),
  ])
  log('records', { analysed: read, no_file: missing, failed, rows: rows.length, kept: best.length })
}
