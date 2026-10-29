import { useEffect, useState } from 'preact/hooks'
import { TodayPage } from './today'
import { Settings } from './settings'
import { LoadPage } from './load'
import { RecoveryPage } from './recovery'
import { IntensityPage } from './intensity'
import { DynamicsPage } from './dynamics'
import { GoalsPage } from './goals'
import { MileagePage } from './mileage'
import { RecordsPage } from './records'
import { ActivitiesPage, ActivityPage } from './activities'
import { StepsPage } from './steps'
import { Nav, GROUPS } from './nav'

const NAMES = GROUPS.flatMap((g) => g[1].map((v) => v[0]))
const parts = () => location.hash.replace(/^#\/?/, '').split('/')
const route = () => parts()[0] || 'today'

export function App() {
  const [r, setR] = useState(route)
  useEffect(() => {
    const f = () => { setR(route()); scrollTo(0, 0) }
    addEventListener('hashchange', f)
    return () => removeEventListener('hashchange', f)
  }, [])
  const known = NAMES.includes(r)
  return <>
    <Nav r={known ? r : 'today'} />
    <main id="main">
      {r === 'activities' ? (parts()[1] ? <ActivityPage key={parts()[1]} id={parts()[1]} /> : <ActivitiesPage />) : r === 'mileage' ? <MileagePage /> : r === 'steps' ? <StepsPage /> : r === 'records' ? <RecordsPage /> : r === 'today' || !known ? <TodayPage /> : r === 'settings' ? <Settings /> : r === 'load' ? <LoadPage /> : r === 'recovery' ? <RecoveryPage /> : r === 'intensity' ? <IntensityPage /> : r === 'dynamics' ? <DynamicsPage /> : <GoalsPage />}
    </main>
  </>
}
