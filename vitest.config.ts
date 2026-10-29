import { defineConfig } from 'vitest/config'
// The OAuth library imports the Workers runtime module; tests inline it and alias that module to a stub.
export default defineConfig({
  resolve: { alias: { 'cloudflare:workers': new URL('./test/cf-workers-stub.ts', import.meta.url).pathname } },
  test: { server: { deps: { inline: ['@cloudflare/workers-oauth-provider'] } } },
})
