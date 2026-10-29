import { describe, expect, it } from 'vitest'
import { zipSync } from 'fflate'
import { Encoder, Profile } from '@garmin/fitsdk'
import { parseFit, unzipFit } from '../sync/fit.js'
import { buildDetail } from '../src/metrics/activity.js'
import { syntheticFit } from './synthetic-fit.js'

describe('fit interval merge', () => {
  const p = parseFit(unzipFit(zipSync({ '1_ACTIVITY.fit': syntheticFit() })))
  it('merges warmup/cooldown laps and keeps one row per rep', () => {
    expect(p.steps.map((s) => s.step_type)).toEqual(['warmup', 'active', 'recovery', 'active', 'recovery', 'active', 'recovery', 'rest', 'active', 'recovery', 'active', 'recovery', 'cooldown'])
    expect(p.steps[0]).toMatchObject({ duration_s: 120, distance_m: 400, avg_hr: 125, max_hr: 135 })
    expect(p.steps.at(-1)).toMatchObject({ duration_s: 120, avg_hr: 115 })
  })
  it('numbers sets and reps', () => {
    const act = p.steps.filter((s) => s.step_type === 'active')
    expect(act.map((s) => [s.set_no, s.rep_no])).toEqual([[1, 1], [1, 2], [1, 3], [2, 1], [2, 2]])
    expect(p.steps.find((s) => s.step_type === 'rest')!.set_no).toBeNull()
  })
  it('builds streams and session extras', () => {
    expect(p.streams.t.length).toBe(p.streams.hr.length)
    expect(p.streams.t[0]).toBe(0)
    expect(p.rpe).toBe(7)
  })
})

describe('running dynamics', () => {
  const fit = (dyn: boolean) => {
    const enc = new Encoder(), w = (n: number, m: object) => enc.onMesg(n, m as never), t0 = Date.UTC(2030, 0, 1)
    w(Profile.MesgNum.FILE_ID, { type: 'activity', manufacturer: 'development', product: 0, timeCreated: new Date(t0) })
    for (let i = 0; i < 400; i++)
      w(Profile.MesgNum.RECORD, { timestamp: new Date(t0 + i * 1000), heartRate: 150, cadence: 85, fractionalCadence: 0.5, power: 250,
        ...(dyn ? { stepLength: i === 3 ? 3379 : 1200, verticalOscillation: i === 4 ? 430 : 90, verticalRatio: 7.5, stanceTime: 240, stanceTimeBalance: 50.5 } : {}) })
    w(Profile.MesgNum.LAP, { timestamp: new Date(t0 + 4e5), startTime: new Date(t0), totalTimerTime: 400, totalDistance: 1000, intensity: 'active',
      ...(dyn ? { avgStepLength: 1200, avgVerticalOscillation: 90, avgVerticalRatio: 7.5, avgStanceTime: 240, avgStanceTimeBalance: 50.5 } : {}) })
    return parseFit(unzipFit(zipSync({ 'a.fit': enc.close() })))
  }
  it('scales to spm, m, mm, % and ms, drops glitches and averages', () => {
    const p = fit(true)
    expect(p.streams.cad[0]).toBe(171); expect(p.streams.pwr[0]).toBe(250)
    expect(p.streams.str[0]).toBeCloseTo(1.2); expect(p.streams.str[3]).toBeNull(); expect(p.streams.vo[4]).toBeNull()
    expect(p.dyn).toMatchObject({ avg_stride_m: expect.closeTo(1.2, 3), avg_vert_osc_mm: expect.closeTo(90, 3), avg_vert_ratio: 7.5, avg_gct_ms: 240, avg_gct_balance: 50.5 })
    expect(p.steps[0]).toMatchObject({ avg_stride_m: expect.closeTo(1.2, 3), avg_gct_ms: 240, avg_gct_balance: 50.5 })
    const d: any = buildDetail(p.streams)
    expect(d.str.length).toBe(300); expect(d.gct[0]).toBe(240); expect(d.vr[0]).toBe(7.5)
  })
  it('omits series and leaves averages null when the watch recorded none', () => {
    const p = fit(false), d: any = buildDetail(p.streams)
    expect(Object.values(p.dyn).every((v) => v == null)).toBe(true); expect(p.steps[0].avg_gct_ms).toBeNull()
    for (const k of ['str', 'vo', 'vr', 'gct', 'bal']) expect(d).not.toHaveProperty(k)
  })
})
