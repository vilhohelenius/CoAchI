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
import { HeatmapPage } from './heatmap'
import { ShoesPage } from './shoes'
import { Nav, GROUPS } from './nav'

const NAMES = GROUPS.flatMap((g) => g[1].map((v) => v[0]))
const split = (h: string) => h.replace(/^#\/?/, '').split('/')

export function App() {
  const [hash, setHash] = useState(location.hash) // the whole hash, so #/activities and #/activities/123 differ
  const parts = split(hash), r = parts[0] || 'today'
  useEffect(() => {
    const f = () => { setHash(location.hash); scrollTo(0, 0) }
    addEventListener('hashchange', f)
    return () => removeEventListener('hashchange', f)
  }, [])
  const known = NAMES.includes(r)
  return <>
    <Nav r={known ? r : 'today'} />
    <main id="main">
      {r === 'activities' ? (parts[1] ? <ActivityPage key={parts[1]} id={parts[1]} /> : <ActivitiesPage />) : r === 'mileage' ? <MileagePage /> : r === 'steps' ? <StepsPage /> : r === 'records' ? <RecordsPage /> : r === 'heatmap' ? <HeatmapPage /> : r === 'shoes' ? <ShoesPage /> : r === 'today' || !known ? <TodayPage /> : r === 'settings' ? <Settings /> : r === 'load' ? <LoadPage /> : r === 'recovery' ? <RecoveryPage /> : r === 'intensity' ? <IntensityPage /> : r === 'dynamics' ? <DynamicsPage /> : <GoalsPage />}
    </main>
  </>
}
