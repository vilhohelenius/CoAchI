import { useState } from 'preact/hooks'
import { useApi } from './api'
import { Err } from './today'

type Exp = { expires_on: string | null; days_left: number | null; banner: boolean }
type Status = { sync: { last_ok: string | null; last_error: string | null }; counts: Record<string, number>; garmin_key: Exp; pat: Exp }
const when = (t: string | null) => (t ? new Date(Number(t)).toLocaleString('en-GB') : 'never')
const exp = (x: Exp) => (x.expires_on ? `${x.expires_on} (${x.days_left} days)` : 'not set')

export function Settings() {
  const [st, retry] = useApi<Status>('/api/status')
  const [msg, setMsg] = useState('')
  const sync = async () => {
    const r = await fetch('/api/sync', { method: 'POST' }).catch(() => null)
    setMsg(!r ? 'The server did not answer' : r.status === 202 ? 'Sync started' : r.status === 429 ? 'Wait two minutes before syncing again' : `Sync failed (${r.status})`)
  }
  if (st.s !== 'ok') return <><h1>Settings</h1>{st.s === 'loading' ? <section class="card sk" aria-busy="true" /> : <Err msg={st.msg} retry={retry} />}</>
  const s = st.data, warn = [s.garmin_key.banner && 'Your Garmin key expires soon', s.pat.banner && 'Your GitHub token expires soon'].filter(Boolean)
  return <>
    <h1>Settings</h1>
    {warn.length > 0 && <p class="banner" role="status">{warn.join('. ')}</p>}
    <section class="card">
      <h2 class="ch"><span>Sync and keys</span></h2>
      <dl class="dl">
        <dt>Last successful sync</dt><dd>{when(s.sync.last_ok)}</dd>
        <dt>Last error</dt><dd>{s.sync.last_error || 'none'}</dd>
        <dt>Garmin key expires</dt><dd>{exp(s.garmin_key)}</dd>
        <dt>GitHub token expires</dt><dd>{exp(s.pat)}</dd>
        <dt>Rows</dt><dd>{Object.entries(s.counts).map((e) => e.join(' ')).join(', ')}</dd>
      </dl>
      <button class="btn" onClick={sync}>Sync now</button> <span role="status" class="lab">{msg}</span>
    </section>
  </>
}
