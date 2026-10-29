// The coach: a deterministic briefing, a manual tool-use loop over the Anthropic Messages API (plain fetch, no SDK), a monthly spend cap,
// and the routes. Removing the coach = delete this file, its import in worker/index.ts and the Coach page; tools.ts and the dashboard do not depend on it.
import type { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import type { DB, Env } from './worker/index.js'
import { jsonBody } from './worker/api.js'
import { addDays } from './metrics/dates.js'
import { sportOf } from './metrics/load.js'
import { TOOLS, NOTE_KINDS, activeNotes, addNote, callTool, plannedFrom } from './tools.js'
import { goalsView, q, today } from './queries.js'

type Fetch = typeof fetch
type Deps = { fetch: Fetch; now: () => number }
type Block = { type: string; text?: string; id?: string; name?: string; input?: unknown; [k: string]: unknown }
type Msg = { role: 'user' | 'assistant'; content: string | unknown[] }

export const DEFAULT_MODEL = 'claude-haiku-4-5-20251001'
export const MAX_ROUNDS = 6, MAX_TOKENS = 1000, HISTORY = 12
// USD per million tokens for the default Haiku-class model. ponytail: one price table, a different COACH_MODEL needs these edited.
export const PRICE = { input: 1, output: 5, cache_write: 1.25, cache_read: 0.1 }
const iso = (now: number) => new Date(now).toISOString().slice(0, 10)

export const SYSTEM = `You are the training coach inside CoAchI, a personal dashboard for one runner.
Rules:
- Code computes every number. Use only numbers from tool results or the briefing. Never calculate load, pace or zones yourself. Say when data is missing or old, and hedge when n is small or confidence is low.
- Call tools when the briefing is not enough. Prefer few calls.
- No medical diagnosis. For injury, illness, chest pain or similar, advise seeing a professional.
- Goals are soft guidance. Never push load to catch up when recovery signals say otherwise. State gaps neutrally and offer to revise the goal. With no active goal, ask the user to set one and offer to save it with set_goal.
- Save a note with add_note only when the user states a durable fact (for example a sore knee). A rest day tomorrow also needs set_planned with load 0. Always tell the user what you saved. For an RPE statement use set_rpe and say which activity you updated.
- Units: metric. Reply in English unless the user writes in Finnish or asks for Finnish. Notes stay as written.
For questions like "what should I do today" answer with exactly these sections, short:
## Signals
A table of today's recovery signals: HRV, resting HR, sleep, readiness, TSB. Columns: value, baseline, status.
## Risks
Flagged risks (high ACWR, low confidence data, active notes), or "none".
## Recommendation
Session type, duration, heart rate cap in bpm from that sport's zones, optional pace.
## Why not the alternatives
Why not a harder session, and why not complete rest.
## Question
Exactly one clarifying question if information is missing (for example how the legs feel), otherwise leave this section out.`

/** Daily briefing: plain data from the database, no model involved. Aims at 1.5k tokens (about 6000 characters). */
export async function briefing(db: DB, now: number) {
  const date = iso(now), t: any = await today(db, now), warnings: string[] = []
  const recent = (await q<any>(db, 'SELECT start_local, type, distance_m, duration_s, avg_hr, load, rpe FROM activities WHERE substr(start_local,1,10) > ? ORDER BY start_local DESC LIMIT 12', addDays(date, -7)))
    .map((a) => [a.start_local.slice(0, 10), sportOf(a.type ?? ''), a.distance_m ? `${Math.round(a.distance_m / 100) / 10} km` : null, a.duration_s ? `${Math.round(a.duration_s / 60)} min` : null, a.avg_hr ? `hr ${Math.round(a.avg_hr)}` : null, a.load != null ? `load ${Math.round(a.load)}` : null, a.rpe ? `rpe ${a.rpe}` : null].filter(Boolean).join(' '))
  const notes = await activeNotes(db, now), goals = ((await goalsView(db, now)) as any).goals.filter((g: any) => g.status === 'active')
  const planned = await plannedFrom(db, date, 7)
  if (!t.data_date) warnings.push('No data has synced yet.')
  else {
    const age = Math.round((Date.parse(date) - Date.parse(t.data_date)) / 864e5)
    if (age > 1) warnings.push(`Latest metrics are ${age} days old (${t.data_date}).`)
    if (t.status?.warming_up) warnings.push('Load history is short, so CTL and ACWR are still warming up.')
    if (t.readiness?.confidence === 'low' || t.readiness?.confidence === 'none') warnings.push(`Readiness confidence is ${t.readiness.confidence}.`)
  }
  if (!goals.length) warnings.push('No active goal: ask the user to set one.')
  const r = t.readiness, s = t.sleep, k = t.tiles
  return {
    date, data_date: t.data_date ?? null, status: t.status ?? null,
    readiness: r ? { score: r.score, label: r.label, confidence: r.confidence, drivers: r.drivers } : null,
    hrv: k?.hrv ?? k?.hrv_last_night ?? null, rhr: k?.rhr ?? null, steps: k?.steps ?? null,
    sleep_last_night: s ? { date: s.date, hours: s.total_s ? Math.round(s.total_s / 360) / 10 : null, score: s.score } : null,
    this_week: t.this_week ? { sessions: t.this_week.sessions, km: Math.round((t.this_week.distance_m ?? 0) / 100) / 10, load: Math.round(t.this_week.load ?? 0) } : null,
    last_7_days: recent, notes, goals: goals.map((g: any) => ({ id: g.id, kind: g.kind, title: g.title, target: g.target_value, max: g.target_max, unit: g.unit, by: g.target_date })),
    planned_next_7_days: planned, warnings,
  }
}

// ---- spend ----
const month = (now: number) => new Date(now).toISOString().slice(0, 7)
const cap = (env: Env) => Number(env.COACH_MONTHLY_USD_CAP) > 0 ? Number(env.COACH_MONTHLY_USD_CAP) : 5
export async function usage(db: DB, env: Env, now: number) {
  const [u] = await q<any>(db, 'SELECT * FROM coach_usage WHERE month=?', month(now))
  return { month: month(now), usd: Math.round((u?.usd ?? 0) * 1e4) / 1e4, cap_usd: cap(env), calls: u?.calls ?? 0, input_tokens: u?.input_tokens ?? 0, output_tokens: u?.output_tokens ?? 0 }
}
const capReached = async (db: DB, env: Env, now: number) => (await usage(db, env, now)).usd >= cap(env)
async function addUsage(db: DB, now: number, u: any) {
  const i = u?.input_tokens ?? 0, o = u?.output_tokens ?? 0, w = u?.cache_creation_input_tokens ?? 0, r = u?.cache_read_input_tokens ?? 0
  const usd = (i * PRICE.input + o * PRICE.output + w * PRICE.cache_write + r * PRICE.cache_read) / 1e6
  await db.prepare(`INSERT INTO coach_usage (month, calls, input_tokens, output_tokens, cache_write_tokens, cache_read_tokens, usd) VALUES (?, 1, ?, ?, ?, ?, ?)
    ON CONFLICT(month) DO UPDATE SET calls=calls+1, input_tokens=input_tokens+excluded.input_tokens, output_tokens=output_tokens+excluded.output_tokens,
    cache_write_tokens=cache_write_tokens+excluded.cache_write_tokens, cache_read_tokens=cache_read_tokens+excluded.cache_read_tokens, usd=usd+excluded.usd`).bind(month(now), i, o, w, r, usd).run()
}

/** One Messages API call. Throws the HTTP status as a number on failure so the key never reaches a message. */
async function claude(env: Env, f: Fetch, body: object) {
  const r = await f('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': env.ANTHROPIC_API_KEY!, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify({ model: env.COACH_MODEL || DEFAULT_MODEL, ...body }) })
  if (!r.ok) throw r.status
  return (await r.json()) as { content: Block[]; stop_reason: string; usage?: unknown }
}

