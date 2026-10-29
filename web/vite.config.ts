import { defineConfig } from 'vite'
import preact from '@preact/preset-vite'
import { readFileSync } from 'node:fs'

// Dev only: answer the read endpoints from web/fixtures so no Worker is needed.
const fixtures = () => ({
  name: 'fixtures',
  configureServer(s: { middlewares: { use(f: (req: { url?: string }, res: any, next: () => void) => void): void } }) {
    s.middlewares.use((req, res, next) => {
      const m = /^\/api\/(today|goals|load|recovery|intensity)(\?|$)/.exec(req.url ?? '')
      if (!m) return next()
      res.setHeader('content-type', 'application/json')
      res.end(readFileSync(new URL(`./fixtures/${m[1]}.json`, import.meta.url)))
    })
  },
})

export default defineConfig({ root: 'web', plugins: [preact(), fixtures()], build: { outDir: 'dist', emptyOutDir: true } })
