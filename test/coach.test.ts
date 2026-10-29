import { beforeEach, describe, expect, it } from 'vitest'
import { exportJWK, generateKeyPair, SignJWT } from './jwt.js'
import { createApp, type Env } from '../src/worker/index.js'
import { resetJwksCache } from '../src/worker/access.js'
import { LocalStore } from '../sync/store.js'
import { recompute } from '../sync/recompute.js'
import { TOOLS, callTool } from '../src/tools.js'
import { MAX_ROUNDS, REGEN_LIMIT, briefing, chat, dailySummary, explain } from '../src/coach.js'

const TEAM = 'team.example.cloudflareaccess.com', AUD = 'aud-123', NOW = Date.parse('2030-05-31T12:00:00Z')
const kp = await generateKeyPair(), jwk = { ...(await exportJWK(kp.publicKey)), kid: 'k1' }
const tok = () => SignJWT({ aud: [AUD], iss: `https://${TEAM}`, exp: NOW / 1000 + 600 }, kp.privateKey, 'k1')
const d = (n: number) => new Date(NOW - n * 864e5).toISOString().slice(0, 10)

let sent: { url: string; body: any; headers: any }[], replies: any[]
const say = (text: string, usage = { input_tokens: 1000, output_tokens: 100 }) => ({ content: [{ type: 'text', text }], stop_reason: 'end_turn', usage })
const use = (name: string, input: object = {}) => ({ content: [{ type: 'tool_use', id: 'tu' + sent.length, name, input }], stop_reason: 'tool_use', usage: { input_tokens: 1000, output_tokens: 50 } })
const fakeFetch = (async (u: any, init: any = {}) => {
  const url = String(u?.url ?? u)
  if (url.includes('/cdn-cgi/access/certs')) return Response.json({ keys: [jwk] })
  if (url.startsWith('https://api.anthropic.com/')) { sent.push({ url, body: JSON.parse(init.body), headers: init.headers }); const r = replies.shift(); return r ? Response.json(r) : new Response('{}', { status: 500 }) }
  return new Response('', { status: 404 })
}) as typeof fetch

