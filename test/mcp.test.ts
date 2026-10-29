import { describe, expect, it } from 'vitest'
import { exportJWK, generateKeyPair, SignJWT } from './jwt.js'
import { LocalStore } from '../sync/store.js'
import { recompute } from '../sync/recompute.js'
import { TOOLS } from '../src/tools.js'
import { createWorker, type Env } from '../src/mcp/index.js'

const NOW = Date.parse('2030-05-31T12:00:00Z'), ORIGIN = 'https://mcp.test', CB = 'https://claude.ai/api/mcp/auth_callback'
const IDP = 'https://team.cloudflareaccess.com', CLIENT = 'cid', ME = 'me@example.com'
const d = (n: number) => new Date(NOW - n * 864e5).toISOString().slice(0, 10)
const kp = await generateKeyPair(), jwk = { ...(await exportJWK(kp.publicKey)), kid: 'k1' }
const idToken = (email: string) => SignJWT({ aud: CLIENT, iss: `${IDP}/cdn-cgi/access/sso/oidc/${CLIENT}`, exp: NOW / 1000 + 600, email }, kp.privateKey, 'k1')

const kv = () => {
  const m = new Map<string, string>()
  return { get: async (k: string, o?: any) => { const v = m.get(k); return v === undefined ? null : o === 'json' || o?.type === 'json' ? JSON.parse(v) : v },
    put: async (k: string, v: string) => { m.set(k, v) }, delete: async (k: string) => { m.delete(k) },
    list: async ({ prefix = '' } = {}) => ({ keys: [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }) }
}
async function mk() {
  const l = new LocalStore(':memory:'); l.migrate('migrations')
  const db: Env['DB'] = { prepare: (sql: string) => ({ bind: (...a: unknown[]) => ({ all: async <T>() => ({ results: (await l.all(sql, a)) as T[] }), run: async () => { await l.batch([[sql, a]]) } }) }) }
  await l.batch([["INSERT INTO hr_zones (effective_date,sport,lthr,max_hr,rest_hr,z1,z2,z3,z4,z5) VALUES ('2030-01-01','RUNNING',170,190,50,100,120,140,160,175)"],
    ...Array.from({ length: 60 }, (_, i): [string, unknown[]] => ['INSERT INTO activities (id,start_local,type,name,distance_m,duration_s,avg_hr,hr_z1_s,hr_z4_s) VALUES (?,?,?,?,?,?,?,?,?)', [i + 1, `${d(i)} 07:00:00`, 'running', `Run ${i}`, 8000, 2700, 150, 1800, 900]]),
    ['INSERT INTO activities (id,start_local,type,name,duration_s) VALUES (100,?,?,?,?)', [`${d(0)} 18:00:00`, 'strength_training', 'Gym', 3000]],
    ...Array.from({ length: 60 }, (_, i): [string, unknown[]] => ['INSERT INTO daily_summary (date,steps,rhr) VALUES (?,?,?)', [d(i), 9000, 50]])])
  await recompute(l, d(0), true)
  let email = ME
  const fetch = (async (u: any, init: any = {}) => {
    const url = String(u?.url ?? u)
    if (url === `${IDP}/cdn-cgi/access/sso/oidc/${CLIENT}/jwks`) return Response.json({ keys: [jwk] })
    if (url === `${IDP}/token`) return init.body.get('code') === 'upstream-code' && init.body.get('client_secret') === 'sec' ? Response.json({ id_token: await idToken(email) }) : new Response('{}', { status: 400 })
    throw new Error('unexpected network ' + url)
  }) as typeof globalThis.fetch
  const env = { DB: db, OAUTH_KV: kv(), ACCESS_CLIENT_ID: CLIENT, ACCESS_CLIENT_SECRET: 'sec', ACCESS_TOKEN_URL: `${IDP}/token`, ACCESS_AUTHORIZATION_URL: `${IDP}/authorize`,
    ACCESS_JWKS_URL: `${IDP}/cdn-cgi/access/sso/oidc/${CLIENT}/jwks`, ALLOWED_EMAIL: ME } as unknown as Env
  const w = createWorker({ fetch, now: () => NOW })
  const req = (path: string, init?: RequestInit) => w.fetch(new Request(ORIGIN + path, init), env, {})
  return { env, req, setEmail: (e: string) => { email = e } }
}
const cookies = (r: Response) => r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')

/** Registers a client, runs authorize -> consent -> Access -> callback, exchanges the code. Returns the response where the flow ended. */
async function login(m: Awaited<ReturnType<typeof mk>>) {
  const reg: any = await (await m.req('/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'Claude', redirect_uris: [CB], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] }) })).json()
  const verifier = 'v'.repeat(50), challenge = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))).toString('base64url')
  const q = new URLSearchParams({ response_type: 'code', client_id: reg.client_id, redirect_uri: CB, code_challenge: challenge, code_challenge_method: 'S256', state: 'st', resource: ORIGIN + '/mcp' })
  const page = await m.req('/authorize?' + q)
  expect(page.status).toBe(200)
  const handle = /name="handle" value="([^"]+)"/.exec(await page.text())![1]
  const post = await m.req('/authorize?' + q, { method: 'POST', headers: { cookie: cookies(page), 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ handle, decision: 'approve' }) })
  expect(post.status).toBe(302)
  const up = new URL(post.headers.get('location')!)
  expect(up.origin + up.pathname).toBe(`${IDP}/authorize`)
  expect(up.searchParams.get('redirect_uri')).toBe(ORIGIN + '/callback')
  const cb = await m.req(`/callback?code=upstream-code&state=${up.searchParams.get('state')}`, { headers: { cookie: cookies(post) } })
  return { cb, reg, verifier }
}

