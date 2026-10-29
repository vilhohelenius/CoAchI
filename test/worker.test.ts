import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { generateKeyPair, exportJWK, SignJWT } from './jwt.js'
import { createApp, daysLeft, watchdog, type Env } from '../src/worker/index.js'
import { resetJwksCache } from '../src/worker/access.js'
import { LocalStore } from '../sync/store.js'
import { recompute } from '../sync/recompute.js'
import { assignShoes } from '../sync/stages.js'
import { recordsStage } from '../sync/records.js'
import { R2 } from '../sync/r2.js'
import { D1Store } from '../sync/store.js'
import { uploadDb, uploadFiles } from '../sync/upload.js'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'

const TEAM = 'team.example.cloudflareaccess.com', AUD = 'aud-123', NOW = Date.parse('2030-06-01T12:00:00Z')
const kp = await generateKeyPair(), other = await generateKeyPair()
const jwk = { ...(await exportJWK(kp.publicKey)), kid: 'k1' }
const tok = (o: { exp?: number; aud?: string; key?: CryptoKey } = {}) =>
  SignJWT({ aud: [o.aud ?? AUD], iss: `https://${TEAM}`, exp: o.exp ?? NOW / 1000 + 600 }, o.key ?? kp.privateKey, 'k1')

function mkDb() {
  const l = new LocalStore(':memory:'); l.migrate('migrations')
  const db = { prepare: (sql: string) => ({ bind: (...a: unknown[]) => ({
    all: async () => ({ results: await l.all(sql, a) }), run: async () => { await l.batch([[sql, a]]) } }) }) }
  return { l, db }
}
let calls: { url: string; method: string }[], ghStatus: number
const fakeFetch = (async (u: any, init: any = {}) => {
  const url = String(u?.url ?? u)
  calls.push({ url, method: init.method ?? 'GET' })
  if (url.includes('/cdn-cgi/access/certs')) return Response.json({ keys: [jwk] })
  if (url.endsWith('/enable')) return new Response(null, { status: 204 })
  if (url.includes('/actions/workflows/')) return init.method === 'POST' ? new Response(null, { status: ghStatus }) : Response.json({ state: ghState })
  return new Response('', { status: 404 })
}) as typeof fetch
let ghState = 'active', now = NOW
const mk = () => {
  const { l, db } = mkDb()
  const env = { DB: db, ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, GITHUB_REPO: 'o/r', GITHUB_DISPATCH_TOKEN: 'x', GARMIN_KEY_EXPIRES: '2030-06-20', PAT_EXPIRES: '2031-01-01' } as Env
  return { l, env, app: createApp({ fetch: fakeFetch, now: () => now }) }
}
const req = async (app: ReturnType<typeof mk>['app'], env: Env, path: string, method = 'GET', t?: string) =>
  app.request(path, { method, headers: t ? { 'Cf-Access-Jwt-Assertion': t } : {} }, env)

beforeEach(() => { calls = []; ghStatus = 204; ghState = 'active'; now = NOW; resetJwksCache() })

describe('access jwt', () => {
  it('accepts valid, rejects expired, wrong aud, wrong signature, missing', async () => {
    const { app, env } = mk()
    expect((await req(app, env, '/api/status', 'GET', await tok())).status).toBe(200)
    expect((await req(app, env, '/api/status', 'GET', await tok({ exp: NOW / 1000 - 1 }))).status).toBe(401)
    expect((await req(app, env, '/api/status', 'GET', await tok({ aud: 'nope' }))).status).toBe(401)
    expect((await req(app, env, '/api/status', 'GET', await tok({ key: other.privateKey }))).status).toBe(401)
    expect((await req(app, env, '/api/status')).status).toBe(401)
  })
})

describe('status', () => {
  it('has the expected shape and banner flags', async () => {
    const { app, env, l } = mk()
    await l.batch([["INSERT INTO sync_state VALUES ('last_sync_ok','123',1)"], ["INSERT INTO sync_state VALUES ('last_error','',1)"]])
    const j: any = await (await req(app, env, '/api/status', 'GET', await tok())).json()
    expect(j.sync).toMatchObject({ last_ok: '123', last_error: null })
    expect(j.counts).toMatchObject({ activities: 0, goals: 3 })
    expect(j.garmin_key).toEqual({ expires_on: '2030-06-20', days_left: 19, banner: true })
    expect(j.pat.banner).toBe(false)
  })
  it('banner flips at 30 days with a faked date', () => {
    expect(daysLeft('2030-07-01', Date.parse('2030-06-01')).banner).toBe(true)
    expect(daysLeft('2030-07-02', Date.parse('2030-06-01')).banner).toBe(false)
    expect(daysLeft(undefined, NOW)).toEqual({ expires_on: null, days_left: null, banner: false })
  })
})

