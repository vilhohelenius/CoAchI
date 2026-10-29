import { Encoder, Profile } from '@garmin/fitsdk'

// Synthetic 2-set interval session: 2 warmup auto-laps, set 1 = 3x(active+recovery), rest, set 2 = 2x(active+recovery), 2 cooldown laps.
export function syntheticFit(): Uint8Array {
  const enc = new Encoder()
  const w = (n: number, m: object) => enc.onMesg(n, m as never)
  const t0 = Date.UTC(2030, 0, 1)
  w(Profile.MesgNum.FILE_ID, { type: 'activity', manufacturer: 'development', product: 0, timeCreated: new Date(t0) })
  let t = t0
  const lap = (intensity: string, idx: number, secs: number, dist: number, hr: number) => {
    for (let i = 0; i < secs; i++)
      w(Profile.MesgNum.RECORD, { timestamp: new Date(t + i * 1000), heartRate: hr, distance: (dist * i) / secs, enhancedSpeed: dist / secs, positionLat: 1000, positionLong: 2000 })
    w(Profile.MesgNum.LAP, { timestamp: new Date((t += secs * 1000)), startTime: new Date(t - secs * 1000), totalTimerTime: secs, totalDistance: dist, avgHeartRate: hr, maxHeartRate: hr + 5, intensity, wktStepIndex: idx, lapTrigger: 'manual' })
  }
  lap('warmup', 0, 60, 200, 120); lap('warmup', 0, 60, 200, 130)
  for (let r = 0; r < 3; r++) { lap('active', 1, 30, 100, 160); lap('recovery', 2, 20, 30, 140) }
  lap('rest', 3, 40, 20, 120)
  for (let r = 0; r < 2; r++) { lap('active', 4, 30, 100, 165); lap('recovery', 5, 20, 30, 145) }
  lap('cooldown', 6, 60, 200, 120); lap('cooldown', 6, 60, 200, 110)
  w(Profile.MesgNum.SESSION, { timestamp: new Date(t), startTime: new Date(t0), sport: 'running', workoutRpe: 7 })
  return enc.close()
}

