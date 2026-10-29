# CoAchI

A personal training dashboard and AI coach built on the Garmin Personal API. It shows today's readiness and training status, activities with routes and intervals, mileage, records, steps and goals, and it has a coach chat.

Status: design phase. The clickable mock lives in `design/`, the architecture in `docs/plan.md`.

This is a single-user project. Bring your own Garmin API key. Not affiliated with Garmin. All data in the mocks is invented.

## Tests

- `npm test` runs everything on synthetic data: unit, the Worker routes end to end (Access JWT, D1 and R2 shims, sync rate limit), the mileage reconciliation, and the frontend mounted in happy-dom (hash-route navigation, error card with retry).
- `npm run reconcile [path]` checks the mileage endpoints against a plain sum of `activities.distance_m` in a real SQLite export (default `exports/local.sqlite`, opened read-only). It prints only pass/fail per year and the largest difference in metres.
- Not covered: chart tooltips and real-browser layout (needs a browser framework, not added).

## License

MIT
