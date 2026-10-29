# MCP server (coachi-mcp) setup

A second Worker. It exposes the same 20 tools as the in-app coach at `POST /mcp` (Streamable HTTP, stateless) and logs only tool name and time. Login is Cloudflare Access (SaaS OIDC); only `ALLOWED_EMAIL` gets through. The Worker shares the D1 database and R2 bucket with `coachi`. No Access policy goes in front of it.

Do not deploy before the main Worker's D1 migrations are applied. All commands run from the repo root. Replace `<id>` with your account id.

## 1. Config

```
cp wrangler.mcp.example.toml wrangler.mcp.toml   # gitignored
```
Fill in the same `database_id` and R2 bucket as `wrangler.toml`. The KV id comes from step 2.

## 2. KV namespace

```
CLOUDFLARE_ACCOUNT_ID=<id> npx wrangler kv namespace create OAUTH_KV
```
Put the returned id in `wrangler.mcp.toml` under `[[kv_namespaces]]`.

## 3. First deploy (to learn the URL)

```
CLOUDFLARE_ACCOUNT_ID=<id> npx wrangler deploy -c wrangler.mcp.toml
```
Note the URL, `https://coachi-mcp.<subdomain>.workers.dev`. The first deploy works without secrets; logins fail until step 5.

## 4. Access for SaaS (OIDC) app (dashboard)

Zero Trust > Access > Applications > Add an application > SaaS > Select "OIDC".
- Application name: `CoAchI MCP`.
- Redirect URL: `https://coachi-mcp.<subdomain>.workers.dev/callback`
- Scopes: `openid`, `email`. Leave PKCE off.
- Policy: Allow, Include > Emails > your email (same as the dashboard).
- Save. Copy from the app page: Client ID, Client secret, Token endpoint, Authorization endpoint, JWKS endpoint (Key endpoint).

## 5. Secrets

Run each, paste the value when asked:
```
for s in ACCESS_CLIENT_ID ACCESS_CLIENT_SECRET ACCESS_TOKEN_URL ACCESS_AUTHORIZATION_URL ACCESS_JWKS_URL ALLOWED_EMAIL; do
  CLOUDFLARE_ACCOUNT_ID=<id> npx wrangler secret put $s -c wrangler.mcp.toml
done
```
`ALLOWED_EMAIL` is your Access email. Secrets apply immediately, no redeploy needed.

## 6. Connect Claude

Claude.ai (web): Settings > Connectors > Add custom connector > URL `https://coachi-mcp.<subdomain>.workers.dev/mcp` > Add > Connect. A CoAchI consent page opens: Allow, then sign in through Access. Registration is automatic (DCR); the callback `https://claude.ai/api/mcp/auth_callback` is handled.

Claude Code:
```
claude mcp add --transport http coachi https://coachi-mcp.<subdomain>.workers.dev/mcp
```
Then run `/mcp` in Claude Code and choose Authenticate.

## Checks and revoking

- `curl -i -X POST https://coachi-mcp.<subdomain>.workers.dev/mcp` must return `401` with a `WWW-Authenticate` header.
- Revoke a client: delete its keys (`grant:*`, `token:*`) in the OAUTH_KV namespace (dashboard > KV), or delete the namespace and make a new one.
- Rotate the Access secret: update it in Access, then `wrangler secret put ACCESS_CLIENT_SECRET`.
- Write tools (`add_note`, `set_planned`, `set_goal`, `set_rpe`, `update_goal`, `resolve_note`) are available to the connected client. Claude.ai asks before each write by default.

## Not built

The `briefing` resource (its builder lives in `src/coach.ts`; MCP code must not import it). Tokens last 1 hour with refresh for 30 days (library defaults).
