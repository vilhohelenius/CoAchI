import { useEffect, useState } from 'preact/hooks'
import { TodayPage } from './today'
import { Settings } from './settings'
import { GoalsPage } from './goals'
import { MileagePage } from './mileage'
import { RecordsPage } from './records'
import { ActivitiesPage, ActivityPage } from './activities'
import { StepsPage } from './steps'
import { HeatmapPage } from './heatmap'
import { ShoesPage } from './shoes'
import { InsightsPage } from './insights'
import { CoachPage } from './coach'
import { CoachOn, useApi } from './api'
import { Nav, GROUPS } from './nav'

const OLD = ['load', 'recovery', 'intensity', 'dynamics'] // the pre-hub routes still open, as insight pages
const NAMES = [...GROUPS.flatMap((g) => g[1].map((v) => v[0])), ...OLD]
const split = (h: string) => h.replace(/^#\/?/, '').split('/')

export function App() {
  const [hash, setHash] = useState(location.hash) // the whole hash, so #/activities and #/activities/123 differ
  const parts = split(hash), r = parts[0] || 'today'
  useEffect(() => {
    const f = () => { setHash(location.hash); scrollTo(0, 0) }
    addEventListener('hashchange', f)
    return () => removeEventListener('hashchange', f)
  }, [])
  const [cfg] = useApi<{ coach_enabled?: boolean }>('/api/config'), coach = cfg.s === 'ok' && cfg.data.coach_enabled === true
  const known = NAMES.includes(r) && (coach || r !== 'coach')
  return <CoachOn.Provider value={coach}>
    <Nav coach={coach} r={OLD.includes(r) ? 'insights' : known ? r : 'today'} />
    <main id="main">
      {r === 'coach' && coach ? <CoachPage /> : r === 'activities' ? (parts[1] ? <ActivityPage key={parts[1]} id={parts[1]} /> : <ActivitiesPage />) : r === 'mileage' ? <MileagePage /> : r === 'steps' ? <StepsPage /> : r === 'records' ? <RecordsPage /> : r === 'heatmap' ? <HeatmapPage /> : r === 'shoes' ? <ShoesPage /> : r === 'today' || !known ? <TodayPage /> : r === 'settings' ? <Settings /> : r === 'insights' || OLD.includes(r) ? <InsightsPage key={hash} sub={OLD.includes(r) ? r : parts[1]} /> : <GoalsPage />}
    </main>
  </CoachOn.Provider>
}
