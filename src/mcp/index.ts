// coachi-mcp Worker: OAuth 2.1 server (DCR, PKCE) via @cloudflare/workers-oauth-provider, with Cloudflare Access (SaaS OIDC) as the only login.
// Claude.ai / Claude Code are the OAuth clients; /mcp serves tools.ts. See docs/mcp.md.
import OAuthProvider, { AuthorizationError, authorizationErrorRedirect } from '@cloudflare/workers-oauth-provider'
import type { DB } from '../worker/index.js'
import { handleMcp } from './rpc.js'
import { verifyIdToken } from './idtoken.js'

export type Env = {
  DB: DB
  FIT?: unknown // shared R2 bucket, bound for tools that may need it later
  OAUTH_KV: unknown
  OAUTH_PROVIDER: any // injected by the library
  ACCESS_CLIENT_ID: string; ACCESS_CLIENT_SECRET: string
  ACCESS_TOKEN_URL: string; ACCESS_AUTHORIZATION_URL: string; ACCESS_JWKS_URL: string
  ALLOWED_EMAIL: string
}
type Deps = { fetch: typeof fetch; now: () => number }

const esc = (v: string) => v.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
const html = (body: string, status = 200, headers?: Headers) => {
  const h = new Headers(headers); h.set('content-type', 'text/html; charset=utf-8')
  return new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>CoAchI</title>${body}`, { status, headers: h })
}

export function createHandler(deps: Deps) {
  return {
    async fetch(req: Request, env: Env): Promise<Response> {
      const url = new URL(req.url), oauth = env.OAUTH_PROVIDER
      try {
        if (url.pathname === '/authorize' && req.method === 'GET') {
          const r = await oauth.parseAuthRequest(req), d = await oauth.describeConsent(r), c = await oauth.beginConsent(r)
          return html(`<h1>Connect ${esc(d.clientName)} to CoAchI?</h1><p>This gives it read and write access to your training data. Tokens go to <b>${esc(d.redirectHost)}</b>.</p>
<form method="post"><input type="hidden" name="handle" value="${esc(c.handle)}"><button name="decision" value="approve">Allow</button> <button name="decision" value="deny">Deny</button></form>`, 200, c.headers)
        }
        if (url.pathname === '/authorize' && req.method === 'POST') {
          const form = await req.formData(), handle = String(form.get('handle'))
          if (form.get('decision') !== 'approve') {
            const d = await oauth.denyConsent(req, handle); d.headers.set('location', d.redirectTo)
            return new Response(null, { status: 302, headers: d.headers })
          }
          const a = await oauth.approveConsent(req, handle)
          const { state, headers } = await oauth.beginUpstream(a.request, { headers: a.headers })
          const up = new URL(env.ACCESS_AUTHORIZATION_URL)
          up.search = new URLSearchParams({ client_id: env.ACCESS_CLIENT_ID, response_type: 'code', scope: 'openid email', redirect_uri: `${url.origin}/callback`, state }).toString()
          headers.set('location', up.toString())
          return new Response(null, { status: 302, headers })
        }
        if (url.pathname === '/callback' && req.method === 'GET') {
          const { request, headers } = await oauth.finishUpstream(req)
          const fail = (code: 'access_denied' | 'server_error') => { headers.set('location', authorizationErrorRedirect(request, code)); return new Response(null, { status: 302, headers }) }
          const code = url.searchParams.get('code')
          if (url.searchParams.get('error') || !code) return fail('access_denied')
          const t = await deps.fetch(env.ACCESS_TOKEN_URL, { method: 'POST', body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: `${url.origin}/callback`, client_id: env.ACCESS_CLIENT_ID, client_secret: env.ACCESS_CLIENT_SECRET }) })
          if (!t.ok) return fail('server_error')
          const claims = await verifyIdToken(((await t.json()) as { id_token?: string }).id_token, { jwksUrl: env.ACCESS_JWKS_URL, aud: env.ACCESS_CLIENT_ID, fetch: deps.fetch, now: deps.now() })
          if (!claims?.email || !env.ALLOWED_EMAIL || claims.email.toLowerCase() !== env.ALLOWED_EMAIL.toLowerCase()) return fail('access_denied')
          const { redirectTo } = await oauth.completeAuthorization({ request, userId: 'owner', metadata: {}, scope: request.scope, props: { email: claims.email } })
          headers.set('location', redirectTo)
          return new Response(null, { status: 302, headers })
        }
      } catch (e) {
        if (e instanceof AuthorizationError && e.redirectTo) return Response.redirect(e.redirectTo, 302)
        if (e instanceof AuthorizationError) return html(`<p>${esc(e.description)}</p>`, 400)
        throw e
      }
      return new Response('not found', { status: 404 })
    },
  }
}

// ponytail: the library wants the canonical resource URL at construction, so build one provider per origin (one in practice) instead of hardcoding it.
function provider(providers: Map<string, OAuthProvider<Env>>, origin: string, deps: Deps) {
  let p = providers.get(origin)
  if (!p) {
    p = new OAuthProvider<Env>({
      apiRoute: '/mcp',
      apiHandler: { fetch: (req: Request, env: Env) => handleMcp(env.DB, req, deps.now()) },
      defaultHandler: createHandler(deps) as never,
      authorizeEndpoint: `${origin}/authorize`,
      tokenEndpoint: `${origin}/token`,
      clientRegistrationEndpoint: `${origin}/register`,
      resourceMetadata: { resource: `${origin}/mcp`, authorization_servers: [origin], resource_name: 'CoAchI' },
    } as never)
    providers.set(origin, p)
  }
  return p
}

export function createWorker(deps: Deps) {
  const providers = new Map<string, OAuthProvider<Env>>()
  return { fetch: (req: Request, env: Env, ctx: unknown) => provider(providers, new URL(req.url).origin, deps).fetch(req, env, ctx as never) }
}
export default createWorker({ fetch: (...a) => fetch(...a), now: Date.now })