async function mk(extra: Partial<Env> = { ANTHROPIC_API_KEY: 'test-key' }) {
  const l = new LocalStore(':memory:'); l.migrate('migrations')
  const db: Env['DB'] = { prepare: (sql: string) => ({ bind: (...a: unknown[]) => ({ all: async <T>() => ({ results: (await l.all(sql, a)) as T[] }), run: async () => { await l.batch([[sql, a]]) } }) }) }
  await l.batch([["INSERT INTO hr_zones (effective_date,sport,lthr,max_hr,rest_hr,z1,z2,z3,z4,z5) VALUES ('2030-01-01','RUNNING',170,190,50,100,120,140,160,175)"],
    ...Array.from({ length: 60 }, (_, i): [string, unknown[]] => ['INSERT INTO activities (id,start_local,type,name,distance_m,duration_s,avg_hr,hr_z1_s,hr_z4_s) VALUES (?,?,?,?,?,?,?,?,?)', [i + 1, `${d(i)} 07:00:00`, 'running', `Run ${i}`, 8000, 2700, 150, 1800, 900]]),
    ['INSERT INTO activities (id,start_local,type,name,duration_s) VALUES (100,?,?,?,?)', [`${d(0)} 18:00:00`, 'strength_training', 'Gym', 3000]],
    ...Array.from({ length: 60 }, (_, i): [string, unknown[]] => ['INSERT INTO daily_summary (date,steps,rhr) VALUES (?,?,?)', [d(i), 9000, 50]])])
  await recompute(l, d(0), true)
  const env = { DB: db, ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, GITHUB_REPO: 'o/r', GITHUB_DISPATCH_TOKEN: 'x', ...extra } as Env
  return { l, db, env, app: createApp({ fetch: fakeFetch, now: () => NOW }) }
}
const api = async (m: Awaited<ReturnType<typeof mk>>, path: string, method = 'GET', body?: unknown) =>
  m.app.request(path, { method, headers: { 'Cf-Access-Jwt-Assertion': await tok(), ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined }, m.env)
const run = async (m: Awaited<ReturnType<typeof mk>>, message: string) => {
  const events: [string, any][] = []
  await chat({ db: m.db, env: m.env, fetch: fakeFetch, now: NOW, message, emit: (e, data) => { events.push([e, data]) } })
  return events
}

beforeEach(() => { sent = []; replies = []; resetJwksCache() })

describe('tool registry', () => {
  it('is the contract: names and schemas do not change by accident', () => {
    expect(TOOLS.map((t) => ({ name: t.name, write: !!t.write, schema: t.input_schema }))).toMatchSnapshot()
    expect(new Set(TOOLS.map((t) => t.name)).size).toBe(TOOLS.length)
    expect(TOOLS.filter((t) => t.write).map((t) => t.name)).toEqual(['add_note', 'resolve_note', 'set_planned', 'set_rpe', 'set_goal', 'update_goal'])
  })
  it('every tool answers on the seeded database with as_of and n or confidence', async () => {
    const m = await mk()
    const sample: Record<string, object> = { get_activity: { id: 1 }, get_series: { keys: ['ctl', 'tsb', 'run_km', 'steps'], agg: 'week' }, resolve_note: { id: 1 }, add_note: { kind: 'injury', text: 'left knee sore' },
      set_planned: { date: d(-1), load: 0, label: 'rest' }, set_rpe: { date: d(0), type: 'strength', rpe: 7 }, set_goal: { kind: 'custom', title: 'Be fit' }, update_goal: { id: 1, status: 'done' } }
    for (const t of TOOLS) {
      const r: any = await callTool(m.db, t.name, sample[t.name] ?? {}, NOW)
      expect(r.error, t.name).toBeUndefined()
      expect(r.as_of, t.name).toBe(new Date(NOW).toISOString())
      expect('n' in r || 'confidence' in r || 'available' in r, t.name).toBe(true)
    }
  })
  it('reads real numbers and rejects bad input', async () => {
    const m = await mk(), o: any = await callTool(m.db, 'get_overview', {}, NOW)
    expect(o.status.label).toBeTruthy(); expect(o.data_age_days).toBe(0)
    expect(o.garmin_key).toMatchObject({ expires_on: null, days_left: null }); expect(o).toHaveProperty('last_sync_ok', null)
    const k: any = await callTool(m.db, 'get_overview', {}, NOW, { GARMIN_KEY_EXPIRES: '2030-06-20' })
    expect(k.garmin_key).toMatchObject({ expires_on: '2030-06-20', days_left: 20, banner: true })
    const c: any = await callTool(m.db, 'get_correlations', {}, NOW)
    expect(c).toMatchObject({ available: true, tested: 5, min_n: 30 }); expect(c.pairs.length).toBe(5)
    expect(c.pairs.find((p: any) => p.x === 'sleep_total_s' && p.y === 'hrv')).toMatchObject({ status: 'not_enough_data', n: 0 })
    expect((await callTool(m.db, 'get_correlations', { x: 'load' }, NOW) as any).pairs.length).toBe(2)
    const s: any = await callTool(m.db, 'get_series', { keys: ['ctl'], from: d(9), to: d(0) }, NOW)
    expect(s.series.ctl.length).toBe(10)
    const p: any = await callTool(m.db, 'project_load', { days: 7, planned: [{ date: d(-1), load: 0 }] }, NOW)
    expect(p.days.length).toBe(7)
    expect((await callTool(m.db, 'set_planned', { date: d(5), load: 0 }, NOW) as any).error).toBeTruthy() // in the past
    expect((await callTool(m.db, 'get_series', { keys: ['nope'] }, NOW) as any).error).toBeTruthy()
    expect((await callTool(m.db, 'nope', {}, NOW) as any).error).toBeTruthy()
    expect((await callTool(m.db, 'set_rpe', { rpe: 11, activity_id: 1 }, NOW) as any).error).toBeTruthy()
  })
  it('set_rpe stores the effort on the latest matching activity and names it', async () => {
    const m = await mk(), r: any = await callTool(m.db, 'set_rpe', { date: d(0), type: 'strength', rpe: 7 }, NOW)
    expect(r.updated).toMatchObject({ id: 100, name: 'Gym', rpe: 7 })
    expect((await m.l.all<any>('SELECT rpe FROM activities WHERE id=100'))[0].rpe).toBe(7)
  })
})

describe('briefing', () => {
  it('stays small, has the sections, and warns when there is no goal', async () => {
    const m = await mk()
    await m.l.batch([["UPDATE goals SET status='dropped'"]])
    const b: any = await briefing(m.db, NOW), s = JSON.stringify(b)
    expect(s.length).toBeLessThan(6000)
    expect(b.last_7_days.length).toBeGreaterThan(0); expect(b.status.label).toBeTruthy()
    expect(b.warnings.join()).toMatch(/No active goal/)
  })
  it('a saved note and planned rest day show up in the next briefing', async () => {
    const m = await mk()
    await callTool(m.db, 'add_note', { kind: 'injury', text: 'left knee sore' }, NOW)
    await callTool(m.db, 'set_planned', { date: d(-1), load: 0, label: 'rest day' }, NOW)
    const b: any = await briefing(m.db, NOW)
    expect(b.notes.map((n: any) => n.text)).toEqual(['left knee sore'])
    expect(b.planned_next_7_days).toEqual([{ date: d(-1), load: 0, label: 'rest day' }])
    await callTool(m.db, 'resolve_note', { id: b.notes[0].id }, NOW)
    expect(((await briefing(m.db, NOW)) as any).notes).toEqual([])
  })
})

describe('coach loop', () => {
  it('runs tools, sends the cached prefix and records usage', async () => {
    const m = await mk()
    replies = [use('get_overview'), say('## Signals\nAll fine.')]
    const ev = await run(m, 'Should I run tomorrow?')
    expect(ev.map((e) => e[0])).toEqual(['tool', 'text', 'done'])
    expect(sent.length).toBe(2)
    const b = sent[0].body
    expect(sent[0].url).toBe('https://api.anthropic.com/v1/messages'); expect(sent[0].headers['x-api-key']).toBe('test-key'); expect(sent[0].headers['anthropic-version']).toBe('2023-06-01')
    expect(b.model).toBe('claude-haiku-4-5-20251001'); expect(b.max_tokens).toBe(1000)
    expect(b.system[0].cache_control).toEqual({ type: 'ephemeral' }); expect(b.tools.at(-1).cache_control).toEqual({ type: 'ephemeral' }); expect(b.tools.length).toBe(TOOLS.length)
    expect(JSON.stringify(b.messages[0].content)).toContain('Briefing'); expect(b.system[0].text).toMatch(/## Signals[\s\S]*## Risks[\s\S]*## Recommendation[\s\S]*## Why not[\s\S]*## Question/)
    expect(sent[1].body.messages.at(-1).content[0].type).toBe('tool_result')
    const u: any = await (await api(m, '/api/coach/usage')).json()
    expect(u.calls).toBe(2); expect(u.input_tokens).toBe(2000); expect(u.usd).toBeCloseTo((2000 * 1 + 150 * 5) / 1e6, 3)
    expect((await m.l.all<any>('SELECT role FROM coach_messages ORDER BY id')).map((r) => r.role)).toEqual(['user', 'assistant'])
  })
  it('stops after the maximum number of rounds', async () => {
    const m = await mk()
    replies = Array.from({ length: 10 }, () => use('get_goals'))
    const ev = await run(m, 'loop')
    expect(sent.length).toBe(MAX_ROUNDS); expect(MAX_ROUNDS).toBe(6)
    expect(ev.at(-1)![0]).toBe('done')
  })
  it('keeps only the last 12 messages of history', async () => {
    const m = await mk()
    await m.l.batch(Array.from({ length: 20 }, (_, i): [string, unknown[]] => ['INSERT INTO coach_messages (created_at, role, content) VALUES (?,?,?)', [i, i % 2 ? 'assistant' : 'user', `m${i}`]]))
    replies = [say('ok')]; await run(m, 'hi')
    expect(sent[0].body.messages.length).toBe(13)
    expect(sent[0].body.messages[0].content).toBe('m8')
  })
  it('does not call the API once the monthly cap is reached', async () => {
    const m = await mk({ ANTHROPIC_API_KEY: 'k', COACH_MONTHLY_USD_CAP: '0.01' })
    await m.l.batch([["INSERT INTO coach_usage (month, usd) VALUES ('2030-05', 0.5)"]])
    const ev = await run(m, 'hello')
    expect(sent.length).toBe(0); expect(ev[0][1].text).toMatch(/budget is used up/); expect(ev.at(-1)).toEqual(['done', { capped: true }])
  })
  it('reports an upstream failure without leaking the key', async () => {
    const m = await mk(); const ev = await run(m, 'hello')
    expect(ev).toEqual([['error', { message: 'The coach could not be reached (status 500).' }]])
  })
})

describe('routes', () => {
  it('without a key: coach_enabled false, /api/coach/* is 501, notes API too, explain falls back to the template', async () => {
    const m = await mk({})
    expect(await (await api(m, '/api/config')).json()).toEqual({ coach_enabled: false })
    for (const [p, method] of [['/api/coach/briefing', 'GET'], ['/api/coach/usage', 'GET'], ['/api/coach/notes', 'GET'], ['/api/coach/chat', 'POST']]) expect((await api(m, p, method, method === 'POST' ? { message: 'x' } : undefined)).status, p).toBe(501)
    const e: any = await (await api(m, '/api/explain', 'POST', { metric: 'status:today', date: d(0), template: 'Fixed text.' })).json()
    expect(e).toEqual({ text: 'Fixed text.', source: 'template' }); expect(sent.length).toBe(0)
    expect((await api(m, '/api/status')).status).toBe(200) // the rest of the app is unaffected
  })
  it('with a key: config, briefing, SSE chat', async () => {
    const m = await mk()
    expect(await (await api(m, '/api/config')).json()).toEqual({ coach_enabled: true })
    expect(((await (await api(m, '/api/coach/briefing')).json()) as any).date).toBe(d(0))
    replies = [say('Rest tomorrow.')]
    const r = await api(m, '/api/coach/chat', 'POST', { message: 'plan?' })
    expect(r.headers.get('content-type')).toMatch(/text\/event-stream/)
    const t = await r.text()
    expect(t).toContain('event: text'); expect(t).toContain('"text":"Rest tomorrow."'); expect(t).toContain('event: done')
    expect((await api(m, '/api/coach/chat', 'POST', { message: '' })).status).toBe(400)
    expect(((await (await api(m, '/api/coach/messages')).json()) as any).messages.length).toBe(2)
  })
  it('notes CRUD', async () => {
    const m = await mk()
    expect((await api(m, '/api/coach/notes', 'POST', { kind: 'injury', text: '' })).status).toBe(400)
    const id = ((await (await api(m, '/api/coach/notes', 'POST', { kind: 'injury', text: 'sore knee' })).json()) as any).id
    expect(((await (await api(m, '/api/coach/notes')).json()) as any).notes).toMatchObject([{ id, kind: 'injury', text: 'sore knee' }])
    expect((await api(m, `/api/coach/notes/${id}`, 'PATCH', { text: 'knee better' })).status).toBe(200)
    expect((await api(m, `/api/coach/notes/${id}`, 'PATCH', { active: false })).status).toBe(200)
    expect(((await (await api(m, '/api/coach/notes')).json()) as any).notes).toEqual([])
    expect((await api(m, `/api/coach/notes/${id}`, 'DELETE')).status).toBe(200)
    expect((await api(m, `/api/coach/notes/${id}`, 'DELETE')).status).toBe(404)
  })
  it('explain: model text is cached by input, regenerate bypasses, cap falls back', async () => {
    const m = await mk(), body = { metric: 'status:today', date: d(0), template: 'Form is -5.' }
    replies = [say('Plain words.'), say('Other words.')]
    const post = async (b: object) => (await (await api(m, '/api/explain', 'POST', b)).json()) as any
    expect(await post(body)).toEqual({ text: 'Plain words.', source: 'llm' })
    expect(await post(body)).toEqual({ text: 'Plain words.', source: 'cache' }); expect(sent.length).toBe(1)
    expect((await post({ ...body, template: 'Form is -6.' })).source).toBe('llm') // inputs changed
    expect((await post({ ...body, template: 'Form is -6.', regenerate: true })).source).toBe('template') // no reply left: 500 -> fallback
    await m.l.batch([["INSERT INTO coach_usage (month, usd) VALUES ('2030-05', 99) ON CONFLICT(month) DO UPDATE SET usd=99"]])
    const n = sent.length
    expect(await post({ ...body, template: 'Form is -7.' })).toEqual({ text: 'Form is -7.', source: 'template' }); expect(sent.length).toBe(n)
    expect((await api(m, '/api/explain', 'POST', { metric: 'x' })).status).toBe(400)
    expect(await explain({ db: m.db, env: m.env, fetch: fakeFetch, now: NOW, metric: 'a', date: d(0), template: 't', regenerate: false })).toMatchObject({ source: 'template' })
  })
  it('explain: at most REGEN_LIMIT regenerates per metric per day, then the cached text with limited:true', async () => {
    const m = await mk(), body = { metric: 'status:today', date: d(0), template: 'Form is -5.' }
    replies = Array.from({ length: 10 }, (_, i) => say(`Text ${i}.`))
    const post = async (b: object) => (await (await api(m, '/api/explain', 'POST', b)).json()) as any
    await post(body)
    for (let i = 0; i < REGEN_LIMIT; i++) expect((await post({ ...body, regenerate: true })).source).toBe('llm')
    const n = sent.length, r = await post({ ...body, regenerate: true })
    expect(r).toEqual({ text: `Text ${REGEN_LIMIT}.`, source: 'cache', limited: true }); expect(sent.length).toBe(n)
    expect((await post({ ...body, metric: 'other', regenerate: true })).source).toBe('llm') // per metric
    expect(await post(body)).toEqual({ text: `Text ${REGEN_LIMIT}.`, source: 'cache' }) // plain reads are never limited
  })
  it('daily summary: one assistant message per day, off without the flag or key, respects the cap', async () => {
    const msgs = async (m: Awaited<ReturnType<typeof mk>>) => ((await (await api(m, '/api/coach/messages')).json()) as any).messages
    const m = await mk({ ANTHROPIC_API_KEY: 'k', COACH_DAILY: '1' }), go = (mm = m, now = NOW) => dailySummary({ db: mm.db, env: mm.env, fetch: fakeFetch, now })
    replies = [say('Good morning. Recovery looks fine.')]
    expect(await go(m, NOW - 8 * 36e5)).toBe('early'); expect(sent.length).toBe(0)
    expect(await go()).toBe('written'); expect(await go()).toBe('exists'); expect(sent.length).toBe(1)
    expect(sent[0].body.messages[0].content).toContain('"readiness"')
    expect(await msgs(m)).toEqual([{ role: 'assistant', content: 'Good morning. Recovery looks fine.' }])
    replies = [say('Next day.')]
    expect(await go(m, NOW + 864e5)).toBe('written')
    const off = await mk({ ANTHROPIC_API_KEY: 'k' }); expect(await go(off)).toBe('off')
    const nokey = await mk({ COACH_DAILY: '1' }); expect(await go(nokey)).toBe('off')
    const capped = await mk({ ANTHROPIC_API_KEY: 'k', COACH_DAILY: '1' })
    await capped.l.batch([["INSERT INTO coach_usage (month, usd) VALUES ('2030-05', 99)"]])
    expect(await go(capped)).toBe('capped'); expect(await msgs(capped)).toEqual([])
    replies = []; expect(await go(await mk({ ANTHROPIC_API_KEY: 'k', COACH_DAILY: '1' }))).toBe('error') // API failure writes nothing
  })
})
