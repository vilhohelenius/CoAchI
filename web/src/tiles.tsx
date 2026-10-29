import { useEffect, useRef, useState } from 'preact/hooks'
import type { ComponentChildren } from 'preact'

// OpenStreetMap raster tiles behind an SVG route. Needs no key; the tile usage policy asks for attribution and a Referer, which the browser sends.
const MAXZ = 17, MAXT = 12
const mx = (lon: number) => (lon + 180) / 360
const my = (lat: number) => { const s = Math.sin((lat * Math.PI) / 180); return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI) }
export type Tile = { url: string; x: number; y: number; size: number }

export type View = { k: number; x: number; y: number } // screen = base * k + (x, y), in the map's w x h units
export const V0: View = { k: 1, x: 0, y: 0 }
export const MAXK = 64
/** Shift the view by (dx, dy), never letting the box leave the screen. */
export const panView = (v: View, dx: number, dy: number, w: number, h: number): View => ({ k: v.k, x: Math.min(0, Math.max(w * (1 - v.k), v.x + dx)), y: Math.min(0, Math.max(h * (1 - v.k), v.y + dy)) })
/** Zoom to scale k2 (clamped to 1..MAXK) keeping the box point (cx, cy) under the finger or cursor. */
export function zoomView(v: View, k2: number, cx: number, cy: number, w: number, h: number): View {
  const k = Math.min(MAXK, Math.max(1, k2)), r = k / v.k
  return panView({ k, x: cx - (cx - v.x) * r, y: cy - (cy - v.y) * r }, 0, 0, w, h)
}

/** Tiles at the finest zoom whose cover of the w x h screen is at most 12. Mercator unit x0,y0 sits at screen (ox, oy), one unit is s pixels. */
function cover(ox: number, oy: number, x0: number, y0: number, s: number, w: number, h: number): Tile[] {
  const lo = (v: number, o: number, n: number, a: number) => Math.max(0, Math.min(n - 1, Math.floor((a + (v - o) / s) * n)))
  for (let z = MAXZ; z >= 0; z--) {
    const n = 2 ** z, ax = lo(0, ox, n, x0), bx = lo(w, ox, n, x0), ay = lo(0, oy, n, y0), by = lo(h, oy, n, y0)
    if (z && (bx - ax + 1) * (by - ay + 1) > MAXT) continue
    const tiles: Tile[] = []
    for (let tx = ax; tx <= bx; tx++) for (let ty = ay; ty <= by; ty++) tiles.push({ url: `https://tile.openstreetmap.org/${z}/${tx}/${ty}.png`, x: ox + (tx / n - x0) * s, y: oy + (ty / n - y0) * s, size: s / n })
    return tiles
  }
  return []
}

/** Web Mercator fit of lat/lon points into a w x h box (so the line matches the tiles). `P` projects a point at zoom 1, `at(view)` gives the at most 12 tiles covering the box for a zoomed and panned view. `q` clips that share of extremes off each side of the bounds. */
export function mapFit(pts: [number, number][], w: number, h: number, pad = 14, q = 0) {
  const span = (v: number[]) => { const o = v.sort((a, b) => a - b); return [o[Math.floor(q * (o.length - 1))], o[Math.ceil((1 - q) * (o.length - 1))]] }
  const [x0, x1] = span(pts.map((p) => mx(p[1]))), [y0, y1] = span(pts.map((p) => my(p[0])))
  const s = Math.min((w - 2 * pad) / (x1 - x0 || 1e-9), (h - 2 * pad) / (y1 - y0 || 1e-9), 128 * 2 ** MAXZ), ox = pad + (w - 2 * pad - (x1 - x0) * s) / 2, oy = pad + (h - 2 * pad - (y1 - y0) * s) / 2
  const P = (p: [number, number]) => [ox + (mx(p[1]) - x0) * s, oy + (my(p[0]) - y0) * s] as [number, number]
  const at = (v: View) => cover(v.x + ox * v.k, v.y + oy * v.k, x0, y0, s * v.k, w, h)
  return { P, at, tiles: at(V0), w, h, g: { s, ox, oy, x0, y0 } }
}
export type Fit = ReturnType<typeof mapFit>
/** The view of `full` that shows exactly what `dense` (a tighter fit of the same points) shows, so a map can open on the busy part and still zoom out to everything. */
export function focusView(full: Fit, dense: Fit): View {
  const f = full.g, d = dense.g, k = d.s / f.s
  return zoomView({ k, x: d.ox - f.ox * k - (d.x0 - f.x0) * d.s, y: d.oy - f.oy * k - (d.y0 - f.y0) * d.s }, k, 0, 0, full.w, full.h)
}

