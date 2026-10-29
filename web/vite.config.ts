import { defineConfig } from 'vite'
import preact from '@preact/preset-vite'
import { readFileSync } from 'node:fs'

// Dev only: answer the read endpoints from web/fixtures so no Worker is needed.
const fixtures = () => ({
  name: 'fixtures',
  configureServer(s: { middlewares: { use(f: (req: { url?: string }, res: any, next: () => void) => void): void } }) {
    s.middlewares.use((req, res, next) => {
      const u = new URL(req.url ?? '', 'http://x'), by = u.searchParams.get('by')
      const f = u.pathname === '/api/mileage' ? `mileage-${by === 'month' || by === 'year' ? by : 'week'}` : u.pathname === '/api/mileage/compare' ? 'mileage-compare' : u.pathname === '/api/activities' ? 'activities' : u.pathname === '/api/steps' ? 'steps' : u.pathname === '/api/records' ? 'records' : u.pathname === '/api/fitness-estimates' ? 'fitness-estimates'
        : /^\/api\/activities\/\d+$/.test(u.pathname) ? (u.pathname.endsWith('/97') ? 'activity-strength' : 'activity-run') : /^\/api\/(today|goals|load|recovery|intensity|dynamics|routes|shoes|correlations)$/.exec(u.pathname)?.[1]
      if (!f) return next()
      res.setHeader('content-type', 'application/json')
      res.end(readFileSync(new URL(`./fixtures/${f}.json`, import.meta.url)))
    })
  },
})

export default defineConfig({ root: 'web', plugins: [preact(), fixtures()], build: { outDir: 'dist', emptyOutDir: true } })
