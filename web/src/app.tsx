import { useEffect, useState } from 'preact/hooks'
import { TodayPage } from './today'
import { Settings } from './settings'
import { LoadPage } from './load'
import { RecoveryPage } from './recovery'
import { IntensityPage } from './intensity'
import { DynamicsPage } from './dynamics'
import { GoalsPage } from './goals'
import { MileagePage } from './mileage'
import { ActivitiesPage, ActivityPage } from './activities'

const NAV = [['today', 'Today'], ['load', 'Load'], ['recovery', 'Recovery'], ['intensity', 'Intensity'], ['dynamics', 'Dynamics'], ['goals', 'Goals'], ['mileage', 'Mileage'], ['activities', 'Activities'], ['settings', 'Settings']] as const
const parts = () => location.hash.replace(/^#\/?/, '').split('/')
const route = () => parts()[0] || 'today'

export function App() {
  const [r, setR] = useState(route)
  useEffect(() => {
    const f = () => { setR(route()); scrollTo(0, 0) }
    addEventListener('hashchange', f)
    return () => removeEventListener('hashchange', f)
  }, [])
  useEffect(() => { document.querySelector('.nav [aria-current]')?.scrollIntoView?.({ inline: 'center', block: 'nearest' }) }, [r])
  const known = NAV.some((n) => n[0] === r)
  return <>
    <nav class="nav" aria-label="Main">
      <b class="logo">CoAchI</b>
      {NAV.map(([k, l]) => <a href={`#/${k}`} aria-current={r === k ? 'page' : undefined}>{l}</a>)}
    </nav>
    <main id="main">
      {r === 'activities' ? (parts()[1] ? <ActivityPage key={parts()[1]} id={parts()[1]} /> : <ActivitiesPage />) : r === 'mileage' ? <MileagePage /> : r === 'today' || !known ? <TodayPage /> : r === 'settings' ? <Settings /> : r === 'load' ? <LoadPage /> : r === 'recovery' ? <RecoveryPage /> : r === 'intensity' ? <IntensityPage /> : r === 'dynamics' ? <DynamicsPage /> : <GoalsPage />}
    </main>
  </>
}
