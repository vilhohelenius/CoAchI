import { useState } from 'preact/hooks'
import { useApi } from './api'
import { day } from './fmt'
import { Page } from './today'
import type { CoachPlan } from './types'

type Msg = { role: 'user' | 'assistant'; content: string }
type Note = { id: number; kind: string; text: string; expires_on: string | null }
const send = (url: string, method: string, body?: unknown) => fetch(url, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).catch(() => null)

/** Reads the SSE stream from the coach: blocks of `event: x` and `data: json` separated by a blank line. */
async function ask(message: string, on: (event: string, data: any) => void) {
  const r = await send('/api/coach/chat', 'POST', { message })
  if (!r?.ok || !r.body) return on('error', { message: r ? `The coach answered ${r.status}.` : 'The server did not answer.' })
  const rd = r.body.getReader(), dec = new TextDecoder()
  let buf = ''
  for (;;) {
    const { done, value } = await rd.read()
    if (done) break
    const parts = (buf += dec.decode(value, { stream: true })).split('\n\n'); buf = parts.pop()!
    for (const p of parts) {
      const f = (k: string) => p.split('\n').find((l) => l.startsWith(k + ': '))?.slice(k.length + 2)
      try { on(f('event') ?? '', JSON.parse(f('data') ?? 'null')) } catch { /* ignore a broken block */ }
    }
  }
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
const inl = (s: string) => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
const LI = /^\s*([-*]|\d+\.)\s+/
/** Tiny markdown for coach replies: headings, tables, lists, bold, code. Everything is HTML-escaped first, so the output is safe to inject. */
export function md(src: string) {
  const L = src.split('\n'), out: string[] = []
  let i = 0
  while (i < L.length) {
    const l = L[i], t = l.trim(), h = /^#{1,4}\s+(.*)/.exec(l)
    if (!t) i++
    else if (h) { out.push(`<h4>${inl(h[1])}</h4>`); i++ }
    else if (t.startsWith('|')) {
      const rows: string[] = []
      while (i < L.length && L[i].trim().startsWith('|')) rows.push(L[i++])
      const cells = (r: string) => r.trim().replace(/^\||\|$/g, '').split('|').map((c) => inl(c.trim())), head = rows.length > 1 && /^[\s|:-]+$/.test(rows[1])
      out.push(`<div class="tbw"><table>${head ? `<thead><tr>${cells(rows[0]).map((c) => `<th>${c}</th>`).join('')}</tr></thead>` : ''}<tbody>${rows.slice(head ? 2 : 0).map((r) => `<tr>${cells(r).map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`)
    } else if (LI.test(l)) {
      const tag = /^\s*\d/.test(l) ? 'ol' : 'ul', items: string[] = []
      while (i < L.length && LI.test(L[i])) items.push(inl(L[i++].replace(LI, '')))
      out.push(`<${tag}>${items.map((x) => `<li>${x}</li>`).join('')}</${tag}>`)
    } else {
      const p: string[] = []
      while (i < L.length && L[i].trim() && !/^#{1,4}\s/.test(L[i]) && !L[i].trim().startsWith('|') && !LI.test(L[i])) p.push(inl(L[i++]))
      out.push(`<p>${p.join('<br>')}</p>`)
    }
  }
  return out.join('')
}

const CHIPS = ['How recovered am I today?', 'How was my week?', 'Should I run tomorrow?']

function Chat({ first, prompt }: { first: Msg[]; prompt?: string }) {
  const [msgs, setMsgs] = useState(first), [text, setText] = useState(prompt ?? ''), [busy, setBusy] = useState(''), [sent, setSent] = useState(false)
  const last = (f: (c: string) => string) => setMsgs((m) => m.map((x, i) => (i === m.length - 1 ? { ...x, content: f(x.content) } : x)))
  const submit = async (e: Event, preset?: string) => {
    e.preventDefault()
    const message = (preset ?? text).trim()
    if (!message || busy) return
    setText(''); setBusy('Thinking'); setSent(true); setMsgs((m) => [...m, { role: 'user', content: message }, { role: 'assistant', content: '' }])
    await ask(message, (ev, d) => {
      if (ev === 'text') { setBusy(''); last((c) => c + d.text) }
      else if (ev === 'tool') setBusy(`Checking ${String(d.name).replace(/^get_/, '').replace(/_/g, ' ')}`)
      else if (ev === 'error') last((c) => c + d.message)
    })
    setBusy('')
  }
  return <section class="card chat">
    <div class="msgs" role="log" aria-live="polite">
      {!msgs.length && <p class="t0">Ask about today, your week or a plan. Numbers come from your own data.</p>}
      {msgs.map((m) => m.role === 'user' || !m.content ? <div class={`msg ${m.role}`}>{m.content || (busy && '…')}</div> : <div class="msg assistant" dangerouslySetInnerHTML={{ __html: md(m.content) }} />)}
    </div>
    {!busy && <div class="chips">{CHIPS.map((c) => <button type="button" onClick={(e) => submit(e, c)}>{c}</button>)}</div>}
    <p class="cap2" role="status">{busy}</p>
    <form class="cform" onSubmit={submit}>
      <input type="text" aria-label="Message the coach" maxLength={2000} value={text} onInput={(e) => setText((e.target as HTMLInputElement).value)} placeholder={sent ? 'Ask a follow-up' : 'Should I run tomorrow?'} />
      <button class="btn" type="submit" disabled={!!busy}>Send</button>
    </form>
  </section>
}

function Notes() {
  const [st, reload] = useApi<{ kinds: string[]; notes: Note[] }>('/api/coach/notes')
  const [text, setText] = useState(''), [kind, setKind] = useState('other'), [msg, setMsg] = useState('')
  const act = async (p: Promise<Response | null>) => { const r = await p; setMsg(r?.ok ? '' : 'Could not save.'); reload() }
  const add = async (e: Event) => { e.preventDefault(); if (!text.trim()) return; await act(send('/api/coach/notes', 'POST', { kind, text: text.trim() })); setText('') }
  return <section class="card"><h2 class="ch2">Notes the coach uses</h2>
    {st.s === 'ok' && (st.data.notes.length ? st.data.notes.map((n) => <div class="rowb nrow"><span class="lab">{n.kind}</span><span>{n.text}{n.expires_on && <small class="lab"> until {n.expires_on}</small>}</span>
      <span><button class="btn g" onClick={() => act(send(`/api/coach/notes/${n.id}`, 'PATCH', { active: false }))}>Resolve</button> <button class="btn g" onClick={() => act(send(`/api/coach/notes/${n.id}`, 'DELETE'))}>Delete</button></span></div>) : <p class="t0">No active notes.</p>)}
    <form class="cform" onSubmit={add}>
      <select aria-label="Kind" value={kind} onChange={(e) => setKind((e.target as HTMLSelectElement).value)}>{(st.s === 'ok' ? st.data.kinds : ['other']).map((k) => <option>{k}</option>)}</select>
      <input type="text" aria-label="Note" maxLength={300} value={text} onInput={(e) => setText((e.target as HTMLInputElement).value)} placeholder="Left knee sore" />
      <button class="btn" type="submit">Add note</button>
    </form><p class="cap2" role="status">{msg}</p></section>
}

/** The morning note, the same text as on Today. Hidden until the model has written one. */
function Brief() {
  const [st] = useApi<CoachPlan>('/api/coach/today')
  return st.s === 'ok' && st.data.brief ? <section class="card"><p class="k">Daily briefing<span>{day(st.data.date, { weekday: 'short', day: 'numeric', month: 'short' })}</span></p><p class="t0">{st.data.brief}</p></section> : null
}

export function CoachPage({ prompt }: { prompt?: string }) {
  const [st, retry] = useApi<{ messages: Msg[] }>('/api/coach/messages'), [u] = useApi<{ usd: number; cap_usd: number; calls: number }>('/api/coach/usage')
  return <Page title="Coach" st={st} retry={retry}>{(d) => <div class="cgrid">
    <Brief />
    <Chat first={d.messages} prompt={prompt} />
    <Notes />
    {u.s === 'ok' && <p class="cap2">This month: USD {u.data.usd.toFixed(2)} of {u.data.cap_usd.toFixed(2)} across {u.data.calls} calls.</p>}
  </div>}</Page>
}
