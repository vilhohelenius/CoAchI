import type { ComponentChildren } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'

type Item = { label: string; node: () => ComponentChildren }
const PAD = 12 // matches .car padding-left

/** Narrow screens: one full-width tile per swipe, looping last to first through two inert clones.
 *  Wide screens: a plain grid (CSS hides clones and dots). */
export function Carousel({ items }: { items: Item[] }) {
  const car = useRef<HTMLDivElement>(null)
  const [cur, setCur] = useState(0)
  const n = items.length
  useEffect(() => {
    const el = car.current!, mq = matchMedia('(max-width:899px)'), rm = matchMedia('(prefers-reduced-motion:reduce)')
    const slides = () => [...el.children] as HTMLElement[]
    const left = (k: number) => slides()[k].offsetLeft - PAD
    const to = (k: number, smooth: boolean) => el.scrollTo({ left: left(k), behavior: smooth && !rm.matches ? 'smooth' : 'instant' })
    const idx = () => slides().reduce((b, s, i) => (Math.abs(s.offsetLeft - PAD - el.scrollLeft) < Math.abs(slides()[b].offsetLeft - PAD - el.scrollLeft) ? i : b), 0)
    const real = () => (idx() - 1 + n) % n
    const start = () => mq.matches && to(1, false)
    start()
    let raf = 0, jt = 0
    const onScroll = () => {
      cancelAnimationFrame(raf); raf = requestAnimationFrame(() => setCur(real()))
      clearTimeout(jt); jt = window.setTimeout(() => { const k = idx(); if (k === 0) to(n, false); else if (k === n + 1) to(1, false) }, 90)
    }
    const onKey = (e: KeyboardEvent) => {
      const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
      if (d) { e.preventDefault(); to(idx() + d, true) }
    }
    ;(el as any).__go = (i: number) => { const d = i - real(); to(idx() + (d === n - 1 ? -1 : d === 1 - n ? 1 : d), true) }
    el.addEventListener('scroll', onScroll, { passive: true }); el.addEventListener('keydown', onKey)
    addEventListener('resize', start)
    return () => { el.removeEventListener('scroll', onScroll); el.removeEventListener('keydown', onKey); removeEventListener('resize', start); clearTimeout(jt); cancelAnimationFrame(raf) }
  }, [n])
  const clone = (i: number, k: string) => <div class="slide clone" key={k} aria-hidden="true" {...({ inert: true } as object)}>{items[i].node()}</div>
  return <div class="carw">
    <div class="car" ref={car} tabIndex={0} role="region" aria-roledescription="carousel" aria-label="Today summary, swipe for more">
      {clone(n - 1, 'cl')}
      {items.map((it) => <div class="slide" key={it.label}>{it.node()}</div>)}
      {clone(0, 'cf')}
    </div>
    <div class="dots">{items.map((it, i) => <button type="button" aria-label={`Show ${it.label}, ${i + 1} of ${n}`} aria-current={cur === i} onClick={() => (car.current as any)?.__go(i)} />)}</div>
  </div>
}
