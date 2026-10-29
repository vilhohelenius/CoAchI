import { Decoder, Stream } from '@garmin/fitsdk'
import { unzipSync } from 'fflate'

export type Step = {
  lap_idx: number; step_type: string; wkt_step_index: number | null; set_no: number | null; rep_no: number | null
  start_time: string | null; duration_s: number; distance_m: number; avg_speed_mps: number | null
  avg_hr: number | null; max_hr: number | null; avg_power: number | null; avg_cadence: number | null
  ascent_m: number; trigger: string | null
}
export type Streams = Record<'t' | 'hr' | 'speed' | 'alt' | 'cad' | 'pwr' | 'lat' | 'lon' | 'dist', (number | null)[]>
export type Parsed = { steps: Step[]; streams: Streams; rpe: number | null; feel: number | null }

const MERGE = new Set(['warmup', 'cooldown', 'rest', 'other'])
const wavg = (xs: { v: number | null | undefined; w: number }[]) => {
  const ok = xs.filter((x) => x.v != null && x.w > 0) as { v: number; w: number }[]
  const w = ok.reduce((a, x) => a + x.w, 0)
  return w ? ok.reduce((a, x) => a + x.v * x.w, 0) / w : null
}

/** Laps (FIT lap messages) to activity_steps rows. Merges consecutive warmup/cooldown/rest laps sharing wkt_step_index. */
export function mergeLaps(laps: any[]): Step[] {
  const groups: any[][] = []
  for (const l of laps) {
    const prev = groups.at(-1)?.at(-1)
    const same = prev && l.wktStepIndex != null && prev.wktStepIndex === l.wktStepIndex && prev.intensity === l.intensity && MERGE.has(l.intensity)
    same ? groups.at(-1)!.push(l) : groups.push([l])
  }
  const setOf = new Map<number, number>() // wkt_step_index of active laps -> set number
  const reps = new Map<number, number>()
  let cur = { set: null as number | null, rep: null as number | null }
  return groups.map((g, i) => {
    const l = g[0]
    const wi: number | null = l.wktStepIndex ?? null
    const type: string = wi == null ? 'lap' : l.intensity === 'interval' ? 'active' : (l.intensity ?? 'other')
    if (type === 'active' && wi != null) {
      if (!setOf.has(wi)) setOf.set(wi, setOf.size + 1)
      reps.set(wi, (reps.get(wi) ?? 0) + 1)
      cur = { set: setOf.get(wi)!, rep: reps.get(wi)! }
    }
    const inSet = type === 'active' || type === 'recovery'
    const dur = g.reduce((a, x) => a + (x.totalTimerTime ?? 0), 0)
    const dist = g.reduce((a, x) => a + (x.totalDistance ?? 0), 0)
    const w = (f: (x: any) => number | null | undefined) => wavg(g.map((x) => ({ v: f(x), w: x.totalTimerTime ?? 0 })))
    const cad = w((x) => (x.avgCadence == null ? null : (x.avgCadence + (x.avgFractionalCadence ?? 0)) * 2)) // FIT is per leg
    const maxes = g.map((x) => x.maxHeartRate).filter((x) => x != null)
    return {
      lap_idx: i, step_type: type, wkt_step_index: wi,
      set_no: inSet ? cur.set : null, rep_no: inSet ? cur.rep : null,
      start_time: l.startTime instanceof Date ? l.startTime.toISOString() : null,
      duration_s: dur, distance_m: dist, avg_speed_mps: dur ? dist / dur : null,
      avg_hr: w((x) => x.avgHeartRate), max_hr: maxes.length ? Math.max(...maxes) : null,
      avg_power: w((x) => x.avgPower), avg_cadence: cad,
      ascent_m: g.reduce((a, x) => a + (x.totalAscent ?? 0), 0), trigger: l.lapTrigger ?? null,
    }
  })
}

const deg = (s: number | undefined) => (s == null ? null : Math.round((s * 180 / 2 ** 31) * 1e6) / 1e6)

export function parseFit(fit: Uint8Array): Parsed {
  const { messages, errors } = new Decoder(Stream.fromByteArray(Array.from(fit))).read()
  if (errors.length && !messages.lapMesgs?.length) throw new Error('fit decode')
  const rec: any[] = messages.recordMesgs ?? []
  const t0 = rec[0]?.timestamp?.getTime() ?? 0
  const col = (f: (r: any) => number | undefined | null) => rec.map((r) => f(r) ?? null)
  const streams: Streams = {
    t: col((r) => r.timestamp && Math.round((r.timestamp.getTime() - t0) / 1000)),
    hr: col((r) => r.heartRate), speed: col((r) => r.enhancedSpeed ?? r.speed), alt: col((r) => r.enhancedAltitude ?? r.altitude),
    cad: col((r) => r.cadence), pwr: col((r) => r.power), lat: col((r) => deg(r.positionLat)), lon: col((r) => deg(r.positionLong)),
    dist: col((r) => r.distance),
  }
  const s = messages.sessionMesgs?.[0]
  return { steps: mergeLaps(messages.lapMesgs ?? []), streams, rpe: s?.workoutRpe ?? null, feel: s?.workoutFeel ?? null }
}

export function unzipFit(zip: Uint8Array): Uint8Array {
  const f = Object.entries(unzipSync(zip)).find(([n]) => n.toLowerCase().endsWith('.fit'))
  if (!f) throw new Error('no fit in zip')
  return f[1]
}
