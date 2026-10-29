// Hand-written SVG charts. Pure helpers first (tested), then two components: lines with an optional band, and stacked bars.
// Both are index based on x (one point per day or week), show a tooltip on hover or tap, and carry a hidden text summary.
import type { ComponentChildren } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import { DASH, day, num } from './fmt'

export type Num = number | null | undefined
const fin = (v: Num): v is number => typeof v === 'number' && Number.isFinite(v)

/** Linear scale. A flat domain maps to the middle of the range so a single point still draws. */
export const scale = (d0: number, d1: number, r0: number, r1: number) => (v: number) => (d1 === d0 ? (r0 + r1) / 2 : r0 + ((v - d0) * (r1 - r0)) / (d1 - d0))
export function extent(...arrs: Num[][]): [number, number] | null {
  let lo = Infinity, hi = -Infinity
  for (const a of arrs) for (const v of a) if (fin(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v) }
  return lo > hi ? null : [lo, hi]
}
/** Round tick values covering [lo, hi]. */
export function ticks(lo: number, hi: number, n = 4): number[] {
  if (hi === lo) return [lo]
  const raw = (hi - lo) / n, p = 10 ** Math.floor(Math.log10(raw)), f = raw / p, step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p
  const out: number[] = []
  for (let t = Math.ceil(lo / step) * step; t <= hi + 1e-9; t += step) out.push(+t.toFixed(10))
  return out
}
/** Path through the points, lifting the pen at nulls. A lone point becomes a zero-length segment that a round cap draws as a dot. */
export function linePath(xs: number[], ys: Num[]): string {
  let d = '', pen = false
  ys.forEach((y, i) => {
    if (!fin(y)) { pen = false; return }
    const nb = fin(ys[i - 1]) || fin(ys[i + 1])
    d += `${pen ? 'L' : 'M'}${xs[i].toFixed(1)} ${y.toFixed(1)}${nb ? '' : 'l0 0'}`
    pen = true
  })
  return d
}
/** Filled band between two series, one polygon per unbroken run. */
export function bandPath(xs: number[], lo: Num[], hi: Num[]): string {
  let d = '', run: number[] = []
  const flush = () => {
    if (run.length > 1) d += 'M' + run.map((i) => `${xs[i].toFixed(1)} ${(hi[i] as number).toFixed(1)}`).join('L') + 'L' + [...run].reverse().map((i) => `${xs[i].toFixed(1)} ${(lo[i] as number).toFixed(1)}`).join('L') + 'Z'
    run = []
  }
  xs.forEach((_, i) => (fin(lo[i]) && fin(hi[i]) ? run.push(i) : flush()))
  flush()
  return d
}
/** Segment edges for one stacked bar: [from, to] per value, negatives and nulls count as zero. */
export const stack = (vals: Num[]): [number, number][] => { let a = 0; return vals.map((v) => { const b = a + (fin(v) && v > 0 ? v : 0); const s: [number, number] = [a, b]; a = b; return s }) }

/** One sentence for screen readers: latest value, and whether it moved against the series average. */
export function summarize(name: string, dates: string[], v: Num[], f: (n: number) => string = (n) => num(n, 1), unit = ''): string {
  let i = v.length - 1
  while (i >= 0 && !fin(v[i])) i--
  if (i < 0) return `${name}: no data.`
  const vals = v.filter(fin), avg = vals.reduce((s, x) => s + x, 0) / vals.length, last = v[i] as number
  const t = vals.length < 3 ? '' : Math.abs(last - avg) <= Math.abs(avg) * 0.03 ? ', about the same as the average' : last > avg ? ', above the average' : ', below the average'
  return `${name}: latest ${f(last)}${unit} on ${day(dates[i], { day: 'numeric', month: 'long' })}${t}, from ${vals.length} readings.`
}

function useWidth() {
  const ref = useRef<HTMLDivElement>(null), [w, setW] = useState(640)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => setW(Math.max(240, Math.round(el.clientWidth))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w] as const
}

const ML = 4, MR = 44, MT = 12, MB = 22
type Frame = { dates: string[]; xf?: (d: string) => string; h?: number; yfmt?: (n: number) => string; unit?: string; summary: string; tip?: (i: number) => string[]; label: string }
export type Series = { name: string; v: Num[]; c: string; w?: number; dash?: string }

