import { describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync, readdirSync } from 'node:fs'
import { reconcile } from '../scripts/reconcile.js'

// Synthetic only. Year boundary, null and zero distance, several sports, and an activity whose UTC date
// differs from its local date (start_local decides the day everywhere).
const NOW = Date.parse('2030-06-01T12:00:00Z')
const seed = (rows: [string, string, string | null, number | null][]) => {
  const db = new DatabaseSync(':memory:')
  for (const f of readdirSync('migrations').sort()) db.exec(readFileSync(`migrations/${f}`, 'utf8'))
  rows.forEach(([local, gmt, type, m], i) => db.prepare('INSERT INTO activities (id,start_local,start_gmt,type,distance_m) VALUES (?,?,?,?,?)').run(i + 1, local, gmt, type, m))
  return db
}
const rows: [string, string, string | null, number | null][] = [
  ['2028-12-31 23:30:00', '2029-01-01 06:30:00', 'running', 10049], // local 2028, UTC 2029
  ['2029-01-01 00:10:00', '2028-12-31 23:10:00', 'running', 5051],  // local 2029, UTC 2028
  ['2029-03-03 07:00:00', '2029-03-03 06:00:00', 'running', null],
  ['2029-03-03 18:00:00', '2029-03-03 17:00:00', 'running', 0],
  ['2029-03-03 19:00:00', '2029-03-03 18:00:00', 'running', 8123],  // two on one day
  ['2030-01-02 07:00:00', '2030-01-02 06:00:00', 'cycling', 20111],
  ['2030-05-30 07:00:00', '2030-05-30 06:00:00', 'resort_skiing_snowboarding_ws', 7777],
  ['2030-05-31 07:00:00', '2030-05-31 06:00:00', 'strength_training', null],
  ['2030-05-31 08:00:00', '2030-05-31 07:00:00', 'trail_running', 4321],
  ['2030-06-01 06:00:00', '2030-06-01 05:00:00', null, 1500], // unknown type
]

describe('mileage reconciliation', () => {
  it('endpoint totals equal the plain sum of distance_m per year, sport, month, week and rolling window', async () => {
    const out = await reconcile(seed(rows), NOW)
    expect(new Set(out.map((o) => o.label))).toEqual(new Set(['2028', '2029', '2030', 'rolling']))
    expect(out.length).toBeGreaterThan(100)
    expect(Math.max(...out.map((o) => o.diff))).toBeLessThan(0.5)
  })
})