describe('dispatch', () => {
  it('rate limits to one per 2 minutes', async () => {
    const { app, env } = mk(), t = await tok()
    expect((await req(app, env, '/api/sync', 'POST', t)).status).toBe(202)
    expect((await req(app, env, '/api/sync', 'POST', t)).status).toBe(429)
    now += 119e3
    expect((await req(app, env, '/api/sync', 'POST', t)).status).toBe(429)
    now += 2e3
    expect((await req(app, env, '/api/sync', 'POST', await tok({ exp: now / 1000 + 60 }))).status).toBe(202)
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(2)
  })
  it('a failed dispatch does not consume the slot', async () => {
    const { app, env } = mk(), t = await tok()
    ghStatus = 403
    expect((await req(app, env, '/api/sync', 'POST', t)).status).toBe(502)
    ghStatus = 204
    expect((await req(app, env, '/api/sync', 'POST', t)).status).toBe(202)
  })
})

describe('watchdog', () => {
  it('re-enables only when disabled for inactivity', async () => {
    const { env } = mk()
    expect(await watchdog(env, fakeFetch)).toBe('active')
    expect(calls.some((c) => c.method === 'PUT')).toBe(false)
    ghState = 'disabled_inactivity'
    expect(await watchdog(env, fakeFetch)).toBe('re-enabled')
    expect(calls.at(-1)).toMatchObject({ method: 'PUT' })
  })
})

describe('D1 batching and resume', () => {
  const rec = () => {
    const bodies: any[] = []
    const f = (async (_u: any, init: any) => { const b = JSON.parse(init.body); bodies.push(b)
      return Response.json({ success: true, result: [{ results: [] }] }) }) as typeof fetch
    return { bodies, d1: new D1Store({ accountId: 'a', dbId: 'd', token: 't', fetch: f }) }
  }
  it('splits by 100 statements and by size', async () => {
    const { bodies, d1 } = rec()
    await d1.batch(Array.from({ length: 250 }, (): [string, unknown[]] => ['SELECT 1', []]))
    expect(bodies.map((b) => b.batch.length)).toEqual([100, 100, 50])
    bodies.length = 0
    await d1.batch(Array.from({ length: 4 }, (): [string, unknown[]] => ['SELECT ?', ['x'.repeat(200e3)]]))
    expect(bodies.map((b) => b.batch.length)).toEqual([2, 2])
  })
  it('upload resumes from the stored cursor and is idempotent', async () => {
    const local = new LocalStore(':memory:'); local.migrate('migrations')
    await local.batch(Array.from({ length: 250 }, (_, i): [string, unknown[]] => ['INSERT INTO steps (date, steps) VALUES (?, ?)', [`2030-01-${i}`, i]]))
    const remote = new LocalStore(':memory:'); remote.migrate('migrations')
    // pretend a previous run copied 200 rows and died
    await remote.batch([["INSERT INTO sync_state VALUES ('upload_steps','200',1)"]])
    const q = vi.spyOn(remote, 'batch')
    await uploadDb(local, remote)
    const copied = (await remote.all<{ n: number }>('SELECT COUNT(*) n FROM steps'))[0].n
    expect(copied).toBe(50) // only the rows after the cursor
    expect((await remote.all('SELECT * FROM sync_state WHERE key LIKE ?', ['upload_%'])).length).toBe(0)
    q.mockClear()
    await uploadDb(local, remote) // full rerun upserts all 250 again, no duplicates
    expect((await remote.all<{ n: number }>('SELECT COUNT(*) n FROM steps'))[0].n).toBe(250)
  })
})