const TOOL_DEFS = TOOLS.map(({ name, description, input_schema }, i) => ({ name, description, input_schema, ...(i === TOOLS.length - 1 ? { cache_control: { type: 'ephemeral' } } : {}) }))
export const SYSTEM_BLOCKS = [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }]
const CAP_TEXT = (u: { usd: number; cap_usd: number }) => `The monthly coach budget is used up (USD ${u.usd.toFixed(2)} of ${u.cap_usd.toFixed(2)}). It resets next month; the dashboard keeps working.`

/** One chat turn. Events: text, tool, done, error. Stores the user message and the final answer. */
export async function chat(o: { db: DB; env: Env; fetch: Fetch; now: number; message: string; emit: (event: string, data: unknown) => Promise<void> | void }) {
  const { db, env, now, emit } = o
  if (await capReached(db, env, now)) { await emit('text', { text: CAP_TEXT(await usage(db, env, now)) }); return emit('done', { capped: true }) }
  const hist = await q<{ role: 'user' | 'assistant'; content: string }>(db, `SELECT role, content FROM (SELECT id, role, content FROM coach_messages ORDER BY id DESC LIMIT ?) ORDER BY id`, HISTORY)
  while (hist[0]?.role === 'assistant') hist.shift()
  await db.prepare('INSERT INTO coach_messages (created_at, role, content) VALUES (?, ?, ?)').bind(now, 'user', o.message).run()
  const brief = JSON.stringify(await briefing(db, now))
  const messages: Msg[] = [...hist, { role: 'user', content: [{ type: 'text', text: `Briefing (computed by code, ${iso(now)}):\n${brief}` }, { type: 'text', text: o.message }] }]
  let answer = ''
  for (let round = 1; round <= MAX_ROUNDS; round++) {
    if (round > 1 && (await capReached(db, env, now))) { answer += CAP_TEXT(await usage(db, env, now)); await emit('text', { text: CAP_TEXT(await usage(db, env, now)) }); break }
    let res
    try { res = await claude(env, o.fetch, { max_tokens: MAX_TOKENS, system: SYSTEM_BLOCKS, tools: TOOL_DEFS, messages }) }
    catch (e) { return emit('error', { message: `The coach could not be reached${typeof e === 'number' ? ` (status ${e})` : ''}.` }) }
    await addUsage(db, now, res.usage)
    const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('')
    if (text) { answer += text; await emit('text', { text }) }
    const uses = res.content.filter((b) => b.type === 'tool_use')
    if (res.stop_reason !== 'tool_use' || !uses.length) break
    const results: unknown[] = []
    for (const u of uses) { await emit('tool', { name: u.name }); results.push({ type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(await callTool(db, u.name!, u.input, now)) }) }
    messages.push({ role: 'assistant', content: res.content }, { role: 'user', content: results })
    if (round === MAX_ROUNDS) { const t = '\n(Stopped after the maximum number of tool rounds.)'; answer += t; await emit('text', { text: t }) }
  }
  if (answer) await db.prepare('INSERT INTO coach_messages (created_at, role, content) VALUES (?, ?, ?)').bind(now, 'assistant', answer).run()
  return emit('done', {})
}

