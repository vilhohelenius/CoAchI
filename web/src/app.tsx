import { useEffect, useState } from 'preact/hooks'
import { TodayPage } from './today'
import { Settings } from './settings'
import { LoadPage } from './load'
import { RecoveryPage } from './recovery'
import { IntensityPage } from './intensity'
import { GoalsPage } from './goals'

const NAV = [['today', 'Today'], ['load', 'Load'], ['recovery', 'Recovery'], ['intensity', 'Intensity'], ['goals', 'Goals'], ['settings', 'Settings']] as const
const route = () => location.hash.replace(/^#\/?/, '').split('/')[0] || 'today'

export function App() {
  const [r, setR] = useState(route)
  useEffect(() => {
    const f = () => { setR(route()); scrollTo(0, 0) }
    addEventListener('hashchange', f)
    return () => removeEventListener('hashchange', f)
  }, [])
  const known = NAV.some((n) => n[0] === r)
  return <>
    <nav class="nav" aria-label="Main">
      <b class="logo">CoAchI</b>
      {NAV.map(([k, l]) => <a href={`#/${k}`} aria-current={r === k ? 'page' : undefined}>{l}</a>)}
    </nav>
    <main id="main">
      {r === 'today' || !known ? <TodayPage /> : r === 'settings' ? <Settings /> : r === 'load' ? <LoadPage /> : r === 'recovery' ? <RecoveryPage /> : r === 'intensity' ? <IntensityPage /> : <GoalsPage />}
    </main>
  </>
}