describe('R2', () => {
  it('signs requests and skips existing keys', async () => {
    const seen: Request[] = [], have = new Set(['fit/1.zip'])
    const f = (async (r: Request) => { seen.push(r.clone())
      if (r.method === 'HEAD') return new Response(null, { status: have.has(new URL(r.url).pathname.slice('/bkt/'.length)) ? 200 : 404 })
      return new Response(null, { status: 200 }) }) as unknown as typeof fetch
    const r2 = new R2({ accountId: 'acc', bucket: 'bkt', accessKeyId: 'AK', secretAccessKey: 'SK', fetch: f })
    const dir = mkdtempSync(`${tmpdir()}/up`)
    mkdirSync(`${dir}/fit`); mkdirSync(`${dir}/streams`)
    writeFileSync(`${dir}/fit/1.zip`, 'a'); writeFileSync(`${dir}/fit/2.zip`, 'b'); writeFileSync(`${dir}/streams/2.json.gz`, 'c')
    await uploadFiles(dir, r2)
    const puts = seen.filter((r) => r.method === 'PUT')
    expect(puts.map((r) => new URL(r.url).pathname)).toEqual(['/bkt/fit/2.zip', '/bkt/streams/2.json.gz'])
    expect(new URL(puts[0].url).host).toBe('acc.r2.cloudflarestorage.com')
    expect(puts[0].headers.get('authorization')).toMatch(/^AWS4-HMAC-SHA256 Credential=AK\/\d{8}\/auto\/s3\/aws4_request/)
    expect(puts[0].headers.get('x-amz-date')).toBeTruthy()
  })
})

describe('metric endpoints', () => {
  const paths = ['/api/today', '/api/load', '/api/recovery', '/api/intensity', '/api/goals']
  it('require Access and answer on an empty database', async () => {
    const { app, env } = mk()
    for (const p of paths) {
      expect((await req(app, env, p)).status).toBe(401)
      expect((await req(app, env, p, 'GET', await tok())).status).toBe(200)
    }
  })
  it('serve precomputed rows after a recompute', async () => {
    const { app, env, l } = mk()
    const d = (n: number) => new Date(Date.parse('2030-05-31T00:00:00Z') - n * 864e5).toISOString().slice(0, 10)
    await l.batch([["INSERT INTO hr_zones (effective_date,sport,lthr,max_hr,rest_hr,z1,z2,z3,z4,z5) VALUES ('2030-01-01','RUNNING',170,190,50,100,120,140,160,175)"],
      ...Array.from({ length: 60 }, (_, i): [string, unknown[]] => ['INSERT INTO activities (id,start_local,type,distance_m,duration_s,avg_hr,hr_z1_s,hr_z4_s) VALUES (?,?,?,?,?,?,?,?)', [i + 1, `${d(i)} 07:00:00`, 'running', 8000, 2700, 150, 1800, 900]]),
      ...Array.from({ length: 60 }, (_, i): [string, unknown[]] => ['INSERT INTO daily_summary (date,steps,rhr) VALUES (?,?,?)', [d(i), 9000, 50]])])
    await recompute(l, d(0), true)
    const t = await tok(), get = async (p: string) => (await req(app, env, p, 'GET', t)).json() as Promise<any>
    const today = await get('/api/today')
    expect(today.data_date).toBe(d(0)); expect(today.status.label).toBeTruthy(); expect(today.last_activity.load).toBeGreaterThan(0)
    expect(today.readiness.components.length).toBe(6); expect(today.goals.steps.goal).toBe(10000)
    expect(today.status.reason).toBeTruthy(); expect(today.this_week.days.length).toBe(7)
    const load = await get('/api/load?days=30')
    expect(load.days.length).toBe(30); expect(load.projection.rest.length).toBe(21); expect(Object.keys(load.per_sport)).toContain('run')
    expect((await get('/api/intensity')).share_28d.all.hard).toBeCloseTo(0.333, 2)
    expect((await get('/api/goals')).progress.year.target_km).toBe(2000)
    expect((await get('/api/recovery?days=10')).days.length).toBeGreaterThan(0)
  })
})

describe('PUT /api/goals', () => {
  const put = async (m: ReturnType<typeof mk>, body: unknown, ct = 'application/json', t?: string) =>
    m.app.request('/api/goals', { method: 'PUT', headers: { 'content-type': ct, ...(t ? { 'Cf-Access-Jwt-Assertion': t } : {}) }, body: typeof body === 'string' ? body : JSON.stringify(body) }, m.env)
  const ok = { year_km: 1800, band_lo: 40, band_hi: 55, steps: 9000 }
  it('needs Access, validates, and updates the three active goals', async () => {
    const m = mk(), t = await tok()
    expect((await put(m, ok)).status).toBe(401)
    for (const b of [{ ...ok, year_km: 100 }, { ...ok, steps: '9000' }, { ...ok, band_hi: 40 }, { ...ok, band_lo: NaN }, { year_km: 1800 }, 'nope']) expect((await put(m, b, 'application/json', t)).status).toBe(400)
    expect((await put(m, ok, 'text/plain', t)).status).toBe(400)
    expect((await m.l.all('SELECT target_value FROM goals ORDER BY id', [])).map((r: any) => r.target_value)).toEqual([2000, 50, 10000])
    expect((await put(m, ok, 'application/json', t)).status).toBe(200)
    expect(await m.l.all('SELECT kind, target_value v, target_max mx FROM goals ORDER BY id', [])).toEqual([{ kind: 'distance', v: 1800, mx: null }, { kind: 'weekly_km', v: 40, mx: 55 }, { kind: 'steps', v: 9000, mx: null }])
  })
})