describe('coachi-mcp', () => {
  it('401 with WWW-Authenticate on /mcp without a token, metadata is public', async () => {
    const m = await mk()
    const r = await m.req('/mcp', { method: 'POST', body: '{}' })
    expect(r.status).toBe(401); expect(r.headers.get('www-authenticate')).toContain('Bearer')
    expect((await m.req('/mcp', { method: 'POST', headers: { authorization: 'Bearer nope' }, body: '{}' })).status).toBe(401)
    const meta: any = await (await m.req('/.well-known/oauth-authorization-server')).json()
    expect(meta.registration_endpoint).toBe(ORIGIN + '/register')
    expect((await m.req('/.well-known/oauth-protected-resource/mcp')).status).toBe(200)
  })

  it('full flow for the Claude.ai callback, then tools/list equals the registry and every tool answers', async () => {
    const m = await mk(), { cb, reg, verifier } = await login(m)
    expect(cb.status).toBe(302)
    const back = new URL(cb.headers.get('location')!)
    expect(back.origin + back.pathname).toBe(CB); expect(back.searchParams.get('state')).toBe('st')
    const tok: any = await (await m.req('/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code: back.searchParams.get('code')!, client_id: reg.client_id, redirect_uri: CB, code_verifier: verifier, resource: ORIGIN + '/mcp' }) })).json()
    expect(tok.access_token).toBeTruthy()
    const rpc = async (method: string, params?: object, id: number | undefined = 1) =>
      (await m.req('/mcp', { method: 'POST', headers: { authorization: `Bearer ${tok.access_token}`, 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id, method, params }) })).json() as Promise<any>

    expect((await rpc('initialize', { protocolVersion: '2025-06-18' })).result.serverInfo.name).toBe('coachi')
    expect((await rpc('ping')).result).toEqual({})
    const list = (await rpc('tools/list')).result.tools
    expect(list.map((t: any) => [t.name, t.description, t.inputSchema])).toEqual(TOOLS.map((t) => [t.name, t.description, t.input_schema]))

    const sample: Record<string, object> = { get_activity: { id: 1 }, get_series: { keys: ['ctl', 'tsb'], agg: 'week' }, resolve_note: { id: 1 }, add_note: { kind: 'injury', text: 'left knee sore' },
      set_planned: { date: d(-1), load: 0 }, set_rpe: { date: d(0), type: 'strength', rpe: 7 }, set_goal: { kind: 'custom', title: 'Be fit' }, update_goal: { id: 1, status: 'done' } }
    for (const t of TOOLS) {
      const r = (await rpc('tools/call', { name: t.name, arguments: sample[t.name] ?? {} })).result, body = JSON.parse(r.content[0].text)
      expect(r.isError, t.name).toBe(false); expect(body.as_of, t.name).toBe(new Date(NOW).toISOString())
    }
    expect((await rpc('tools/call', { name: 'nope' })).error.code).toBe(-32602)
    expect((await rpc('nope')).error.code).toBe(-32601)
    const n = await m.req('/mcp', { method: 'POST', headers: { authorization: `Bearer ${tok.access_token}` }, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) })
    expect(n.status).toBe(202)
  })

  it('rejects an Access login for any other email', async () => {
    const m = await mk(); m.setEmail('someone@else.com')
    const { cb } = await login(m)
    const back = new URL(cb.headers.get('location')!)
    expect(back.origin + back.pathname).toBe(CB); expect(back.searchParams.get('error')).toBe('access_denied'); expect(back.searchParams.get('code')).toBeNull()
  })
})
