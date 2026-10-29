// Stateless MCP over Streamable HTTP, hand-rolled: initialize, ping, tools/list, tools/call. Exposes exactly the tools.ts registry.
import type { DB } from '../worker/index.js'
import { TOOLS, callTool } from '../tools.js'

const VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05']
const err = (id: unknown, code: number, message: string) => ({ jsonrpc: '2.0', id, error: { code, message } })

async function one(db: DB, m: any, now: number) {
  if (!m || typeof m.method !== 'string') return err(m?.id ?? null, -32600, 'invalid request')
  if (m.id === undefined) return null // notification
  const ok = (result: object) => ({ jsonrpc: '2.0', id: m.id, result })
  switch (m.method) {
    case 'initialize':
      return ok({ protocolVersion: VERSIONS.includes(m.params?.protocolVersion) ? m.params.protocolVersion : VERSIONS[0], capabilities: { tools: {} }, serverInfo: { name: 'coachi', version: '1' } })
    case 'ping': return ok({})
    case 'tools/list':
      return ok({ tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.input_schema, annotations: { readOnlyHint: !t.write } })) })
    case 'tools/call': {
      const name = m.params?.name
      if (!TOOLS.some((t) => t.name === name)) return err(m.id, -32602, `unknown tool ${name}`)
      console.log(JSON.stringify({ tool: name, ts: new Date(now).toISOString() })) // name + time only, never arguments
      const r: any = await callTool(db, name, m.params.arguments, now)
      return ok({ content: [{ type: 'text', text: JSON.stringify(r) }], isError: 'error' in r })
    }
    default: return err(m.id, -32601, 'method not found')
  }
}

export async function handleMcp(db: DB, req: Request, now: number): Promise<Response> {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405, headers: { allow: 'POST' } })
  let body: unknown
  try { body = await req.json() } catch { return Response.json(err(null, -32700, 'parse error'), { status: 400 }) }
  const out = Array.isArray(body) ? (await Promise.all(body.map((m) => one(db, m, now)))).filter(Boolean) : await one(db, body, now)
  return !out || (Array.isArray(out) && !out.length) ? new Response(null, { status: 202 }) : Response.json(out)
}
