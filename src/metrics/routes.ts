// Route grouping, see docs/metrics.md "Routes". Pure, runs in the browser on routes/all.json.
export type RouteRun = [id: number, date: string, distance_m: number, duration_s: number, start: [number, number], pts: number[]]
export type RouteGroup = { n: number; med_m: number; best: RouteRun; last: RouteRun }

export const START_M = 150 // same route: start points within 150 m ...
export const DIST_TOL = 0.05 // ... and distance within 5% of the group's first run
export const MIN_M = 1000 // shorter runs are never grouped

const metres = (a: [number, number], b: [number, number]) => Math.hypot((a[0] - b[0]) * 111320, (a[1] - b[1]) * 111320 * Math.cos((a[0] * Math.PI) / 180))

/** Repeated routes (2 or more runs), most run first. Greedy and deterministic: runs go oldest first and join the first group they match.
 * ponytail: start point and distance only, the shape is not compared. Two different loops from one door with the same length are one route. */
export function groupRoutes(runs: RouteRun[]): RouteGroup[] {
  const gs: RouteRun[][] = []
  for (const r of [...runs].sort((a, b) => (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : a[0] - b[0]))) {
    if (r[2] < MIN_M) continue
    const g = gs.find(([l]) => metres(l[4], r[4]) <= START_M && Math.abs(r[2] - l[2]) <= DIST_TOL * l[2])
    if (g) g.push(r); else gs.push([r])
  }
  return gs.filter((g) => g.length > 1).map((g) => {
    const d = g.map((r) => r[2]).sort((a, b) => a - b), timed = g.filter((r) => r[3] > 0)
    return { n: g.length, med_m: d[d.length >> 1], best: timed.reduce((b, r) => (r[3] < b[3] ? r : b), timed[0] ?? g[0]), last: g.at(-1)! }
  }).sort((a, b) => b.n - a.n || (a.last[1] < b.last[1] ? 1 : -1))
}
