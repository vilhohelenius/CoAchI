import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { log } from './log.js'
import { LocalStore, Store, getState, setState, upsert } from './store.js'
import { R2 } from './r2.js'

const PAGE = 100 // rows per D1 request (D1 REST batch limit is applied again inside D1Store)

// Copies every local table into the remote store, except shoes and activities.shoe_id: those are edited in the app, so the remote copy is the truth. Upserts make reruns safe. The remote sync_state key
// upload_<table> holds the rows already copied, so an interrupted run resumes there.
// ponytail: offset paging assumes the local db does not change during an upload.
export async function uploadDb(local: LocalStore, remote: Store) {
  const tables = (await local.all<{ name: string }>(
    `SELECT name FROM sqlite_master WHERE type='table' AND name != 'shoes' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '\\_%' ESCAPE '\\' ORDER BY name`)).map((t) => t.name)
  for (const t of tables) {
    const pk = (await local.all<{ name: string; pk: number }>(`PRAGMA table_info(${t})`)).filter((c) => c.pk).sort((a, b) => a.pk - b.pk).map((c) => c.name)
    let done = Number(await getState(remote, `upload_${t}`)) || 0
    const total = (await local.all<{ n: number }>(`SELECT COUNT(*) n FROM ${t}`))[0].n
    const start = done
    while (done < total) {
      const rows = await local.all<Record<string, unknown>>(`SELECT * FROM ${t} ORDER BY rowid LIMIT ? OFFSET ?`, [PAGE, done])
      if (t === 'activities') rows.forEach((r) => delete r.shoe_id)
      await upsert(remote, t, pk, rows)
      done += rows.length
      await setState(remote, `upload_${t}`, String(done))
    }
    log('upload', { table: t, rows: done - start, skipped: start })
  }
  await remote.batch([[`DELETE FROM sync_state WHERE key LIKE 'upload\\_%' ESCAPE '\\'`]])
}

export async function uploadFiles(dir: string, r2: R2) {
  let sent = 0, skipped = 0
  for (const sub of ['fit', 'streams', 'detail', 'routes']) {
    if (!existsSync(`${dir}/${sub}`)) continue
    for (const f of readdirSync(`${dir}/${sub}`)) {
      const key = `${sub}/${f}`
      if (sub !== 'detail' && sub !== 'routes' && await r2.exists(key)) { // detail and routes are derived, always overwrite
        skipped++; continue
      }
      await r2.put(key, readFileSync(`${dir}/${key}`))
      sent++
    }
  }
  log('upload_files', { sent, skipped })
}
