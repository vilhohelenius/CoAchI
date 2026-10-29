export type StatusInput = {
  days: number                 // days of load history
  ctl: number; ctl7: number | null; ctl28?: number | null; atl: number; atl7: number | null
  tsb: number; acwr: number | null
  hard_share: number | null    // share of 28-day HR time in zones 3 to 5
}
export type TrainingStatus = 'Productive' | 'Maintaining' | 'Recovery' | 'Overreaching' | 'Detraining' | 'Not enough data'

/**
 * Self-computed training status. Heuristic thresholds, shown with the numbers.
 * Order matters: overload first, then the CTL trend over 28 days (7 days when 28 is missing).
 * ACWR alone does not flag overload: a hard week after a break spikes it while fitness is rising.
 */
export function trainingStatus(x: StatusInput): { label: TrainingStatus; reason: string } {
  if (x.days < 28 || x.ctl7 == null || x.atl7 == null) return { label: 'Not enough data', reason: 'Under 4 weeks of load history.' }
  const ramp = x.ctl28 != null ? x.ctl - x.ctl28 : x.ctl - x.ctl7
  if (x.tsb < -30 || (x.tsb < -20 && (x.hard_share ?? 0) > 0.35))
    return { label: 'Overreaching', reason: 'Fatigue is well above fitness, and a large share of your training is hard.' }
  if (ramp > 1.5) return { label: 'Productive', reason: 'Fitness is rising and fatigue is manageable.' }
  if (ramp >= -1.5) return { label: 'Maintaining', reason: 'Fitness is steady.' }
  // falling fitness: a planned easy spell (ATL dropped fast, CTL barely) is recovery, a long slide is detraining
  if (x.atl < 0.7 * x.atl7 && x.ctl > 0.9 * x.ctl7) return { label: 'Recovery', reason: 'Fatigue dropped after a harder spell and fitness is intact.' }
  // still training at your usual level this week, so the slide is not a layoff
  if (x.atl >= 0.8 * x.ctl) return { label: 'Maintaining', reason: 'Fitness is steady and recent training matches it.' }
  return { label: 'Detraining', reason: 'Fitness is falling because training is well below your usual.' }
}