/** Shared frame: size measuring, axes, hover state, tooltip, hidden summary. `draw` gets the scales. */
function Frame(p: Frame & { bars?: boolean; n: number; y0: number; y1: number; yt: number[]; draw: (X: (i: number) => number, Y: (v: number) => number, w: number) => ComponentChildren; lines: (i: number) => string[]; legend?: ComponentChildren }) {
  const [ref, w] = useWidth(), [hov, setHov] = useState<number | null>(null)
  const h = p.h ?? 200, n = p.n, X = (i: number) => (p.bars ? ML + ((i + 0.5) * (w - ML - MR)) / n : n < 2 ? (ML + w - MR) / 2 : ML + (i / (n - 1)) * (w - ML - MR)), Y = scale(p.y0, p.y1, h - MB, MT)
  const at = (e: PointerEvent) => {
    const r = (e.currentTarget as SVGElement).getBoundingClientRect(), x = ((e.clientX - r.left) / r.width) * w
    const f = ((x - ML) / (w - ML - MR)) * (p.bars ? n : n - 1)
    setHov(n < 2 ? 0 : Math.max(0, Math.min(n - 1, p.bars ? Math.floor(f) : Math.round(f))))
  }
  const xt = n < 2 ? [0] : [0, Math.round((n - 1) / 2), n - 1], fy = p.yfmt ?? ((v: number) => num(v))
  const hx = hov == null ? 0 : X(hov)
  return <div class="cvw" ref={ref}>
    <svg class="cv" viewBox={`0 0 ${w} ${h}`} role="img" aria-label={p.label} onPointerMove={at} onPointerDown={at} onPointerLeave={(e) => e.pointerType === 'mouse' && setHov(null)}>
      {p.yt.map((v) => <><line class="gl" x1={ML} x2={w - MR} y1={Y(v)} y2={Y(v)} /><text x={w - MR + 6} y={Y(v) + 4}>{fy(v)}</text></>)}
      {p.n > 0 && xt.map((i, k) => <text x={X(i)} y={h - 5} text-anchor={k === 0 && xt.length > 1 ? 'start' : k === xt.length - 1 && xt.length > 1 ? 'end' : 'middle'}>{(p.xf ?? ((d) => day(d, { day: 'numeric', month: 'short' })))(p.dates[i])}</text>)}
      {p.draw(X, Y, w)}
      {hov != null && <line x1={hx} x2={hx} y1={MT} y2={h - MB} stroke="var(--mute)" stroke-dasharray="3 4" />}
    </svg>
    {hov != null && <div class="tip" role="presentation" style={`left:${hx}px;transform:translateX(${hx > w / 2 ? '-100%' : '0'})`}>{p.lines(hov).map((l, i) => <span class={i ? '' : 'tt'}>{l}</span>)}</div>}
    {p.legend}
    <p class="sr">{p.summary}</p>
  </div>
}

export function LineChart(p: Frame & { series: Series[]; band?: { lo: Num[]; hi: Num[] }; include?: number[]; pad?: number; vline?: number }) {
  const n = p.dates.length
  const ex = extent(...p.series.map((s) => s.v), p.band?.lo ?? [], p.band?.hi ?? [], p.include ?? [])
  if (!ex) return <p class="empty">{p.summary}</p>
  const pad = (ex[1] - ex[0]) * 0.08 || 1, y0 = ex[0] - pad, y1 = ex[1] + pad
  const lines = p.tip ?? ((i: number) => [day(p.dates[i], { weekday: 'short', day: 'numeric', month: 'short' }), ...p.series.map((s) => `${s.name} ${fin(s.v[i]) ? (p.yfmt ?? ((v: number) => num(v, 1)))(s.v[i] as number) + (p.unit ?? '') : DASH}`)])
  return <Frame {...p} n={n} y0={y0} y1={y1} yt={ticks(y0, y1, 4)} lines={lines}
    legend={p.series.length > 1 && <div class="legend">{p.series.map((s) => <span><i style={`background:${s.c}`} />{s.name}</span>)}</div>}
    draw={(X, Y) => {
      const xs = p.dates.map((_, i) => X(i))
      return <>
        {p.band && <path d={bandPath(xs, p.band.lo.map((v) => (fin(v) ? Y(v) : null)), p.band.hi.map((v) => (fin(v) ? Y(v) : null)))} fill="var(--ok)" opacity=".18" />}
        {p.vline != null && <line x1={X(p.vline)} x2={X(p.vline)} y1={MT} y2={(p.h ?? 200) - MB} stroke="var(--line)" />}
        {p.series.map((s) => <path d={linePath(xs, s.v.map((v) => (fin(v) ? Y(v) : null)))} fill="none" stroke={s.c} stroke-width={s.w ?? 2.2} stroke-linejoin="round" stroke-linecap="round" stroke-dasharray={s.dash} />)}
      </>
    }} />
}

export type Stack = { name: string; c: string; hide?: boolean }
/** vals[bar][segment]. A hidden segment (a spacer under a floating range bar) is drawn invisible and left out of the tooltip. */
export function StackedBars(p: Frame & { stacks: Stack[]; vals: Num[][]; top?: number; legend?: boolean }) {
  const n = p.dates.length, tot = p.vals.map((r) => stack(r)[r.length - 1]?.[1] ?? 0), hi = p.top ?? Math.max(1, ...tot)
  if (!n || !tot.some((t) => t > 0)) return <p class="empty">{p.summary}</p>
  const lines = p.tip ?? ((i: number) => [day(p.dates[i], { weekday: 'short', day: 'numeric', month: 'short' }), ...p.stacks.map((s, k) => (s.hide ? '' : `${s.name} ${fin(p.vals[i][k]) ? (p.yfmt ?? ((v: number) => num(v)))(p.vals[i][k] as number) + (p.unit ?? '') : DASH}`)).filter(Boolean)])
  return <Frame {...p} bars n={n} y0={0} y1={hi} yt={ticks(0, hi, 4)} lines={lines}
    legend={p.legend !== false && <div class="legend">{p.stacks.filter((s) => !s.hide).map((s) => <span><i style={`background:${s.c}`} />{s.name}</span>)}</div>}
    draw={(X, Y, w) => {
      const bw = Math.max(2, Math.min(40, ((w - ML - MR) / n) * 0.7))
      return p.vals.map((r, i) => stack(r).map(([a, b], k) => b > a && !p.stacks[k].hide && <rect x={X(i) - bw / 2} y={Y(b)} width={bw} height={Math.max(1, Y(a) - Y(b))} rx={Math.min(3, bw / 2)} fill={p.stacks[k].c} />))
    }} />
}
