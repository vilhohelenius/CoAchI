import { Store, Stmt, upsertStmt } from './store.js'
import { log } from './log.js'
import { addDays, dow, mean, r2, range } from '../src/metrics/dates.js'
import { Sport, Zones, acwr, activityLoad, loadSeries, project, ramp, sportOf } from '../src/metrics/load.js'
import { Series, hrvDay, streaks } from '../src/metrics/hrv.js'
import { Night, consistency, debt } from '../src/metrics/sleep.js'
import { readiness } from '../src/metrics/readiness.js'
import { trainingStatus } from '../src/metrics/status.js'
import { goals } from '../src/metrics/goals.js'

const LOOKBACK = Number(process.env.RECOMP_DAYS ?? 14) // incremental window: older edits need --full
const KEEP = 400                                         // days of wellness and per-sport metrics kept
const SPORTS: Sport[] = ['run', 'bike', 'ski', 'strength']
const j = (o: unknown) => JSON.stringify(o, (_, v) => (typeof v === 'number' ? r2(v, 3) : v))

/** Rebuilds load_daily and metric_daily from raw rows. Computes everything in memory, writes only days from `from`. */
export async function recompute(db: Store, today: string, full = false) {
  const all = <T>(sql: string, p?: unknown[]) => db.all<T>(sql, p)
  const acts = await all<any>(`SELECT id, substr(start_local,1,10) day, type, duration_s, avg_hr, rpe, hr_z1_s, hr_z2_s, hr_z3_s, hr_z4_s, hr_z5_s FROM activities WHERE start_local IS NOT NULL AND substr(start_local,1,10) <= ?`, [today])
  if (!acts.length) return log('recompute', { days: 0 })
  full ||= !(await all('SELECT 1 FROM load_daily LIMIT 1')).length
  const zrows = await all<any>('SELECT * FROM hr_zones ORDER BY effective_date')
  const zones = (sport: Sport, day: string): Zones | null => {
    const want = sport === 'run' ? 'RUNNING' : sport === 'bike' ? 'CYCLING' : 'DEFAULT'
    const pick = (s: string) => { const r = zrows.filter((z) => z.sport === s); return r.filter((z) => z.effective_date <= day).at(-1) ?? r[0] }
    const z = pick(want) ?? pick('DEFAULT')
    return z?.lthr && z.max_hr && z.rest_hr ? { lthr: z.lthr, max_hr: z.max_hr, rest_hr: z.rest_hr, floors: [z.z1, z.z2, z.z3, z.z4, z.z5] } : null
  }

  const first = acts.reduce((m, a) => (a.day < m ? a.day : m), acts[0].day)
  const from = full ? first : addDays(today, -LOOKBACK)
  const days = range(first, today), ix = new Map(days.map((d, i) => [d, i]))
  const total = days.map(() => 0), by = Object.fromEntries(SPORTS.map((s) => [s, days.map(() => 0)])) as Record<Sport, number[]>
  const cnt = Object.fromEntries(SPORTS.map((s) => [s, days.map(() => 0)])) as Record<Sport, number[]>
  const zs = days.map(() => [0, 0, 0, 0, 0]), zsBy = new Map<string, number[]>()
  const out: Stmt[] = []
  for (const a of acts) {
    const sp = sportOf(a.type), i = ix.get(a.day)!
    const zsec = [a.hr_z1_s, a.hr_z2_s, a.hr_z3_s, a.hr_z4_s, a.hr_z5_s]
    const { load, source } = activityLoad({ type: a.type, duration_s: a.duration_s, avg_hr: a.avg_hr, zone_s: zsec, rpe: a.rpe }, zones(sp, a.day))
    total[i] += load
    if (sp in by) { by[sp][i] += load; cnt[sp][i]++ }
    zsec.forEach((s, k) => { zs[i][k] += s ?? 0 })
    if (zsec.some((s) => s)) { const k = `${a.day}|${sp}`, v = zsBy.get(k) ?? [0, 0, 0, 0, 0]; zsec.forEach((s, n) => { v[n] += s ?? 0 }); zsBy.set(k, v) }
    if (a.day >= from) out.push(['UPDATE activities SET load=?, load_source=? WHERE id=?', [r2(load), source, a.id]])
  }
  const m = (date: string, key: string, value: number | null, json?: unknown) => out.push(upsertStmt('metric_daily', ['date', 'key'], { date, key, value: r2(value, 3), json: json === undefined ? null : j(json) }))

  // ---- load ----
  const pts = loadSeries(total), perSport = Object.fromEntries(SPORTS.map((s) => [s, loadSeries(by[s])])) as Record<Sport, ReturnType<typeof loadSeries>>
  const ctl = pts.map((p) => p.ctl)
  const sum = (a: number[], i: number, n: number) => a.slice(Math.max(0, i - n + 1), i + 1).reduce((s, x) => s + x, 0)
  let nLoad = 0
  days.forEach((d, i) => {
    if (d < from) return
    const zAll = sum(zs.map((z) => z.reduce((s, x) => s + x, 0)), i, 28), zHard = sum(zs.map((z) => z[2] + z[3] + z[4]), i, 28)
    const p = pts[i], st = trainingStatus({ days: i + 1, ctl: p.ctl, ctl7: i >= 7 ? pts[i - 7].ctl : null, ctl28: i >= 28 ? pts[i - 28].ctl : null, atl: p.atl, atl7: i >= 7 ? pts[i - 7].atl : null,
      tsb: p.tsb, acwr: acwr(total, i), hard_share: zAll > 0 ? zHard / zAll : null })
    out.push(upsertStmt('load_daily', ['date'], { date: d, load: r2(total[i]), ctl: r2(p.ctl), atl: r2(p.atl), tsb: r2(p.tsb), tsb_end: r2(p.tsb_end),
      acwr: r2(acwr(total, i)), ramp7: r2(ramp(ctl, i)), status: st.label, warming_up: +(i < 84) }))
    if (d === today) m(d, 'status', null, { reason: st.reason }) // read by /api/today
    nLoad++
    if (d >= addDays(today, -KEEP))
      for (const s of SPORTS) {
        const n35 = sum(cnt[s], i, 35)
        if (n35 >= 5) m(d, `load.${s}`, null, { load: by[s][i], ctl: perSport[s][i].ctl, atl: perSport[s][i].atl, tsb: perSport[s][i].tsb, acwr: acwr(by[s], i), n35 })
      }
  })
  for (const [k, v] of zsBy) { const [d, s] = k.split('|'); if (d >= from) m(d, `zsec.${s}`, null, v) }

  // ---- wellness ----
  const wd = range(addDays(today, -(KEEP + 70)), today), wi = new Map(wd.map((d, i) => [d, i]))
  const hrv: Series = wd.map(() => null), rhr: Series = wd.map(() => null)
  for (const r of await all<any>('SELECT date, last_night_avg v FROM hrv_daily WHERE date >= ?', [wd[0]])) if (wi.has(r.date)) hrv[wi.get(r.date)!] = r.v
  for (const r of await all<any>('SELECT date, rhr v FROM daily_summary WHERE date >= ?', [wd[0]])) if (wi.has(r.date)) rhr[wi.get(r.date)!] = r.v
  const nights = await all<Night>('SELECT date, start_ts, end_ts, total_s, deep_s, light_s, rem_s, awake_s, score FROM sleep WHERE date >= ? ORDER BY date', [addDays(wd[0], -30)])
  const night = new Map(nights.map((n) => [n.date, n]))
  const bb = new Map((await all<any>('SELECT date, max_level v FROM body_battery WHERE date >= ?', [wd[0]])).map((r) => [r.date, r.v as number | null]))
  const injury = (await all('SELECT 1 FROM coach_notes WHERE active=1 AND kind=\'injury\' AND (expires_on IS NULL OR expires_on >= ?) LIMIT 1', [today])).length > 0
  const hd = wd.map((_, i) => hrvDay(hrv, rhr, i)), streak = streaks(hd.map((h) => h.balance.balanced))
  let nWell = 0
  wd.forEach((d, i) => {
    if (d < from || d < addDays(today, -KEEP)) return
    const h = hd[i], n = night.get(d), sc = consistency(nights, d), db_ = debt(nights, d), li = ix.get(d)
    if (h.n7 || h.last != null) { m(d, 'hrv', null, { last: h.last, h7: h.h7, base: h.base_mean, low: h.low, high: h.high, z: h.z_hrv, z_last: h.z_last, status: h.status, n7: h.n7, n_base: h.n_base, range_ok: h.range_ok }); nWell++ }
    if (h.rhr7 != null || h.balance.balanced != null) m(d, 'recovery', null, { rhr7: h.rhr7, z_rhr: h.z_rhr, divergence: h.divergence, balance: h.balance, streak_days: streak[i] })
    if (sc.n || db_.n) m(d, 'sleep', null, { sd_min: sc.sd_min, n_nights7: sc.n, social_jetlag_min: sc.social_jetlag_min, debt_h: db_.debt_h, n_debt: db_.n, need_h: db_.need_h })
    const r = readiness({
      hrv: h.z_hrv == null ? null : { z7: h.z_hrv, z_last: h.z_last, n: h.n_base },
      rhr: h.z_rhr == null ? null : { z: h.z_rhr, n: h.n_rhr7 },
      sleep: n?.total_s ? { total_s: n.total_s, score: n.score, need_h: 8 } : null,
      debt: db_.debt_h == null ? null : { debt_h: db_.debt_h, n: db_.n },
      load: li == null ? null : { tsb: pts[li].tsb, acwr: acwr(total, li), days: li + 1 },
      bb_max: bb.get(d) ?? null, injury: injury && d === today,
    })
    if (r.score != null) m(d, 'readiness', r.score, { label: r.label, confidence: r.confidence, capped: r.capped, n_components: r.n_components, drivers: r.drivers, components: r.components })
  })

  // ---- today only: goals and 21-day projection ----
  const t = ix.get(today)!, g = await all<any>(`SELECT kind, target_value v, target_max mx FROM goals WHERE status='active'`)
  const tv = (k: string) => g.find((x) => x.kind === k)
  const run_m: Record<string, number> = {}, steps: Record<string, number> = {}
  const gFrom = [`${today.slice(0, 4)}-01-01`, addDays(today, -56)].sort()[0] // year start, or 8 weeks back if that reaches into last year
  for (const a of await all<any>(`SELECT substr(start_local,1,10) d, SUM(distance_m) m FROM activities WHERE type LIKE '%running%' AND start_local >= ? GROUP BY d`, [gFrom])) run_m[a.d] = a.m
  for (const a of await all<any>(`SELECT date d, steps s FROM daily_summary WHERE date >= ? AND steps IS NOT NULL`, [addDays(today, -60)])) steps[a.d] = a.s
  if (tv('distance') && tv('weekly_km') && tv('steps'))
    m(today, 'goals', null, goals({ today, year_km: tv('distance').v, band_lo: tv('weekly_km').v, band_hi: tv('weekly_km').mx, steps_goal: tv('steps').v, run_m, steps }))
  const tw = Array.from({ length: 7 }, (_, wd_) => mean(days.map((d, i) => (i > t - 28 && dow(d) === wd_ ? total[i] : NaN)).filter((x) => !Number.isNaN(x))))
  const next = Array.from({ length: 21 }, (_, k) => addDays(today, k + 1))
  const slim = (p: ReturnType<typeof project>) => p.map((x) => ({ ctl: x.ctl, tsb: x.tsb }))
  m(today, 'projection', null, { ctl: pts[t].ctl, atl: pts[t].atl, ctl_tau: 42, atl_tau: 7, typical_week: tw.map((x) => (Number.isNaN(x) ? 0 : x)),
    rest: slim(project(pts[t].ctl, pts[t].atl, next.map(() => 0))), typical: slim(project(pts[t].ctl, pts[t].atl, next.map((d) => (Number.isNaN(tw[dow(d)]) ? 0 : tw[dow(d)])))) })

  await db.batch(out)
  log('recompute', { days: days.length, load_rows: nLoad, wellness_rows: nWell, stmts: out.length })
}
