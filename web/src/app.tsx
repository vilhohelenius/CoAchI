import { useEffect, useState } from 'preact/hooks'
import { TodayPage } from './today'
import { Settings } from './settings'

const NAV = [['today', 'Today'], ['activities', 'Activities'], ['insights', 'Insights'], ['goals', 'Goals'], ['settings', 'Settings']] as const
const route = () => location.hash.replace(/^#\/?/, '').split('/')[0] || 'today'

function Coming({ name }: { name: string }) {
  return <><h1>{name}</h1><section class="card"><p class="k">Coming soon</p><p class="t0">This page is not built yet. Today has the daily view.</p><a class="btn" href="#/today">Back to Today</a></section></>
}

export function App() {
  const [r, setR] = useState(route)
  useEffect(() => {
    const f = () => { setR(route()); scrollTo(0, 0) }
    addEventListener('hashchange', f)
    return () => removeEventListener('hashchange', f)
  }, [])
  const name = NAV.find((n) => n[0] === r)?.[1]
  return <>
    <nav class="nav" aria-label="Main">
      <b class="logo">CoAchI</b>
      {NAV.map(([k, l]) => <a href={`#/${k}`} aria-current={r === k ? 'page' : undefined}>{l}</a>)}
    </nav>
    <main id="main">
      {r === 'today' || !name ? <TodayPage /> : r === 'settings' ? <Settings /> : <Coming name={name} />}
    </main>
  </>
}