describe('steps endpoint', () => {
  it('fills gaps with null, reads the goal and streak, needs Access', async () => {
    const m = mk(), get = async (p: string) => req(m.app, m.env, p, 'GET', await tok())
    expect((await req(m.app, m.env, '/api/steps')).status).toBe(401)
    expect(await (await get('/api/steps')).json()).toMatchObject({ goal: 10000, days: [], summary: null })
    await m.l.batch([...[['2030-05-29', 12000], ['2030-05-30', 4000], ['2030-06-01', 10500]].map(([d, n]): [string, unknown[]] => ['INSERT INTO daily_summary (date,steps) VALUES (?,?)', [d, n]]),
      ["INSERT INTO metric_daily (date,key,value,json) VALUES ('2030-06-01','goals',NULL,'{\"steps\":{\"goal\":10000,\"streak_days\":1}}')"]])
    const j = (await (await get('/api/steps?days=4')).json()) as any
    expect(j.days).toEqual([{ date: '2030-05-29', steps: 12000 }, { date: '2030-05-30', steps: 4000 }, { date: '2030-05-31', steps: null }, { date: '2030-06-01', steps: 10500 }])
    expect(j.summary.streak_days).toBe(1)
  })
})

describe('records and fitness endpoints', () => {
  const get = async (p: string, t: ReturnType<typeof mk>) => (await req(t.app, t.env, p, 'GET', await tok())).json() as Promise<any>
  it('empty with available:false before the stage has run or the migration is applied', async () => {
    const m = mk()
    expect(await get('/api/fitness-estimates', m)).toMatchObject({ available: false })
    expect(await get('/api/records', m)).toMatchObject({ available: false, n_runs: 0 })
    await m.l.batch([['DROP TABLE best_efforts'], ['DROP TABLE activity_efforts']])
    expect(await get('/api/records', m)).toMatchObject({ available: false })
    expect((await req(m.app, m.env, '/api/records')).status).toBe(401)
  })
  it('serves stored best efforts, PB timeline, predictions and VO2 history', async () => {
    const m = mk()
    const runs = [[1, '2030-05-10', 1300], [2, '2030-05-15', 1250], [3, '2030-05-20', 1270]], ins = (id: number, l: string, v: number, n: number | null): [string, unknown[]] => ['INSERT INTO activity_efforts (activity_id,label,value,n) VALUES (?,?,?,?)', [id, l, v, n]]
    await m.l.batch([["INSERT INTO hr_zones (effective_date,sport,lthr,max_hr,rest_hr,z1,z2,z3,z4,z5) VALUES ('2030-01-01','RUNNING',170,190,50,100,120,140,160,175)"],
      ...runs.flatMap(([id, d, t]): [string, unknown[]][] => [['INSERT INTO activities (id,start_local,type,fit_status) VALUES (?,?,?,?)', [id, `${d} 07:00:00`, 'running', 'ok']],
        ins(id as number, 'done', 1, null), ins(id as number, '5k', t as number, null), ins(id as number, 'ss_hr', 150, 3), ins(id as number, 'ss_v', 3, 3),
        ...[180, 360, 720, 1200].map((T) => ins(id as number, `t${T}`, 3.8 * T + 200 - (id as number) * 5, null))])])
    await recordsStage(m.l, '2030-06-01', tmpdir())
    const r = await get('/api/records', m)
    expect(r).toMatchObject({ available: true, n_runs: 3 })
    const k = r.records.find((x: any) => x.label === '5k')
    expect(k.best.map((b: any) => [b.rank, b.value])).toEqual([[1, 1250], [2, 1270], [3, 1300]]); expect(k.timeline.map((b: any) => b.value)).toEqual([1300, 1250])
    expect(r.ranges.l12['5k']).toMatchObject({ value: 1250, date: '2030-05-15', activity_id: 2 }); expect(r.rides).toBeNull(); expect(r.longest).toBeNull()
    expect(r.records.some((x: any) => x.label === 'p60')).toBe(false)
    const f = await get('/api/fitness-estimates?riegel=1.08', m)
    expect(f).toMatchObject({ available: true, riegel: 1.08, cs: { ok: true, n: 4 }, vo2: { n: 3 } }); expect(f.vo2.value).toBeGreaterThan(40); expect(f.vo2.history).toHaveLength(26)
    const get_ = (l: string) => f.predictions.find((p: any) => p.label === l)
    expect(get_('10k').point_s).toBeGreaterThan(get_('5k').point_s); expect(get_('10k').lo_s).toBeLessThan(get_('10k').hi_s)
    expect(get_('marathon').point_s).toBeGreaterThan(get_('10k').point_s) // fitness model reaches beyond the source, more than 4.5x short of a marathon
    expect((await get('/api/fitness-estimates?riegel=9', m)).riegel).toBe(1.12)
  })
})