// ---- "Explain this": the card's fixed text is both the fallback and the only grounding the model gets ----
const EXPLAIN_SYSTEM = 'Rewrite the dashboard card explanation you are given in plain language for a runner. At most 80 words. Use only facts and numbers that appear in the text; add no new numbers, advice or diagnosis.'
const hash = async (s: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 24)
export async function explain(o: { db: DB; env: Env; fetch: Fetch; now: number; metric: string; date: string; template: string; regenerate: boolean }) {
  const { db, env, now } = o, fallback = { text: o.template, source: 'template' }
  if (!env.ANTHROPIC_API_KEY) return fallback
  const input_hash = await hash(o.template), [c] = await q<any>(db, 'SELECT input_hash, text FROM explain_cache WHERE metric=? AND date=?', o.metric, o.date)
  if (c && c.input_hash === input_hash && !o.regenerate) return { text: c.text, source: 'cache' }
  if (await capReached(db, env, now)) return fallback
  try {
    const res = await claude(env, o.fetch, { max_tokens: 200, system: EXPLAIN_SYSTEM, messages: [{ role: 'user', content: o.template }] })
    await addUsage(db, now, res.usage)
    const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim()
    if (!text) return fallback
    await db.prepare('INSERT INTO explain_cache (metric, date, input_hash, text, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(metric, date) DO UPDATE SET input_hash=excluded.input_hash, text=excluded.text, created_at=excluded.created_at').bind(o.metric, o.date, input_hash, text, now).run()
    return { text, source: 'llm' }
  } catch { return fallback }
}

