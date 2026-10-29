import { useEffect, useRef, useState } from 'preact/hooks'

// Views as in design/v14-app.html: grouped side nav on wide screens, bottom tabs plus an All views drawer on phones.
const I = { today: '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"/>', act: '<path d="M4 17c3-9 5-9 8-4s5 3 8-6"/>', km: '<path d="M5 20V9M12 20V4M19 20v-8"/>', ins: '<path d="M4 20h16M7 16l4-5 3 3 5-7"/>', rec: '<path d="M8 4h8v5a4 4 0 0 1-8 0zM12 13v4M8 20h8"/>', goal: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.5"/>', gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/>', more: '<circle cx="6" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="18" cy="12" r="1.2"/>', steps: '<path d="M8 4c2 0 3 2 3 5s-1 4-3 4-3-2-3-5 1-4 3-4zM16 11c2 0 3 2 3 5s-1 4-3 4-3-2-3-5 1-4 3-4z"/>' }
const Ic = ({ k }: { k: keyof typeof I }) => <svg class="i" viewBox="0 0 24 24" aria-hidden="true" dangerouslySetInnerHTML={{ __html: I[k] }} />

type V = [string, string, keyof typeof I]
export const GROUPS: [string, V[]][] = [
  ['Daily', [['today', 'Today', 'today']]],
  ['Training', [['activities', 'Activities', 'act'], ['mileage', 'Mileage', 'km'], ['steps', 'Steps', 'steps'], ['records', 'Records', 'rec']]],
  ['Analysis', [['load', 'Load', 'ins'], ['recovery', 'Recovery', 'ins'], ['intensity', 'Intensity', 'ins'], ['dynamics', 'Dynamics', 'ins']]],
  ['You', [['goals', 'Goals', 'goal'], ['settings', 'Settings', 'gear']]],
]
const TABS = ['today', 'activities', 'mileage', 'load']

// Theme: auto follows the system, the choice is kept in this browser only.
type Mode = 'auto' | 'light' | 'dark'
const getMode = (): Mode => { try { const m = localStorage.getItem('coachi.mode'); return m === 'light' || m === 'dark' ? m : 'auto' } catch { return 'auto' } }
export function applyTheme(m: Mode = getMode()) {
  const dark = m === 'dark' || (m === 'auto' && !!matchMedia?.('(prefers-color-scheme:dark)').matches)
  document.documentElement.dataset.mode = dark ? 'dark' : 'light'
}

export function Nav({ r }: { r: string }) {
  const [open, setOpen] = useState(false), [mode, setMode] = useState(getMode), more = useRef<HTMLButtonElement>(null), close = useRef<HTMLButtonElement>(null)
  const shut = () => { setOpen(false); more.current?.focus() }
  useEffect(() => { applyTheme(mode); const mq = matchMedia?.('(prefers-color-scheme:dark)'), f = () => applyTheme(mode); mq?.addEventListener?.('change', f); return () => mq?.removeEventListener?.('change', f) }, [mode])
  useEffect(() => { if (open) close.current?.focus() }, [open])
  useEffect(() => { setOpen(false) }, [r])
  useEffect(() => { if (!open) return; const f = (e: KeyboardEvent) => e.key === 'Escape' && shut(); addEventListener('keydown', f); return () => removeEventListener('keydown', f) }, [open])
  const flip = () => { const n: Mode = mode === 'auto' ? 'light' : mode === 'light' ? 'dark' : 'auto'; try { localStorage.setItem('coachi.mode', n) } catch {} setMode(n) }
  const link = ([k, l, i]: V) => <a href={`#/${k}`} aria-current={r === k ? 'page' : undefined}><Ic k={i} /><span>{l}</span></a>
  const groups = () => GROUPS.map(([g, vs]) => <><div class="grp">{g}</div>{vs.map(link)}</>)
  const tabs = GROUPS.flatMap((g) => g[1]).filter((v) => TABS.includes(v[0]))
  return <>
    <nav class="nav side" aria-label="Views">
      <b class="logo">CoAchI</b>{groups()}
      <button class="mode" onClick={flip}>Theme: {mode}</button>
    </nav>
    <nav class="tabs" aria-label="Main">
      {tabs.map(link)}
      <button ref={more} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}><Ic k="more" />More</button>
    </nav>
    {open && <div class="drawer"><div class="scrim" onClick={shut} /><div class="panel" role="dialog" aria-modal="true" aria-label="All views">
      <header><b>All views</b><button ref={close} class="mu" aria-label="Close menu" onClick={shut}>Close</button></header>
      {groups()}<button class="mode" onClick={flip}>Theme: {mode}</button>
    </div></div>}
  </>
}
