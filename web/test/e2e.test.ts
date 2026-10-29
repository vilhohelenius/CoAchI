// @vitest-environment happy-dom
// Mounts the real App in a DOM, drives it by hash routes, serves web/fixtures through a fake fetch.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { h, render } from 'preact'
import { App } from '../src/app'
import { readFileSync } from 'node:fs'

const fx = (n: string) => readFileSync(`web/fixtures/${n}.json`, 'utf8')
const fixtureFor = (u: URL) => {
  const by = u.searchParams.get('by'), p = u.pathname
  return p === '/api/mileage' ? `mileage-${by === 'month' || by === 'year' ? by : 'week'}` : p === '/api/mileage/compare' ? 'mileage-compare' : p === '/api/activities' ? 'activities' : p === '/api/steps' ? 'steps' : p === '/api/records' ? 'records' : p === '/api/routes' ? 'routes' : p === '/api/fitness-estimates' ? 'fitness-estimates'
    : /^\/api\/activities\/\d+$/.test(p) ? (p.endsWith('/97') ? 'activity-strength' : 'activity-run') : /^\/api\/(today|goals|load|recovery|intensity|dynamics)$/.exec(p)?.[1]
}
let fail: (u: URL) => boolean, root: HTMLElement
const settle = () => vi.waitFor(() => expect(root.querySelector('[aria-busy]')).toBeNull())
const go = async (hash: string) => { location.hash = hash; await vi.waitFor(() => expect(root.querySelector('.nav [aria-current]')?.getAttribute('href')).toBe(`#/${hash.replace(/^#?\/?/, '').split('/')[0]}`)); await settle() }

beforeEach(async () => {
  fail = () => false; location.hash = '#/today'
  vi.stubGlobal('fetch', async (url: string) => {
    const u = new URL(url, 'http://x'), f = fixtureFor(u)
    if (fail(u)) return new Response('{}', { status: 500 })
    if (u.pathname === '/api/status') return Response.json({ sync: { last_ok: null, last_error: null }, counts: { activities: 0 }, garmin_key: { expires_on: null, days_left: null, banner: false }, pat: { expires_on: null, days_left: null, banner: false } })
    return f ? new Response(fx(f), { headers: { 'content-type': 'application/json' } }) : new Response('{}', { status: 404 })
  })
  root = document.body.appendChild(document.createElement('div'))
  render(h(App, {}), root)
  await new Promise((r) => setTimeout(r, 20)) // let the old hashchange from the reset drain
})
afterEach(() => { render(null, root); root.remove(); vi.unstubAllGlobals() })

describe('frontend end to end', () => {
  it('every route renders data and the nav marks the current page', async () => {
    await settle()
    for (const r of ['today', 'load', 'recovery', 'intensity', 'dynamics', 'goals', 'mileage', 'steps', 'records', 'heatmap', 'activities', 'activities/100', 'activities/97', 'settings']) {
      await go(`#/${r}`)
      expect(root.querySelector('h1')?.textContent, r).toBeTruthy()
      expect(root.querySelector('.err'), r).toBeNull()
      expect(root.textContent, r).not.toMatch(/NaN|undefined/)
    }
  })
  it('opening an activity from the list shows its detail, and Back returns to the list', async () => {
    await go('#/activities')
    expect(root.querySelector('.arow')).toBeTruthy(); expect(root.querySelector('.glance')).toBeNull()
    await go('#/activities/100')
    await vi.waitFor(() => expect(root.querySelector('.glance')).toBeTruthy())
    await go('#/activities')
    await vi.waitFor(() => expect(root.querySelector('.arow')).toBeTruthy())
  })
  it('phone drawer lists every view and closes on Escape, theme toggle sets data-mode', async () => {
    await settle()
    const more = root.querySelector('.tabs button') as HTMLButtonElement
    expect(root.querySelector('.drawer')).toBeNull()
    more.click()
    await vi.waitFor(() => expect(root.querySelector('.drawer [role=dialog]')).not.toBeNull())
    expect(root.querySelectorAll('.drawer a').length).toBe(root.querySelectorAll('.side a').length)
    dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await vi.waitFor(() => expect(root.querySelector('.drawer')).toBeNull())
    const flip = () => (root.querySelector('.side .mode') as HTMLButtonElement).click()
    flip() // auto -> light
    await vi.waitFor(() => expect(root.querySelector('.side .mode')?.textContent).toContain('light'))
    flip() // -> dark
    await vi.waitFor(() => expect(document.documentElement.dataset.mode).toBe('dark'))
    flip() // -> auto
    await vi.waitFor(() => expect(root.querySelector('.side .mode')?.textContent).toContain('auto'))
  })
  it('goals form refuses incomplete numbers without calling the server', async () => {
    await go('#/goals')
    ;(root.querySelector('form button[type=submit]') as HTMLButtonElement).click()
    await vi.waitFor(() => expect(root.querySelector('form [role=status]')?.textContent).toContain('Check the numbers'))
  })
  it('heatmap year filter redraws the lines', async () => {
    await go('#/heatmap')
    const n = () => root.querySelectorAll('svg.map path').length
    expect(n()).toBe(8)
    const btn = [...root.querySelectorAll('.seg button')].find((b) => b.textContent === '2029') as HTMLButtonElement
    btn.click()
    await vi.waitFor(() => expect(n()).toBe(3))
    expect(root.querySelector('.seg [aria-pressed=true]')?.textContent).toBe('2029')
  })
  it('unknown route falls back to Today', async () => {
    location.hash = '#/nope'
    await vi.waitFor(() => expect(root.querySelector('.nav [aria-current]')?.textContent).toBe('Today'))
  })
  it('a 500 shows the error card and Try again recovers', async () => {
    fail = (u) => u.pathname === '/api/load'
    location.hash = '#/load'
    await vi.waitFor(() => expect(root.querySelector('.err')?.textContent).toContain('The server answered 500'))
    fail = () => false
    ;(root.querySelector('.err button') as HTMLButtonElement).click()
    await vi.waitFor(() => expect(root.querySelector('.err')).toBeNull())
    await settle()
    expect(root.textContent).toContain('Fitness and fatigue')
  })
})