export function coachRoutes(app: Hono<{ Bindings: Env }>, deps: Deps) {
  const bad = (c: any, error: string) => c.json({ error, code: 'INVALID' }, 400)
  app.use('/api/coach/*', async (c, next) => (c.env.ANTHROPIC_API_KEY ? next() : c.json({ error: 'coach is not enabled', code: 'COACH_DISABLED' }, 501)))

  app.post('/api/coach/chat', async (c) => {
    const b = await jsonBody(c), message = typeof b?.message === 'string' ? b.message.trim() : ''
    if (!message || message.length > 2000) return bad(c, 'message of 1 to 2000 characters expected')
    const env = c.env
    return streamSSE(c, async (s) => {
      const emit = (event: string, data: unknown) => s.writeSSE({ event, data: JSON.stringify(data) })
      await chat({ db: env.DB, env, fetch: deps.fetch, now: deps.now(), message, emit }).catch(() => emit('error', { message: 'The coach failed.' }))
    })
  })
  app.get('/api/coach/briefing', async (c) => c.json({ as_of: new Date(deps.now()).toISOString(), ...(await briefing(c.env.DB, deps.now())) }))
  app.get('/api/coach/usage', async (c) => c.json(await usage(c.env.DB, c.env, deps.now())))
  app.get('/api/coach/messages', async (c) => c.json({ messages: await q(c.env.DB, `SELECT role, content FROM (SELECT id, role, content FROM coach_messages ORDER BY id DESC LIMIT 50) ORDER BY id`) }))

  app.get('/api/coach/notes', async (c) => c.json({ as_of: new Date(deps.now()).toISOString(), kinds: NOTE_KINDS, notes: await activeNotes(c.env.DB, deps.now()) }))
  app.post('/api/coach/notes', async (c) => {
    const b = await jsonBody(c), id = b ? await addNote(c.env.DB, deps.now(), b.kind, b.text, b.expires_on ?? null, 'user') : null
    return id ? c.json({ ok: true, id }, 201) : bad(c, 'text of 1 to 300 characters and an optional valid expires_on expected')
  })
  app.patch('/api/coach/notes/:id', async (c) => {
    const id = Number(c.req.param('id')), b = await jsonBody(c)
    if (!b || !Number.isInteger(id)) return bad(c, 'JSON body expected')
    const text = b.text === undefined ? null : typeof b.text === 'string' && b.text.trim() && b.text.length <= 300 ? b.text.trim() : false
    if (text === false || (b.kind !== undefined && !NOTE_KINDS.includes(b.kind as string))) return bad(c, 'text or kind is not valid')
    const [r] = await q(c.env.DB, `UPDATE coach_notes SET text=COALESCE(?, text), kind=COALESCE(?, kind), active=COALESCE(?, active) WHERE id=? RETURNING id`, text, b.kind ?? null, b.active === undefined ? null : b.active ? 1 : 0, id)
    return r ? c.json({ ok: true }) : c.json({ error: 'not found', code: 'NOT_FOUND' }, 404)
  })
  app.delete('/api/coach/notes/:id', async (c) => {
    const [r] = await q(c.env.DB, 'DELETE FROM coach_notes WHERE id=? RETURNING id', Number(c.req.param('id')))
    return r ? c.json({ ok: true }) : c.json({ error: 'not found', code: 'NOT_FOUND' }, 404)
  })

  // Never errors for lack of a key or budget: the answer is the card's own text, `source` says which it is.
  app.post('/api/explain', async (c) => {
    const b = await jsonBody(c), metric = b?.metric, date = b?.date, template = b?.template
    if (typeof metric !== 'string' || !metric || metric.length > 80 || typeof date !== 'string' || !/^\d{4}-\d\d-\d\d$/.test(date) || typeof template !== 'string' || !template || template.length > 2000) return bad(c, 'metric, date and template expected')
    return c.json(await explain({ db: c.env.DB, env: c.env, fetch: deps.fetch, now: deps.now(), metric, date, template, regenerate: b?.regenerate === true }))
  })
}
