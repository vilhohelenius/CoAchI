import { useState } from 'preact/hooks'
import { useApi } from './api'
import { day, num } from './fmt'
import { Page, Pill } from './today'
import type { Shoe, ShoesResp } from './types'

const send = (url: string, method: string, body: unknown) => fetch(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null)
const say = (r: Response | null) => (!r ? 'The server did not answer.' : r.ok ? '' : `Could not save (${r.status}).`)

/** Add or edit one shoe. Only the fields that matter day to day, the rest keeps its default. */
function ShoeForm({ s, done }: { s?: Shoe; done: () => void }) {
  const [v, setV] = useState({ name: s?.name ?? '', brand: s?.brand ?? '', start_km: String(s?.start_km ?? 0), retire_km: String(s?.retire_km ?? 800), def: s?.default_for === 'run' })
  const [msg, setMsg] = useState('')
  const on = (k: string) => (e: Event) => setV({ ...v, [k]: (e.target as HTMLInputElement).value })
  const submit = async (e: Event) => {
    e.preventDefault()
    const start_km = Number(v.start_km), retire_km = Number(v.retire_km)
    if (!v.name.trim() || !(start_km >= 0 && start_km <= 20000) || !(retire_km >= 100 && retire_km <= 3000)) return setMsg('Check the numbers. A name is needed, retire between 100 and 3000 km.')
    const r = await send(s ? `/api/shoes/${s.id}` : '/api/shoes', s ? 'PATCH' : 'POST', { name: v.name.trim(), brand: v.brand.trim() || null, start_km, retire_km, default_for: v.def ? 'run' : null })
    const m = say(r); m ? setMsg(m) : done()
  }
  return <form class="card" onSubmit={submit}><h2 class="ch2">{s ? `Edit ${s.name}` : 'Add a shoe'}</h2>
    <div class="pr">
      <label><span class="lab">Name</span><input type="text" maxLength={60} value={v.name} onInput={on('name')} /></label>
      <label><span class="lab">Brand</span><input type="text" maxLength={60} value={v.brand} onInput={on('brand')} /></label>
      <label><span class="lab">Kilometres already run</span><input type="number" inputMode="decimal" min={0} max={20000} step={10} value={v.start_km} onInput={on('start_km')} /></label>
      <label><span class="lab">Retire at</span><input type="number" inputMode="numeric" min={100} max={3000} step={50} value={v.retire_km} onInput={on('retire_km')} /> <small class="lab" style="display:inline">km</small></label>
    </div>
    <label class="cap2"><input type="checkbox" checked={v.def} onChange={() => setV({ ...v, def: !v.def })} /> Use for new runs</label>
    <p class="cap2" role="status">{msg}</p><button class="btn" type="submit">{s ? 'Save shoe' : 'Add shoe'}</button>{s && <> <button class="btn g" type="button" onClick={done}>Cancel</button></>}</form>
}

function ShoeCardRow({ s, edit, reload }: { s: Shoe; edit: () => void; reload: () => void }) {
  const flip = async () => { await send(`/api/shoes/${s.id}`, 'PATCH', { retired_on: s.retired_on ? null : new Date().toISOString().slice(0, 10) }); reload() }
  return <section class="card"><p class="k">{s.name}{s.brand && <span>{s.brand}</span>}{s.default_for && <Pill tone="ok">Used for new runs</Pill>}{s.alert && <Pill tone="warn">{s.alert === 'over' ? 'Time to retire' : 'Nearly worn out'}</Pill>}</p>
    <div class="big">{num(s.km)}<small> of {num(s.retire_km)} km</small></div>
    <div class="bar"><i style={`width:${Math.min(100, (s.km / s.retire_km) * 100)}%`} /></div>
    <p class="cap2">{s.runs} {s.runs === 1 ? 'run' : 'runs'}{s.last_run ? `, last on ${day(s.last_run, { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}{s.retired_on ? `. Retired ${day(s.retired_on, { day: 'numeric', month: 'short', year: 'numeric' })}.` : ''}</p>
    <button class="btn g" onClick={edit}>Edit</button> <button class="btn g" onClick={flip}>{s.retired_on ? 'Bring back' : 'Retire'}</button></section>
}

export function ShoesView({ d, reload }: { d: ShoesResp; reload: () => void }) {
  const [editing, setEditing] = useState<number | null>(null)
  const live = d.shoes.filter((s) => !s.retired_on), old = d.shoes.filter((s) => s.retired_on)
  const done = () => { setEditing(null); reload() }
  const row = (s: Shoe) => editing === s.id ? <ShoeForm s={s} done={done} /> : <ShoeCardRow s={s} edit={() => setEditing(s.id)} reload={reload} />
  return <>
    <p class="sub">Kilometres are counted from the runs given to each shoe. New runs get the shoe marked for new runs.</p>
    {live.length ? <div class="g2">{live.map(row)}</div> : <section class="card"><p class="k">No shoes yet</p><p class="t0">Add a pair below to start counting its kilometres.</p></section>}
    {old.length > 0 && <><h2 class="sh">Retired</h2><div class="g2">{old.map(row)}</div></>}
    <h2 class="sh">Add a shoe</h2><ShoeForm done={done} />
  </>
}

export function ShoesPage() {
  const [st, retry] = useApi<ShoesResp>('/api/shoes')
  return <Page title="Shoes" st={st} retry={retry}>{(d) => <ShoesView d={d} reload={retry} />}</Page>
}

/** Picker on a run: which pair was worn. Nothing shows until the shoe list has loaded. */
export function ShoeCard({ id, shoe }: { id: number; shoe: number | null }) {
  const [st] = useApi<ShoesResp>('/api/shoes')
  const [cur, setCur] = useState(shoe), [msg, setMsg] = useState('')
  if (st.s !== 'ok') return null
  const opts = st.data.shoes.filter((s) => !s.retired_on || s.id === cur), now = st.data.shoes.find((s) => s.id === cur)
  const pick = async (e: Event) => {
    const v = (e.target as HTMLSelectElement).value, sid = v === '' ? null : Number(v)
    const m = say(await send(`/api/activities/${id}`, 'PATCH', { shoe_id: sid }))
    if (m) setMsg(m); else { setCur(sid); setMsg('Saved.') }
  }
  return <section class="card"><h3 class="ch">Shoes</h3>
    <label><span class="lab">Worn on this run</span><select value={cur ?? ''} onChange={pick}><option value="">No shoe</option>{opts.map((s) => <option value={s.id}>{s.name}</option>)}</select></label>
    {now && <p class="cap2">{num(now.km)} of {num(now.retire_km)} km{now.alert === 'over' ? ', time to retire them' : ''}. <a href="#/shoes">All shoes</a></p>}
    <p class="cap2" role="status">{msg}</p></section>
}
