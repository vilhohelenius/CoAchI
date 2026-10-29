import { describe, expect, it } from 'vitest'
import { V0, MAXK, mapFit, panView, zoomView } from '../src/tiles'

describe('map zoom and pan', () => {
  const pts: [number, number][] = [[50, 8], [50.02, 8.03], [50.01, 8.01]]
  it('zoom keeps the point under the cursor fixed and clamps', () => {
    const v = zoomView(V0, 4, 100, 60, 300, 190)
    expect(v.k).toBe(4); expect(100 * v.k + v.x).toBeCloseTo(100); expect(60 * v.k + v.y).toBeCloseTo(60) // the point under the cursor stays put
    expect(zoomView(V0, 0.1, 0, 0, 300, 190)).toEqual(V0)
    expect(zoomView(V0, 1e6, 0, 0, 300, 190).k).toBe(MAXK)
    const p = panView(v, 1e5, -1e5, 300, 190); expect(p.x).toBe(0); expect(p.y).toBe(190 * (1 - 4))
  })
  it('tiles follow the zoom, stay within 12 and cover the box', () => {
    const m = mapFit(pts, 300, 190), z = (u: string) => Number(u.split('/')[3])
    const a = m.at(V0), b = m.at(zoomView(V0, 16, 150, 95, 300, 190))
    expect(a.length).toBeLessThanOrEqual(12); expect(b.length).toBeLessThanOrEqual(12)
    expect(z(b[0].url)).toBeGreaterThanOrEqual(z(a[0].url)) // zooming in never picks coarser tiles
    expect(Math.min(...b.map((t) => t.x))).toBeLessThanOrEqual(0); expect(Math.max(...b.map((t) => t.x + t.size))).toBeGreaterThanOrEqual(300)
    expect(m.at(V0)).toEqual(m.tiles)
  })
})
