import { DatabaseSync } from 'node:sqlite'
import { readFileSync, readdirSync } from 'node:fs'

export type Stmt = [sql: string, params?: unknown[]]
export interface Store {
  all<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>
  batch(stmts: Stmt[]): Promise<void>
}

const norm = (v: unknown) => (v === undefined ? null : typeof v === 'boolean' ? +v : v)

export class LocalStore implements Store {
  db: DatabaseSync
  constructor(path: string) { this.db = new DatabaseSync(path) }
  async all<T>(sql: string, params: unknown[] = []) { return this.db.prepare(sql).all(...(params.map(norm) as never[])) as T[] }
  async batch(stmts: Stmt[]) {
    this.db.exec('BEGIN')
    try { for (const [s, p = []] of stmts) this.db.prepare(s).run(...(p.map(norm) as never[])); this.db.exec('COMMIT') }
    catch (e) { this.db.exec('ROLLBACK'); throw e }
  }
  // Runs migrations/*.sql once each, in name order. D1 gets the same files via wrangler.
  migrate(dir: string) {
    this.db.exec('CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY)')
    for (const f of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
      if (this.db.prepare('SELECT 1 FROM _migrations WHERE name=?').get(f)) continue
      this.db.exec('BEGIN'); this.db.exec(readFileSync(`${dir}/${f}`, 'utf8'))
      this.db.prepare('INSERT INTO _migrations VALUES (?)').run(f); this.db.exec('COMMIT')
    }
  }
}

// Cloudflare D1 over REST. Errors carry only the status code.
export class D1Store implements Store {
  constructor(private o: { accountId: string; dbId: string; token: string; fetch?: typeof fetch }) {}
  private async q(body: unknown) {
    const f = this.o.fetch ?? fetch
    const r = await f(`https://api.cloudflare.com/client/v4/accounts/${this.o.accountId}/d1/database/${this.o.dbId}/query`, {
      method: 'POST', headers: { authorization: `Bearer ${this.o.token}`, 'content-type': 'application/json' }, body: JSON.stringify(body),
    })
    if (!r.ok) throw new Error(`d1 ${r.status}`)
    const j = (await r.json()) as { success: boolean; result: { results: never[] }[] }
    if (!j.success) throw new Error('d1 failed')
    return j.result
  }
  async all<T>(sql: string, params: unknown[] = []) { return (await this.q({ sql, params: params.map(norm) }))[0].results as T[] }
  // D1 REST limits: keep each request to 100 statements and about 500 KB of body.
  async batch(stmts: Stmt[]) {
    let chunk: Stmt[] = [], size = 0
    const flush = async () => { if (chunk.length) await this.q({ batch: chunk.map(([sql, params = []]) => ({ sql, params: params.map(norm) })) }); chunk = []; size = 0 }
    for (const s of stmts) {
      const n = JSON.stringify(s).length
      if (chunk.length >= 100 || (chunk.length && size + n > 5e5)) await flush()
      chunk.push(s); size += n
    }
    await flush()
  }
}

export function upsertStmt(table: string, pk: string[], row: Record<string, unknown>): Stmt {
  const cols = Object.keys(row)
  const set = cols.filter((c) => !pk.includes(c)).map((c) => `${c}=excluded.${c}`).join(',')
  const sql = `INSERT INTO ${table} (${cols}) VALUES (${cols.map(() => '?')}) ON CONFLICT(${pk}) DO ${set ? `UPDATE SET ${set}` : 'NOTHING'}`
  return [sql, cols.map((c) => row[c])]
}

export async function upsert(db: Store, table: string, pk: string[], rows: Record<string, unknown>[]) {
  if (rows.length) await db.batch(rows.map((r) => upsertStmt(table, pk, r)))
  return rows.length
}

export async function getState(db: Store, key: string) {
  return (await db.all<{ value: string }>('SELECT value FROM sync_state WHERE key=?', [key]))[0]?.value
}
export const setState = (db: Store, key: string, value: string) =>
  upsert(db, 'sync_state', ['key'], [{ key, value, updated_at: Date.now() }])