describe('mileage and activities', () => {
  const seed = async (l: ReturnType<typeof mk>['l']) => {
    const ins = (id: number, d: string, type: string, m: number, extra = 'ok'): [string, unknown[]] => ['INSERT INTO activities (id,start_local,type,name,distance_m,duration_s,elev_gain_m,fit_status) VALUES (?,?,?,?,?,?,?,?)', [id, `${d} 07:00:00`, type, `A${id}`, m, 3000, 10, extra]]
    await l.batch([ins(1, '2029-12-31', 'running', 5000), ins(2, '2030-01-01', 'running', 10000), ins(3, '2030-01-02', 'cycling', 20000, 'none'), ins(4, '2030-05-27', 'running', 8000), ins(5, '2030-05-29', 'running', 4000), ins(6, '2030-05-30', 'strength_training', 0, 'none'),
      ["INSERT INTO goals (kind,title,target_value,unit,status,created_at) VALUES ('distance','Yearly',2000,'km','active',1)"],
      ["INSERT INTO activity_steps (activity_id,lap_idx,step_type,duration_s,distance_m) VALUES (4,0,'lap',600,2000)"]])
  }
  const get = async (p: string, t: { app: ReturnType<typeof mk>['app']; env: Env }) => (await req(t.app, t.env, p, 'GET', await tok())).json() as Promise<any>
  it('bars by week, month and year, filled and filtered', async () => {
    const m = mk(); await seed(m.l)
    const w = await get('/api/mileage?by=week&sport=run', m)
    expect(w.periods.length).toBe(52); expect(w.periods.at(-1)).toMatchObject({ key: '2030-05-27', km: 12, sessions: 2 }); expect(w.periods.at(-1).longest_km).toBeGreaterThan(0)
    const mo = await get('/api/mileage?by=month', m)
    expect(mo.periods.length).toBe(24); expect(mo.periods.find((p: any) => p.key === '2030-01').km).toBe(30)
    const y = await get('/api/mileage?by=year&sport=run', m)
    expect(y.periods.map((p: any) => [p.key, p.km])).toEqual([['2029', 5], ['2030', 22]])
    expect((await get('/api/mileage?by=year&sport=bike', m)).periods.at(-1).km).toBe(20)
  })
  it('compare: cumulative per year equals the sum, rolling windows, goal only for runs', async () => {
    const m = mk(); await seed(m.l)
    const c = await get('/api/mileage/compare?sport=run', m)
    expect(c.years.map((y: any) => y.year)).toEqual([2029, 2030]); expect(c.goal_km).toBe(2000)
    expect(c.years[1].total_km).toBe(22); expect(c.years[1].points.at(-1)).toEqual([149, 22]); expect(c.years[1].points[0]).toEqual([1, 10])
    expect(c.rolling.dates.at(-1)).toBe(c.today); expect(c.rolling.km30.at(-1)).toBe(12); expect(c.rolling.km365.at(-1)).toBeNull()
    expect((await get('/api/mileage/compare', m)).goal_km).toBeNull()
    expect((await get('/api/mileage/compare', makeEmpty())).years).toEqual([])
  })
  const makeEmpty = () => mk()
  it('activity list pages with before and filters by sport', async () => {
    const m = mk(); await seed(m.l)
    const p1 = await get('/api/activities?limit=2', m)
    expect(p1.activities.map((a: any) => a.id)).toEqual([6, 5]); expect(p1.activities[0].sport).toBe('strength'); expect(p1.next_before).toBe('2030-05-29 07:00:00')
    const p2 = await get(`/api/activities?limit=10&before=${encodeURIComponent(p1.next_before)}`, m)
    expect(p2.activities.map((a: any) => a.id)).toEqual([4, 3, 2, 1]); expect(p2.next_before).toBeNull()
    expect((await get('/api/activities?sport=bike', m)).activities.map((a: any) => a.id)).toEqual([3])
  })
  it('activity detail: summary and laps, R2 detail only when the file is ok', async () => {
    const m = mk(); await seed(m.l)
    const asked: string[] = []
    m.env.FIT = { get: async (k: string) => { asked.push(k); return { json: async () => ({ n: 3, hr: [1, 2, 3] }), body: new Response('').body! } } }
    const a = await get('/api/activities/4', m)
    expect(a.activity).toMatchObject({ id: 4, sport: 'run' }); expect(a.laps.length).toBe(1); expect(a.detail).toEqual({ n: 3, hr: [1, 2, 3] }); expect(asked).toEqual(['detail/4.json'])
    expect((await get('/api/activities/3', m)).detail).toBeNull()
    delete m.env.FIT; expect((await get('/api/activities/4', m)).detail).toBeNull()
    expect((await req(m.app, m.env, '/api/activities/99', 'GET', await tok())).status).toBe(404)
    expect((await req(m.app, m.env, '/api/activities/x', 'GET', await tok())).status).toBe(404)
  })
  it('routes: streams routes/all.json from R2, empty list without it, needs Access', async () => {
    const m = mk(), file = '{"v":1,"runs":[[1,"2030-05-31",5000,1500,[1,2],[1,2,1.1,2.1]]]}'
    expect((await req(m.app, m.env, '/api/routes')).status).toBe(401)
    expect(await get('/api/routes', m)).toEqual({ v: 1, runs: [] })
    const asked: string[] = []
    m.env.FIT = { get: async (k: string) => { asked.push(k); return k === 'routes/all.json' ? { json: async () => JSON.parse(file), body: new Response(file).body! } : null } }
    expect(await get('/api/routes', m)).toEqual(JSON.parse(file)); expect(asked).toEqual(['routes/all.json'])
  })
  it('dynamics: weekly means over runs that have the metric, with n', async () => {
    const m = mk(); await seed(m.l)
    await m.l.batch([
      ['UPDATE activities SET avg_gct_ms=240, avg_stride_m=1.2, avg_cadence=170 WHERE id=4'], ['UPDATE activities SET avg_gct_ms=260 WHERE id=5'],
      ['UPDATE activities SET avg_gct_ms=999 WHERE id=3'], // bike, ignored
    ])
    const d = await get('/api/dynamics?weeks=4', m)
    expect(d.weeks.length).toBe(4); expect(d.weeks.at(-1)).toMatchObject({ week_start: '2030-05-27', gct_ms: { avg: 250, n: 2 }, stride_m: { avg: 1.2, n: 1 }, cadence: { avg: 170, n: 1 }, vert_osc_mm: null })
    expect(d.weeks[0].gct_ms).toBeNull()
    const a = await get('/api/activities/4', m)
    expect(a.activity).toMatchObject({ avg_gct_ms: 240, avg_vert_ratio: null }); expect(a.laps[0]).toHaveProperty('avg_gct_ms')
    expect((await get('/api/dynamics', makeEmpty())).weeks.length).toBe(26)
    const c = await get('/api/correlations', makeEmpty())
    expect(c.pairs.length).toBe(5); expect(c.pairs.every((p: any) => p.status === 'not_enough_data')).toBe(true)
  })
  it('require Access', async () => {
    const m = mk()
    for (const p of ['/api/mileage', '/api/mileage/compare', '/api/activities', '/api/activities/1', '/api/dynamics']) expect((await req(m.app, m.env, p)).status).toBe(401)
  })
})

