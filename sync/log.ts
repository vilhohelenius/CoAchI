// Public-CI-safe logger: stage names, counts and status codes only (plan.md section 15).
// Everything is allowlisted by shape, and registered secrets are redacted as a second layer.
const secrets = new Set<string>()
export const mask = (s: string) => { if (s.length >= 6) secrets.add(s) }

const KEY = /^[a-z][a-z_]{0,23}$/
const WORD = /^[A-Za-z][A-Za-z_.-]{0,23}$/
const STAGE = /^[a-z][a-z_.:-]{0,39}$/ // no digits: ids cannot ride in a stage name

export function line(stage: string, fields: Record<string, number | string> = {}): string {
  const parts = Object.entries(fields).map(([k, v]) => {
    const key = KEY.test(k) ? k : '?'
    const val = typeof v === 'number' && Number.isFinite(v) ? String(v) : typeof v === 'string' && WORD.test(v) ? v : '?'
    return `${key}=${val}`
  })
  let out = [STAGE.test(stage) ? stage : '?', ...parts].join(' ')
  for (const s of secrets) out = out.split(s).join('***')
  return out
}

export let sink: (s: string) => void = (s) => console.log(s)
export const setSink = (f: (s: string) => void) => { sink = f }
export const log = (stage: string, fields?: Record<string, number | string>) => sink(line(stage, fields))

// Never prints the message: only the endpoint name and status of our own GarminError.
export function logError(stage: string, e: unknown) {
  const g = e as { endpoint?: string; status?: number }
  const f: Record<string, number | string> = { error: 'yes' }
  if (typeof g?.status === 'number') f.status = g.status
  if (typeof g?.endpoint === 'string') f.endpoint = g.endpoint
  log(stage, f)
}
