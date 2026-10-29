import { clamp } from './dates.js'

export type Sport = 'run' | 'bike' | 'ski' | 'strength' | 'other'
export type Zones = { lthr: number; max_hr: number; rest_hr: number; floors: (number | null)[] } // floors = z1..z5 lower bounds
export type Act = { type: string; duration_s: number | null; avg_hr: number | null; zone_s: (number | null)[]; rpe: number | null }
export type LoadSource = 'zones' | 'avg_hr' | 'rpe'

export const sportOf = (type: string): Sport =>
  /running/.test(type) ? 'run' : /cycling|biking/.test(type) ? 'bike' : /ski/.test(type) ? 'ski' : /strength/.test(type) ? 'strength' : 'other'

// Banister TRIMP weight per minute at heart-rate reserve fraction r (male constants).
const k = (r: number) => r * 0.64 * Math.exp(1.92 * r)
const hrr = (hr: number, z: Zones) => clamp((hr - z.rest_hr) / (z.max_hr - z.rest_hr), 0, 1)

/** Per-activity load, 100 = one hour at LTHR. Falls back from zone times to average HR to session RPE. */
export function activityLoad(a: Act, z: Zones | null): { load: number; source: LoadSource } {
  const min = (a.duration_s ?? 0) / 60
  const ref = z && z.max_hr > z.rest_hr ? 60 * k(hrr(z.lthr, z)) : 0
  if (z && ref > 0 && sportOf(a.type) !== 'strength') {
    const f = z.floors
    if (f.every((x) => x != null) && a.zone_s.some((s) => (s ?? 0) > 0)) {
      const mid = f.map((lo, i) => ((lo as number) + (i < 4 ? (f[i + 1] as number) : z.max_hr)) / 2)
      const trimp = a.zone_s.reduce<number>((s, sec, i) => s + ((sec ?? 0) / 60) * k(hrr(mid[i], z)), 0)
      return { load: (trimp / ref) * 100, source: 'zones' }
    }
    if (a.avg_hr && min > 0) return { load: ((min * k(hrr(a.avg_hr, z))) / ref) * 100, source: 'avg_hr' }
  }
  const rpe = a.rpe == null ? 5 : a.rpe > 10 ? a.rpe / 10 : a.rpe // Garmin stores RPE 0-100 in steps of 10
  return { load: (min / 60) * (rpe / 7.5) ** 2 * 100, source: 'rpe' }
}

export type LoadPoint = { ctl: number; atl: number; tsb: number; tsb_end: number }
const KC = 1 - Math.exp(-1 / 42), KA = 1 - Math.exp(-1 / 7)
/** CTL, ATL and TSB for a daily load array (index = day). tsb is form going into the day, tsb_end after it. */
export function loadSeries(loads: number[]): LoadPoint[] {
  let c = 0, a = 0
  return loads.map((l) => {
    const tsb = c - a
    c += (l - c) * KC; a += (l - a) * KA
    return { ctl: c, atl: a, tsb, tsb_end: c - a }
  })
}

const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length
/** Uncoupled ACWR: mean of days i-6..i over mean of days i-34..i-7. Null with under 35 days of history or no chronic load. */
export function acwr(loads: number[], i: number): number | null {
  if (i < 34) return null
  const chronic = avg(loads.slice(i - 34, i - 6))
  return chronic > 0 ? avg(loads.slice(i - 6, i + 1)) / chronic : null
}
export const ramp = (ctl: number[], i: number, n = 7) => (i >= n ? ctl[i] - ctl[i - n] : null)

/** Continues the CTL/ATL recursion from an end-of-day state over planned daily loads. */
export function project(ctl: number, atl: number, planned: number[]) {
  return planned.map((l) => {
    const tsb = ctl - atl
    ctl += (l - ctl) * KC; atl += (l - atl) * KA
    return { ctl, atl, tsb, tsb_end: ctl - atl }
  })
}