/** The map box with drag, wheel, pinch, double click and +/- zoom. Tiles load once it is near the screen, and if every tile fails the box is just the plain background and route. `children(on, k)` draws the route in zoom 1 coordinates (strokes keep their width), `on` says whether tiles are showing and `k` is the zoom for sizing markers. */
export function TileMap({ fit, start, label, children }: { fit: Fit; start?: View; label: string; children: (on: boolean, k: number) => ComponentChildren }) {
  const { w, h } = fit, ref = useRef<HTMLDivElement>(null), svg = useRef<SVGSVGElement>(null), ptr = useRef(new Map<number, [number, number]>())
  const [seen, setSeen] = useState(false), [bad, setBad] = useState<string[]>([]), [v, setV] = useState(start ?? V0)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') { setSeen(true); return }
    const io = new IntersectionObserver((e) => { if (e.some((x) => x.isIntersecting)) { setSeen(true); io.disconnect() } }, { rootMargin: '200px' })
    io.observe(el); return () => io.disconnect()
  }, [])
  const u = (e: MouseEvent): [number, number] => { const r = svg.current!.getBoundingClientRect(); return [((e.clientX - r.left) * w) / r.width, ((e.clientY - r.top) * h) / r.height] }
  const zoom = (f: number, c: [number, number] = [w / 2, h / 2]) => setV((x) => zoomView(x, x.k * f, c[0], c[1], w, h))
  useEffect(() => {
    const el = svg.current; if (!el) return
    const f = (e: WheelEvent) => { if (!e.ctrlKey && !e.metaKey) return; e.preventDefault(); zoom(Math.exp(-e.deltaY * (e.deltaMode ? 0.05 : 0.002)), u(e)) }
    el.addEventListener('wheel', f, { passive: false }); return () => el.removeEventListener('wheel', f)
  }, [w, h])
  const move = (e: PointerEvent) => {
    const m = ptr.current, o = [...m.values()]; if (!m.has(e.pointerId)) return
    const p = u(e); m.set(e.pointerId, p); const n = [...m.values()]
    if (n.length === 1) setV((x) => panView(x, p[0] - o[0][0], p[1] - o[0][1], w, h))
    else if (n.length === 2) zoom(Math.hypot(n[0][0] - n[1][0], n[0][1] - n[1][1]) / (Math.hypot(o[0][0] - o[1][0], o[0][1] - o[1][1]) || 1), [(n[0][0] + n[1][0]) / 2, (n[0][1] + n[1][1]) / 2])
  }
  const tiles = fit.at(v), on = seen && tiles.some((t) => !bad.includes(t.url))
  return <div ref={ref} class="mapw">
    <svg ref={svg} class={`map zm${v.k > 1 ? ' on' : ''}`} style="height:auto" viewBox={`0 0 ${w} ${h}`} role="img" aria-label={label}
      onPointerDown={(e) => { (e.currentTarget as Element).setPointerCapture?.(e.pointerId); ptr.current.set(e.pointerId, u(e)) }} onPointerMove={move}
      onPointerUp={(e) => ptr.current.delete(e.pointerId)} onPointerCancel={(e) => ptr.current.delete(e.pointerId)} onDblClick={(e) => zoom(2, u(e))}>
      <rect width={w} height={h} fill="var(--m-bg)" />
      {on && <g>{tiles.map((t) => <image key={t.url} href={t.url} x={t.x} y={t.y} width={t.size + 0.5} height={t.size + 0.5} onError={() => setBad((b) => [...b, t.url])} />)}</g>}
      <g class="vw" transform={`translate(${v.x} ${v.y}) scale(${v.k})`}>{children(on, v.k)}</g></svg>
    <div class="zb"><button type="button" aria-label="Zoom in" disabled={v.k >= MAXK} onClick={() => zoom(2)}>+</button><button type="button" aria-label="Zoom out" disabled={v.k <= 1} onClick={() => zoom(0.5)}>{'\u2212'}</button></div>
    {on && <a class="attr" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a>}
  </div>
}