describe('static assets', () => {
  it('checks Access on non-API paths, then falls through to assets', async () => {
    const { app, env } = mk()
    const seen: string[] = []
    const e = { ...env, ASSETS: { fetch: async (r: Request) => (seen.push(new URL(r.url).pathname), new Response('<html>app</html>')) } } as Env
    expect((await req(app, e, '/')).status).toBe(401)
    expect((await req(app, e, '/today/deep')).status).toBe(401)
    expect(seen).toEqual([])
    const ok = await req(app, e, '/today/deep', 'GET', await tok())
    expect(await ok.text()).toBe('<html>app</html>')
    expect(seen).toEqual(['/today/deep'])
    expect((await req(app, e, '/api/nope', 'GET', await tok())).status).toBe(404)
    expect(seen).toHaveLength(1)
  })
})

describe('shoes', () => {
  const send = async (m: ReturnType<typeof mk>, path: string, method: string, body?: unknown, t?: string, ct = 'application/json') =>
    m.app.request(path, { method, headers: { 'content-type': ct, ...(t ? { 'Cf-Access-Jwt-Assertion': t } : {}) }, body: typeof body === 'string' ? body : JSON.stringify(body) }, m.env)
  const run = (m: ReturnType<typeof mk>, id: number, date: string, dist: number, type = 'running', shoe: number | null = null) =>
    m.l.batch([['INSERT INTO activities (id,start_local,type,distance_m) VALUES (?,?,?,?)', [id, `${date} 07:00:00`, type, dist]], ...(shoe ? [['UPDATE activities SET shoe_id=? WHERE id=?', [shoe, id]] as [string, unknown[]]] : [])])
  const list = async (m: ReturnType<typeof mk>) => ((await (await req(m.app, m.env, '/api/shoes', 'GET', await tok())).json()) as any).shoes

  it('writes need Access and a JSON body; fields are validated', async () => {
    const m = mk(), t = await tok()
    expect((await send(m, '/api/shoes', 'POST', { name: 'Test Shoe' })).status).toBe(401)
    expect((await req(m.app, m.env, '/api/shoes')).status).toBe(401)
    for (const b of [{}, { name: '' }, { name: ' ' }, { name: 'x'.repeat(61) }, { name: 'A', start_km: -1 }, { name: 'A', retire_km: 50 }, { name: 'A', retire_km: '800' }, { name: 'A', default_for: 'bike' },
      { name: 'A', since: '2030-13-45' }, { name: 'A', retired_on: '2030-06-01', default_for: 'run' }, { name: 'A', id: 5 }, [], 'nope']) expect((await send(m, '/api/shoes', 'POST', b, t)).status, JSON.stringify(b)).toBe(400)
    expect((await send(m, '/api/shoes', 'POST', { name: 'A' }, t, 'text/plain')).status).toBe(400)
    expect(await list(m)).toEqual([])
    const r = await send(m, '/api/shoes', 'POST', { name: ' Daily Test ', brand: 'Acme', start_km: 120.5 }, t)
    expect(r.status).toBe(201); const { id } = (await r.json()) as any
    expect(await list(m)).toMatchObject([{ id, name: 'Daily Test', brand: 'Acme', start_km: 120.5, retire_km: 800, default_for: null, retired_on: null, since: '2030-06-01', km: 120.5, runs: 0, alert: null }])
    for (const b of [{}, { name: '' }, { retire_km: 5000 }, { nope: 1 }, { retired_on: '2030-06-01', default_for: 'run' }]) expect((await send(m, `/api/shoes/${id}`, 'PATCH', b, t)).status, JSON.stringify(b)).toBe(400)
    expect((await send(m, '/api/shoes/999', 'PATCH', { name: 'B' }, t)).status).toBe(404)
    expect((await send(m, `/api/shoes/${id}`, 'PATCH', { name: 'B' })).status).toBe(401)
  })

  it('mileage is start_km plus assigned activities, the alert follows retire_km, only one default', async () => {
    const m = mk(), t = await tok()
    const a = ((await (await send(m, '/api/shoes', 'POST', { name: 'One', start_km: 100, retire_km: 200, default_for: 'run' }, t)).json()) as any).id
    const b = ((await (await send(m, '/api/shoes', 'POST', { name: 'Two', default_for: 'run' }, t)).json()) as any).id
    expect((await list(m)).map((s: any) => [s.name, s.default_for])).toEqual([['One', null], ['Two', 'run']]) // the newer default took the role
    await run(m, 1, '2030-05-01', 40000, 'running', a); await run(m, 2, '2030-05-02', 40400, 'running', a); await run(m, 3, '2030-05-03', 10000, 'running', b); await run(m, 4, '2030-05-04', 5000)
    let s = await list(m)
    expect(s[0]).toMatchObject({ name: 'One', km: 180.4, runs: 2, last_run: '2030-05-02', alert: 'soon' }); expect(s[1]).toMatchObject({ name: 'Two', km: 10, runs: 1, alert: null })
    await run(m, 5, '2030-05-05', 20000, 'running', a)
    expect((await list(m))[0]).toMatchObject({ km: 200.4, alert: 'over' })
    // retiring clears the default, drops the alert and sorts the shoe last
    expect((await send(m, `/api/shoes/${a}`, 'PATCH', { retired_on: '2030-05-06' }, t)).status).toBe(200)
    s = await list(m)
    expect(s.map((x: any) => [x.name, x.retired_on, x.alert])).toEqual([['Two', null, null], ['One', '2030-05-06', null]])
    expect((await send(m, `/api/shoes/${a}`, 'PATCH', { default_for: 'run' }, t)).status).toBe(400)
    expect((await send(m, `/api/shoes/${a}`, 'PATCH', { retired_on: null, default_for: 'run' }, t)).status).toBe(200)
    expect((await list(m)).map((x: any) => [x.name, x.default_for])).toEqual([['One', 'run'], ['Two', null]])
  })

  it('PATCH /api/activities/:id sets the shoe, the detail returns it', async () => {
    const m = mk(), t = await tok()
    const id = ((await (await send(m, '/api/shoes', 'POST', { name: 'One' }, t)).json()) as any).id
    await run(m, 7, '2030-05-07', 5000)
    const patch = (aid: string | number, b: unknown, tok?: string) => send(m, `/api/activities/${aid}`, 'PATCH', b, tok)
    expect((await patch(7, { shoe_id: id })).status).toBe(401)
    for (const b of [{}, { shoe_id: 'x' }, { shoe_id: 1.5 }, { shoe_id: id, name: 'x' }, { name: 'x' }, { shoe_id: 99 }]) expect((await patch(7, b, t)).status, JSON.stringify(b)).toBe(400)
    expect((await patch(8, { shoe_id: id }, t)).status).toBe(404); expect((await patch('x', { shoe_id: id }, t)).status).toBe(404)
    expect((await patch(7, { shoe_id: id }, t)).status).toBe(200)
    expect(((await (await req(m.app, m.env, '/api/activities/7', 'GET', t)).json()) as any).activity.shoe_id).toBe(id)
    expect((await list(m))[0]).toMatchObject({ km: 5, runs: 1 })
    expect((await patch(7, { shoe_id: null }, t)).status).toBe(200)
    expect((await list(m))[0]).toMatchObject({ km: 0, runs: 0 })
  })

  it('the sync assigns the default shoe to runs without one from its start date, never overrides', async () => {
    const m = mk(), t = await tok()
    const a = ((await (await send(m, '/api/shoes', 'POST', { name: 'One', since: '2030-05-10' }, t)).json()) as any).id
    const b = ((await (await send(m, '/api/shoes', 'POST', { name: 'Two', default_for: 'run', since: '2030-05-10' }, t)).json()) as any).id
    await run(m, 1, '2030-05-09', 5000); await run(m, 2, '2030-05-10', 5000); await run(m, 3, '2030-05-11', 5000, 'running', a); await run(m, 4, '2030-05-12', 5000, 'road_biking'); await run(m, 5, '2030-05-13', 5000)
    await assignShoes(m.l)
    expect(await m.l.all('SELECT id, shoe_id FROM activities ORDER BY id')).toEqual([{ id: 1, shoe_id: null }, { id: 2, shoe_id: b }, { id: 3, shoe_id: a }, { id: 4, shoe_id: null }, { id: 5, shoe_id: b }])
    await send(m, `/api/shoes/${b}`, 'PATCH', { retired_on: '2030-05-14' }, t); await run(m, 6, '2030-05-15', 5000)
    await assignShoes(m.l)
    expect((await m.l.all<any>('SELECT shoe_id FROM activities WHERE id=6'))[0].shoe_id).toBeNull() // retired shoes get nothing new
  })

  it('upload leaves shoes and shoe assignments alone', async () => {
    const local = new LocalStore(':memory:'); local.migrate('migrations')
    const remote = new LocalStore(':memory:'); remote.migrate('migrations')
    await remote.batch([["INSERT INTO shoes (id,name,since) VALUES (1,'Remote One','2030-01-01')"], ["INSERT INTO activities (id,start_local,type,shoe_id) VALUES (1,'2030-01-02 07:00:00','running',1)"]])
    await local.batch([["INSERT INTO activities (id,start_local,type,distance_m) VALUES (1,'2030-01-02 07:00:00','running',5000)"]])
    await uploadDb(local, remote)
    expect(await remote.all('SELECT id, distance_m, shoe_id FROM activities')).toEqual([{ id: 1, distance_m: 5000, shoe_id: 1 }])
    expect((await remote.all('SELECT name FROM shoes')).length).toBe(1)
  })
})
