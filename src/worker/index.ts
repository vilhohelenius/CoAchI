import { Hono } from 'hono'
import { Fetch, verifyAccess } from './access.js'
import { metricRoutes } from './api.js'
import { coachRoutes, dailySummary } from '../coach.js'
import { daysLeft } from '../queries.js'

export interface DB {
  prepare(sql: string): { bind(...a: unknown[]): { all<T>(): Promise<{ results: T[] }>; run(): Promise<unknown> } }
}
export type Env = {
  DB: DB
  FIT?: { get(key: string): Promise<{ json(): Promise<unknown>; body: ReadableStream } | null> } // R2 bucket, optional so the app still runs without it
  ASSETS: { fetch(req: Request): Promise<Response> }
  ACCESS_TEAM_DOMAIN: string; ACCESS_AUD: string
  GITHUB_REPO: string; GITHUB_REF?: string; GITHUB_DISPATCH_TOKEN: string
  GARMIN_KEY_EXPIRES?: string; PAT_EXPIRES?: string
  ANTHROPIC_API_KEY?: string; COACH_MODEL?: string; COACH_MONTHLY_USD_CAP?: string; COACH_DAILY?: string // secret, vars; no key = coach off
}
type Deps = { fetch: Fetch; now: () => number }

const TABLES = ['activities', 'activity_steps', 'daily_summary', 'sleep', 'hrv_daily', 'body_battery', 'stress', 'steps', 'hr_zones', 'goals']
const WORKFLOW = 'sync.yml'
const RATE_MS = 120e3

const gh = (env: Env, path: string, method: string, f: Fetch, body?: unknown) =>
  f(`https://api.github.com/repos/${env.GITHUB_REPO}/actions/workflows/${WORKFLOW}${path}`, {
    method, body: body ? JSON.stringify(body) : undefined,
    headers: { authorization: `Bearer ${env.GITHUB_DISPATCH_TOKEN}`, accept: 'application/vnd.github+json', 'user-agent': 'coachi', 'x-github-api-version': '2022-11-28' },
  })

export { daysLeft }

async function state(env: Env) {
  const { results } = await env.DB.prepare('SELECT key, value FROM sync_state').bind().all<{ key: string; value: string }>()
  return Object.fromEntries(results.map((r) => [r.key, r.value]))
}

export function createApp(deps: Deps = { fetch: (...a) => fetch(...a), now: Date.now }) {
  const app = new Hono<{ Bindings: Env }>()

  app.use('*', async (c, next) => {
    const ok = await verifyAccess(c.req.header('Cf-Access-Jwt-Assertion'), { team: c.env.ACCESS_TEAM_DOMAIN, aud: c.env.ACCESS_AUD, fetch: deps.fetch, now: deps.now() })
    return ok ? next() : c.json({ error: 'unauthorized', code: 'ACCESS' }, 401)
  })

  app.get('/api/status', async (c) => {
    const now = deps.now(), s = await state(c.env)
    // scalar subqueries: D1 allows at most 5 terms in a compound SELECT
    const { results: [counts] } = await c.env.DB.prepare(`SELECT ${TABLES.map((t) => `(SELECT COUNT(*) FROM ${t}) ${t}`).join(', ')}`).bind().all<Record<string, number>>()
    return c.json({
      as_of: new Date(now).toISOString(),
      sync: {
        last_ok: s.last_sync_ok ?? null, last_error: s.last_error || null, last_error_at: s.last_error_at ?? null,
        run_started_at: s.run_started_at ?? null, dispatch_requested_at: s.dispatch_requested_at ?? null,
      },
      counts,
      garmin_key: daysLeft(c.env.GARMIN_KEY_EXPIRES, now),
      pat: daysLeft(c.env.PAT_EXPIRES, now),
    })
  })

  app.get('/api/config', (c) => c.json({ coach_enabled: !!c.env.ANTHROPIC_API_KEY }))

  metricRoutes(app, deps.now)
  coachRoutes(app, deps)

  app.post('/api/sync', async (c) => {
    const now = deps.now(), last = Number((await state(c.env)).dispatch_requested_at) || 0
    if (now - last < RATE_MS) return c.json({ error: 'rate limited', code: 'RATE_LIMITED', retry_after_s: Math.ceil((RATE_MS - (now - last)) / 1000) }, 429)
    const set = (v: string) => c.env.DB.prepare('INSERT INTO sync_state (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at')
      .bind('dispatch_requested_at', v, now).run()
    await set(String(now)) // ponytail: read-then-write, a double click inside one round trip may dispatch twice
    const r = await gh(c.env, '/dispatches', 'POST', deps.fetch, { ref: c.env.GITHUB_REF ?? 'main' })
    if (r.status !== 204) { await set(String(last)); return c.json({ error: 'dispatch failed', code: `GITHUB_${r.status}` }, 502) }
    return c.json({ ok: true, requested_at: now }, 202)
  })

  // Every other GET is the SPA. Assets (with index.html fallback) sit behind the same Access check.
  app.all('/api/*', (c) => c.json({ error: 'not found', code: 'NOT_FOUND' }, 404))
  app.get('*', (c) => c.env.ASSETS.fetch(c.req.raw))

  return app
}

// Re-enables the workflow when GitHub disabled it for inactivity.
export async function watchdog(env: Env, f: Fetch = (...a) => fetch(...a)) {
  const r = await gh(env, '', 'GET', f)
  if (!r.ok) return `error_${r.status}`
  const { state } = (await r.json()) as { state: string }
  if (state !== 'disabled_inactivity') return state
  const e = await gh(env, '/enable', 'PUT', f)
  return e.status === 204 ? 're-enabled' : `error_${e.status}`
}

export default {
  fetch: (req: Request, env: Env, ctx: unknown) => createApp().fetch(req, env, ctx as never),
  scheduled: (_e: unknown, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }) => ctx.waitUntil(Promise.all([watchdog(env), dailySummary({ db: env.DB, env, fetch: (...a) => fetch(...a), now: Date.now() })])),
}
