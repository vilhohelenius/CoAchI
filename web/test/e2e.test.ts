// @vitest-environment happy-dom
// Mounts the real App in a DOM, drives it by hash routes, serves web/fixtures through a fake fetch.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { h, render } from 'preact'
import { App } from '../src/app'
import { readFileSync } from 'node:fs'

const fx = (n: string) => readFileSync(`web/fixtures/${n}.json`, 'utf8')
const fixtureFor = (u: URL) => {
  const by = u.searchParams.get('by'), p = u.pathname
  return p === '/api/mileage' ? `mileage-${by === 'month' || by === 'year' ? by : 'week'}` : p === '/api/mileage/compare' ? 'mileage-compare' : p === '/api/activities' ? 'activities' : p === '/api/steps' ? 'steps' : p === '/api/records' ? 'records' : p === '/api/routes' ? 'routes' : p === '/api/shoes' ? 'shoes' : p === '/api/fitness-estimates' ? 'fitness-estimates'
    : /^\/api\/activities\/\d+$/.test(p) ? (p.endsWith('/97') ? 'activity-strength' : 'activity-run') : /^\/api\/(today|goals|load|recovery|intensity|dynamics)$/.exec(p)?.[1]
}
let fail: (u: URL) => boolean, root: HTMLElement
const settle = () => vi.waitFor(() => expect(root.querySelector('[aria-busy]')).toBeNull())
const go = async (hash: string) => { location.hash = hash; await vi.waitFor(() => expect(root.querySelector('.nav [aria-current]')?.getAttribute('href')).toBe(`#/${hash.replace(/^#?\/?/, '').split('/')[0].replace(/^(load|recovery|intensity|dynamics)$/, 'insights')}`)); await settle() }

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
    for (const r of ['today', 'load', 'recovery', 'intensity', 'dynamics', 'insights', ...['status', 'sleep', 'recovery', 'hrv', 'rhr', 'battery', 'load', 'intensity', 'forecast', 'dynamics'].map((k) => 'insights/' + k), 'goals', 'mileage', 'steps', 'records', 'heatmap', 'shoes', 'activities', 'activities/100', 'activities/97', 'settings']) {
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
    expect(root.querySelector('[aria-label=Year] [aria-pressed=true]')?.textContent).toBe('2029')
    ;([...root.querySelectorAll('.seg button')].find((b) => b.textContent === 'Rides') as HTMLButtonElement).click() // the fixture has no rides
    await vi.waitFor(() => expect(n()).toBe(0))
  })
  it('shoes page lists cards and the retired one, the picker on a run saves with PATCH', async () => {
    await go('#/shoes')
    expect(root.querySelectorAll('.card .big').length).toBe(3)
    expect(root.textContent).toContain('Nearly worn out'); expect(root.textContent).toContain('Retired')
    const calls: [string, string, string][] = []
    const real = fetch
    vi.stubGlobal('fetch', async (u: string, i?: RequestInit) => { if (i?.method) { calls.push([u, i.method, String(i.body)]); return Response.json({ ok: true }) } return real(u, i) })
    await go('#/activities/100')
    const sel = await vi.waitFor(() => { const e = root.querySelector('select'); expect(e).toBeTruthy(); return e as HTMLSelectElement })
    expect([...sel.options].map((o) => o.textContent)).toEqual(['No shoe', 'Daily Trainer', 'Tempo Racer']) // retired shoes are not offered
    sel.value = '2'; sel.dispatchEvent(new Event('change'))
    await vi.waitFor(() => expect(calls).toEqual([['/api/activities/100', 'PATCH', '{"shoe_id":2}']]))
    await vi.waitFor(() => expect(root.textContent).toContain('of 500 km'))
  })
  it('insights hub links every sub page, Explain this opens its text, and the back link returns', async () => {
    await go('#/insights')
    await vi.waitFor(() => expect(root.querySelectorAll('a.ixc').length).toBe(10))
    expect([...root.querySelectorAll('a.ixc')].map((a) => a.getAttribute('href'))).toContain('#/insights/hrv')
    await go('#/insights/hrv')
    await vi.waitFor(() => expect(root.querySelector('.xp')).toBeTruthy())
    expect(root.querySelector('.ex')).toBeNull()
    ;(root.querySelector('.xp') as HTMLButtonElement).click()
    await vi.waitFor(() => expect(root.querySelector('.ex')?.textContent).toMatch(/ms/))
    expect(root.querySelector('a.crumb')?.getAttribute('href')).toBe('#/insights')
    await go('#/insights/nope')
    await vi.waitFor(() => expect(root.textContent).toContain('does not exist'))
  })
  it('Today tiles and cards are links to their insight or activity page', async () => {
    await go('#/today')
    await vi.waitFor(() => expect(root.querySelector('a.t')).toBeTruthy())
    const hrefs = [...root.querySelectorAll('a.t, a.cl')].map((a) => a.getAttribute('href'))
    for (const h of ['#/insights/hrv', '#/insights/rhr', '#/insights/battery', '#/insights/load', '#/insights/status', '#/insights/sleep', '#/insights/recovery']) expect(hrefs).toContain(h)
    expect(hrefs.some((h) => /^#\/activities\/\d+$/.test(h ?? ''))).toBe(true)
  })
  it('records: range segment changes the table, a row drives the chart, Cycling shows speed bests', async () => {
    await go('#/records')
    await vi.waitFor(() => expect(root.querySelector('.tbl')).toBeTruthy())
    const btn = (t: string) => [...root.querySelectorAll('button')].find((b) => b.textContent === t) as HTMLButtonElement
    const hasPr = () => root.querySelector('.tbl')!.textContent!.includes('PR')
    expect(hasPr()).toBe(true)
    btn('This year').click()
    await vi.waitFor(() => expect(btn('This year').getAttribute('aria-pressed')).toBe('true'))
    expect(root.querySelector('.tbl')!.textContent).toContain('No run in this range')
    ;(root.querySelector('.tbl tr[role=button]:not(.hit)') as HTMLElement).click()
    await vi.waitFor(() => expect(root.querySelector('.tbl tr.hit')).toBeTruthy())
    btn('Cycling').click()
    await vi.waitFor(() => expect(root.textContent).toContain('Fastest average speed'))
    expect(root.querySelector('.rl a')?.getAttribute('href')).toMatch(/^#\/activities\/\d+$/)
  })
  it('mileage: period segment incl. All time, compare window switch', async () => {
    await go('#/mileage')
    await vi.waitFor(() => expect(root.querySelector('.big')).toBeTruthy())
    const btn = (t: string) => [...root.querySelectorAll('button')].find((b) => b.textContent === t) as HTMLButtonElement
    btn('All time').click()
    await vi.waitFor(() => expect(root.textContent).toContain('Through'))
    btn('Year').click()
    await vi.waitFor(() => expect(root.textContent).not.toContain('Through'))
    btn('365 days').click()
    await vi.waitFor(() => expect(root.textContent).toContain('365 days before'))
    expect(root.textContent).not.toMatch(/NaN|undefined/)
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
