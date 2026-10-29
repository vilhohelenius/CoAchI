import { useState } from 'preact/hooks'
import { useApi } from './api'
import { Err, Pill } from './today'

type Exp = { expires_on: string | null; days_left: number | null; banner: boolean }
type Status = { sync: { last_ok: string | null; last_error: string | null }; counts: Record<string, number>; garmin_key: Exp; pat: Exp }
const when = (t: string | null) => (t ? new Date(Number(t)).toLocaleString('en-GB') : 'never')

export function Settings() {
  const [st, retry] = useApi<Status>('/api/status')
  const [msg, setMsg] = useState('')
  const sync = async () => {
    const r = await fetch('/api/sync', { method: 'POST' }).catch(() => null)
    setMsg(!r ? 'The server did not answer' : r.status === 202 ? 'Sync started' : r.status === 429 ? 'Wait two minutes before syncing again' : `Sync failed (${r.status})`)
  }
  if (st.s !== 'ok') return <><h1>Settings</h1>{st.s === 'loading' ? <section class="card sk" aria-busy="true" /> : <Err msg={st.msg} retry={retry} />}</>
  const s = st.data, warn = [s.garmin_key.banner && 'Your Garmin key expires soon', s.pat.banner && 'Your GitHub token expires soon'].filter(Boolean)
  const key = (n: string, x: Exp) => <div class="srow"><span><span class="nm">{n}</span><span class="ms">{x.expires_on ? `Expires ${x.expires_on}` : 'No expiry set'}</span></span>
    {x.days_left != null && <Pill tone={x.days_left < 0 ? 'bad' : x.banner ? 'warn' : 'ok'}>{x.days_left < 0 ? 'Expired' : `${x.days_left} days left`}</Pill>}</div>
  return <>
    <h1>Settings</h1>
    {warn.length > 0 && <p class="banner" role="status">{warn.join('. ')}</p>}
    <div class="sgrid">
      <section class="card">
        <h2 class="ch"><span>Sync</span></h2>
        <div class="srow"><span><span class="nm">Last successful sync</span><span class="ms">{when(s.sync.last_ok)}</span></span><Pill tone={s.sync.last_error ? 'warn' : 'ok'}>{s.sync.last_error ? 'Last run failed' : 'Healthy'}</Pill></div>
        {s.sync.last_error && <p class="cap2">{s.sync.last_error}</p>}
        <div style="display:flex;gap:12px;align-items:center;margin-top:10px;flex-wrap:wrap"><button class="btn" onClick={sync}>Sync now</button><span role="status" class="lab">{msg}</span></div>
      </section>
      <section class="card">
        <h2 class="ch"><span>Access keys</span></h2>
        {key('GitHub token', s.pat)}{key('Garmin key', s.garmin_key)}
        <p class="cap2">Keys are never shown here.</p>
      </section>
      <section class="card">
        <h2 class="ch"><span>Data on file</span></h2>
        <dl class="dl">{Object.entries(s.counts).map(([k, n]) => <><dt>{k}</dt><dd>{n.toLocaleString('en-GB')}</dd></>)}</dl>
      </section>
    </div>
  </>
}
