import { describe, expect, it } from 'vitest'
import { zipSync } from 'fflate'
import { parseFit, unzipFit } from '../sync/fit.js'
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
