import { useEffect, useRef, useState } from 'preact/hooks'
import type { ComponentChildren } from 'preact'

// OpenStreetMap raster tiles behind an SVG route. Needs no key; the tile usage policy asks for attribution and a Referer, which the browser sends.
const MAXZ = 17, MAXT = 12
const mx = (lon: number) => (lon + 180) / 360
const my = (lat: number) => { const s = Math.sin((lat * Math.PI) / 180); return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI) }
export type Tile = { url: string; x: number; y: number; size: number }

/** Web Mercator fit of lat/lon points into a w x h box (so the line matches the tiles), plus the at most 12 tiles that cover the box. `q` clips that share of extremes off each side of the bounds. */
export function mapFit(pts: [number, number][], w: number, h: number, pad = 14, q = 0) {
  const span = (v: number[]) => { const o = v.sort((a, b) => a - b); return [o[Math.floor(q * (o.length - 1))], o[Math.ceil((1 - q) * (o.length - 1))]] }
  const [x0, x1] = span(pts.map((p) => mx(p[1]))), [y0, y1] = span(pts.map((p) => my(p[0])))
  const s = Math.min((w - 2 * pad) / (x1 - x0 || 1e-9), (h - 2 * pad) / (y1 - y0 || 1e-9), 128 * 2 ** MAXZ), ox = pad + (w - 2 * pad - (x1 - x0) * s) / 2, oy = pad + (h - 2 * pad - (y1 - y0) * s) / 2
  const P = (p: [number, number]) => [ox + (mx(p[1]) - x0) * s, oy + (my(p[0]) - y0) * s] as [number, number]
  const lo = (v: number, o: number, n: number, a: number) => Math.max(0, Math.min(n - 1, Math.floor((a + (v - o) / s) * n)))
  for (let z = MAXZ; z >= 0; z--) {
    const n = 2 ** z, ax = lo(0, ox, n, x0), bx = lo(w, ox, n, x0), ay = lo(0, oy, n, y0), by = lo(h, oy, n, y0)
    if (z && (bx - ax + 1) * (by - ay + 1) > MAXT) continue
    const tiles: Tile[] = []
    for (let tx = ax; tx <= bx; tx++) for (let ty = ay; ty <= by; ty++) tiles.push({ url: `https://tile.openstreetmap.org/${z}/${tx}/${ty}.png`, x: ox + (tx / n - x0) * s, y: oy + (ty / n - y0) * s, size: s / n })
    return { P, tiles }
  }
  return { P, tiles: [] as Tile[] }
}

/** The map box. Tiles load once it is near the screen, and if every tile fails the box is just the plain background and route. `children(on)` draws the route, `on` says whether tiles are showing. */
export function TileMap({ w, h, tiles, label, children }: { w: number; h: number; tiles: Tile[]; label: string; children: (on: boolean) => ComponentChildren }) {
  const ref = useRef<HTMLDivElement>(null), [seen, setSeen] = useState(false), [bad, setBad] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') { setSeen(true); return }
    const io = new IntersectionObserver((e) => { if (e.some((x) => x.isIntersecting)) { setSeen(true); io.disconnect() } }, { rootMargin: '200px' })
    io.observe(el); return () => io.disconnect()
  }, [])
  const on = seen && tiles.length > 0 && bad < tiles.length
  return <div ref={ref} class="mapw">
    <svg class="map" style="height:auto" viewBox={`0 0 ${w} ${h}`} role="img" aria-label={label}><rect width={w} height={h} fill="var(--m-bg)" />
      {on && <g>{tiles.map((t) => <image href={t.url} x={t.x} y={t.y} width={t.size + 0.5} height={t.size + 0.5} onError={() => setBad((b) => b + 1)} />)}</g>}
      {children(on)}</svg>
    {on && <a class="attr" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a>}
  </div>
}
