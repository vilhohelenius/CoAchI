# CoAchI: implementation plan

Single-user training dashboard + AI coach on Cloudflare. Pull-only Garmin Personal API (see `garmin-api-findings.md`, not re-probed here). Metric formulas live in `metrics.md`. Rule for the developer: smallest thing that works; every `ponytail:` shortcut below has a named ceiling.

## 1. Stack (decided)

- TypeScript everywhere. Worker router: **Hono**. Frontend: **Vite + Preact** SPA, built into `web/dist`, served by Workers static assets (one deploy, one origin, no CORS).
- Charts: **uPlot** (time series, tiny, fast). Maps: no map library. The route card and heatmap draw SVG over OpenStreetMap raster tiles (`<image>` elements, at most 12 tiles, loaded lazily, falling back to plain SVG; the tile server sees the viewed area). The heatmap is low-alpha SVG polylines from one compact `routes/all.json`.
- FIT: **`@garmin/fitsdk`** (official, pure JS ESM, no Node deps, runs in Workers). Unzip: **`fflate`** (zip holds one `.fit`). Rejected: `fit-file-parser` (older, Buffer polyfills), WASM anything.
- Tests: **vitest** + `@cloudflare/vitest-pool-workers` (real Miniflare D1/R2), **Playwright** for UI smoke.
- **Hosting: $0 (decided).** Worker on the free plan serves only the app/API/coach/MCP. Sync, FIT parsing and metric recompute run in a **GitHub Actions** Node job that writes to D1 (REST) and R2 (S3 API). Reason: free Workers allow 10 ms CPU per invocation, which a 374 KB FIT decode can exceed. Details in sections 5 and 14. `garmin/*`, `metrics/*` are plain TS with no Worker-only APIs, so the same code runs in Node (Action) and could move to Workers Paid ($5/mo) if the Action route annoys.
- **Two Workers, one repo, shared D1/R2 and `src/tools.ts`:** `coachi` (dashboard + API, behind Access) and `coachi-mcp` (MCP + OAuth, section 8). Reason: Access one-click protects a whole hostname, so MCP/OAuth endpoints need their own hostname.
- No Queues, no Durable Objects, no ORM. One KV namespace only for `coachi-mcp` (OAuth library storage). D1 via raw SQL helper + `migrations/*.sql` (wrangler migrations).

## 2. Repo layout

```
CoAchI/
  docs/                      plan.md metrics.md garmin-api-findings.md
  migrations/                0001_init.sql ...            (D1, wrangler-applied)
  src/
    index.ts                 Hono app, scheduled() handler, route wiring
    garmin/client.ts         token mint/cache, get() with 1 req/s + backoff, window constants
    garmin/sync.ts           steady-state + backfill steps, upserts (runtime-agnostic; takes a `db` and `blob` interface)
    garmin/fit.ts            unzip, decode, derive metrics + track + streams
    metrics/                 PURE functions, no I/O: load.ts hrv.ts sleep.ts vo2.ts predict.ts corr.ts ...
    metrics/recompute.ts     reads D1, calls pure fns, writes load_daily/metric_daily
    api.ts                   JSON routes for the SPA
    tools.ts                 coach tool registry (ONE definition, used by Claude loop and MCP)
    coach.ts                 briefing builder, Claude API loop, spend cap
    mcp/                     second Worker entry (coachi-mcp): MCP server over tools.ts + OAuth provider
    auth.ts                  Access JWT verify, MCP token check
  web/                       Vite+Preact app (pages: Today, Activities, Activity, Load, Recovery, Shoes, Map, Coach, Settings)
  test/                      unit/ (metrics), integration/ (sync, api), e2e/ (playwright), fixtures/
  sync/run.ts                Node entrypoint for the Action: D1 REST adapter (batch), R2 S3 adapter (`aws4fetch`), calls garmin/sync + metrics/recompute
  .github/workflows/sync.yml schedule + workflow_dispatch
  scripts/backfill-local.ts  optional: same sync code run via wrangler dev --remote, for debugging only
  wrangler.toml  package.json  tsconfig.json
```

`.samples/` stays gitignored (personal data). Fixtures in `test/fixtures` are synthetic only (generated; invented coordinates, ids and HR values). See section 15.

## 3. D1 schema (key columns; extends findings doc)

All dates are local calendar dates `YYYY-MM-DD` (TEXT). Timestamps UTC ms (INTEGER). `raw_json` kept on source tables so metrics can be recomputed without re-fetching Garmin.

| Table | Key columns |
|---|---|
| `sync_state` | `key PK, value, updated_at`. Keys: `jwt`, `jwt_exp`, `key_expires_on`, `last_sync_ok`, `last_error`, `backfill_stage`, `backfill_cursor` |
| `settings` | `key PK, value` JSON: `sex, units, sleep_need_h, timezone, shoe_retire_km`. HR values are NOT settings; they come from `hr_zones` |
| `activities` | `id PK, start_local, start_gmt, type, name, distance_m, duration_s, moving_s, elev_gain_m, avg_hr, max_hr, avg_cadence, avg_power, norm_power, aero_te, anaero_te, garmin_load, rpe, feel, hr_z1..z5_s, temp_c, shoe_id, load (ours), raw_json, fit_r2_key, fit_status ('none'/'ok'/'error'), updated_at` |
| `activity_laps` | `activity_id, idx, distance_m, duration_s, avg_hr, avg_speed, elev_gain_m, avg_power` PK(activity_id, idx) |
| `activity_metrics` | `activity_id PK, ef, decoupling_pct, hr_drift_pct, cadence_cv, gct_ms, vert_ratio, stride_m, vo2_est, best_1k_s, best_1mi_s, best_5k_s, best_10k_s, best_hm_s, best_3m_m, best_6m_m, best_12m_m` (best-effort distances/times; null if not applicable) |
| `activity_track` | `activity_id PK, polyline (encoded, ~10 m simplified), bbox` for map/heatmap |
| `daily_summary` | per findings: `date PK, steps, rhr, hr_min, hr_max, stress_avg, bb_min, bb_max, bb_charged, bb_drained, resp_avg, spo2_avg, intensity_mod, intensity_vig, kcal_*, raw_json` |
| `sleep` | `date PK, start_ts, end_ts, total_s, deep_s, light_s, rem_s, awake_s, score, need_s, avg_hr, avg_stress, spo2_avg, resp_avg, raw_json` |
| `hrv_daily` | `date PK, last_night_avg, weekly_avg, high_5min, base_low, base_balanced_low, base_balanced_upper, status` |
| `intraday` | `date, metric, json` PK(date, metric); retain 90 days (hr, body_battery, hrv_readings) |
| `hr_zones` | `effective_date, sport ('DEFAULT','RUNNING','CYCLING'), lthr, max_hr, rest_hr, method, z1..z5 floors` PK(effective_date, sport). Append-only: a new row only when any value differs from the latest row. Load for an activity uses the row effective on its date for its sport (each sport has its own LTHR; max HR and auto-updating resting HR as reported by Garmin) |
| `goals` | `id PK, created_at, kind ('race','distance','weekly_km','ctl','weight','custom'), title, target_value, unit, target_date NULL, status ('active','done','dropped'), notes` |
| (steps) | no new table: `daily_summary.steps` (+ `step_goal` and `distance_m`) is the daily steps store; goal target lives in `goals` |
| `explain_cache` | `metric, date, input_hash, text, model, created_at, tokens` PK(metric, date); regenerate overwrites |
| `shoes` | `id PK, name, brand, default_for ('run'/null), start_km (prior mileage), retire_km, retired_on, notes` |
| `load_daily` | `date PK, load, ctl, atl, tsb, acwr, monotony, strain, ramp7` (derived, rebuilt idempotently from `activities`) |
| `metric_daily` | `date, key, value` PK(date,key): hrv_ln7, hrv_ln30, hrv_base, hrv_sd, rhr7, rhr30, hrv_rhr_status, hrv_streak, max_hr_observed, zone minutes per sport, acwr per sport, readiness, readiness_json, sleep_debt_h, sleep_sd_min, vo2_est, cs, polarization_pi ... (derived, flexible; avoids a column per metric) |
| `coach_notes` | `id PK, created_at, kind ('injury','schedule','preference','goal','other'), text, expires_on NULL, active INT, source ('user','coach')` |
| `coach_messages` | `id PK, thread_id, ts, role, content_json, tokens_in, tokens_out, cost_usd` |
| `coach_usage` | `month PK ('2026-11'), usd, tokens_in, tokens_out` (spend cap source of truth) |
| `planned_load` | `date PK, load, label` (optional future sessions; feeds projection) |
| `checkin` | `date PK, mood 1-5, soreness 1-5, note` (optional daily 5-second input; used by correlation engine and readiness calibration) |

Rules: every sync write is `INSERT ... ON CONFLICT(pk) DO UPDATE`. Derived tables are fully re-derivable (`POST /api/recompute?from=`). Add `activities.shoe_id` assignment: default shoe for matching sport on insert, user override via UI; never overwritten by sync (sync upsert excludes `shoe_id`, `rpe` if user-edited).

## 4. R2 layout

Bucket `coachi` (private; no public access, objects served only through Worker).

```
fit/{activityId}.zip              raw download, immutable (re-parse any time)
streams/{activityId}.json.gz      1 Hz columnar: {t[], hr[], speed[], alt[], cad[], pwr[], lat[], lon[], rr?}  (for charts, decoupling)
exports/                          optional manual D1 dumps (ponytail: add only if wanted)
```

Streams are the parse output, so charts never re-parse the FIT. Raw zip stays so we can re-derive when formulas change.

## 5. Sync design

**Where it runs:** `.github/workflows/sync.yml` (public repo, Node 22, `timeout-minutes: 45`, `concurrency: {group: sync, cancel-in-progress: false}` so runs never overlap). Triggers: `schedule: '17 */3 * * *'` (off-the-hour; GitHub drops/delays top-of-hour jobs) and `workflow_dispatch` (inputs: `mode=steady|backfill|recompute`).

**"Sync now":** the UI calls `POST /api/sync`; the Worker calls `POST https://api.github.com/repos/{owner}/{repo}/actions/workflows/sync.yml/dispatches` (`{ref:"main"}`) with a **fine-grained PAT** (this repo only, permission Actions: read/write) kept as Worker secret `GITHUB_DISPATCH_TOKEN`. GitHub returns 204 with no run id, so the Worker stores `sync_state.dispatch_requested_at`; the job writes `run_started_at`, `last_sync_ok`, `last_error`; the UI polls `GET /api/sync/status` (expect 15-60 s before the run starts). The PAT expires (max 1 year): store its expiry in Settings and show the same banner logic as the Garmin key.

**Honest limits of the GitHub route:**
- Schedules drift: runs commonly start 5-30+ min late and are occasionally skipped under load. Fine for a 3-hourly sync; do not promise exact times.
- GitHub disables scheduled workflows after 60 days without repository activity (GitHub documents this for public repos, so it **applies to this repo**). The watchdog below is therefore required, not optional. Mitigation (Worker watchdog, free-plan cron, ~1 ms of CPU): Worker cron `0 */6 * * *` checks `last_sync_ok`; if older than 8 h it calls `PUT /repos/{o}/{r}/actions/workflows/sync.yml/enable` then dispatches, and the dashboard shows "sync stale" banner when older than 12 h. Occasional commits (any push) also reset the clock.
- Minutes: standard runners are free for public repos, so no quota worry (~8 runs/day x ~2 min). Public-repo consequences (logs world-readable, forks, 60-day disable) are in section 15.
- Secrets live in GitHub (an Environment `prod` limited to branch `main`): `GARMIN_API_KEY`, `CF_API_TOKEN` (D1 edit + nothing else), `CF_ACCOUNT_ID`, `D1_DATABASE_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_ENDPOINT`. The Worker does not hold the Garmin key.
- D1 REST writes: batch SQL (<= ~100 statements per request); D1 free write cap is 100k rows/day, so a full backfill is spread over runs only if streams/intraday rows are kept out of D1 (they are: streams in R2; intraday limited to 90 days).

**One run** (no Worker limits in Node; keep 1 req/s to Garmin; time-box to 40 min then exit cleanly with cursor saved), in priority order:
1. Auth: get JWT (below). On mint 401/403: set `last_error='KEY_INVALID'`, stop.
2. If backfill not complete: run backfill steps until the time box (below), then steady state. Steady state:
3. Steady state (every run): activity list `limit=20` -> upsert summaries; for new run/ride/ski IDs with `fit_status='none'` download FIT (no per-run cap besides the time box); daily summary (incl. steps) + HRV for last 3 days (sleep/HRV finalise late); sleep last 3 days (32 d window OK); body battery last 3 days; intraday HR/BB for today and yesterday; **HR zones (`/biometric-service/heartRateZones/v2`, 1 call) on every run**, appended to `hr_zones` only when changed (keeps history by effective date; per-sport rows).
   - **Max-HR check:** FIT parse records `max_hr_observed` (99.9th-percentile-filtered to drop sensor spikes, plus raw max). If observed > Garmin max for that sport for 2+ activities, `/api/status` flags `hr_max_exceeded` and the UI/coach suggest raising max HR in Garmin (we never override Garmin's value).
4. Recompute derived metrics for dates touched (`metrics/recompute.ts`), cheap and pure.

 mostly to drain the backfill queue fast and to retry failures; steady-state work self-throttles to every 3 h (09:00-23:00 local worth hitting more often only if desired: `ponytail:` single throttle).

**Idempotency:** upserts only; FIT step keyed by activity id (skip if `fit_status='ok'` and R2 object exists); derived tables rebuilt from sources. Running a sync twice must not change row counts or values (tested).

**Backfill (resumable; first run may take 30-60 min, re-dispatch continues from the cursor):** `backfill_stage` + `backfill_cursor` in `sync_state`. Stages in order, each step one window, cursor moves backward from today:
1. `activities`: page 99 at a time to the first activity.
2. `daily` v2 in 365-day chunks back to first activity date.
3. `hrv` daily range in 365-day chunks (will be empty before Nov 2025; empty is fine, cursor still advances).
4. `sleep` in 28-day chunks (limit 32), `bodybattery` in 28-day chunks. Stop each when it has returned empty for 6 consecutive chunks past the first non-empty one (device-gap tolerance); `ponytail:` heuristic, revisit if earlier data turns out to exist after a gap.
5. `fit`: running first (last 12 months newest first), then other sports, then older; ~1.5 s per activity -> the last 12 months in ~5 min, all history ~30 min.
6. `intraday`: last 90 days only, 5 days per run.
Stress/steps endpoints skipped (redundant with daily v2).
Between requests: 1 req/s sleep; retry 429/5xx with exponential backoff (1,2,4 s, max 3); on persistent failure record `last_error`, keep cursor so next cron resumes. Empty (`200 []`, `204`, nulls) = no data, not error.

**Token handling:** GitHub secret `GARMIN_API_KEY` is read only by the job. Each run mints one JWT (24 h life, one call) and keeps it in memory; on any 401 re-mint once. Mint = `POST .../personal-api-key/token`, `Authorization: ApiKey <key>`, empty body, bare-text JWT. No JWT cache in D1 needed.

**Key-expiry reminder:** user enters key expiry date in Settings (stored `key_expires_on`; Garmin does not expose it). `/api/status` returns `key_days_left`; UI shows banner at <=14 days, red at <=3, and when mint fails ("Garmin key invalid: create a new key, update the GitHub secret `GARMIN_API_KEY`"). Coach briefing also mentions it. Optional push: if secret `NTFY_URL` set, cron POSTs once per day at <=7 days (one fetch; `ponytail:` no email infra).

**FIT parsing** (`garmin/fit.ts`, runs in the Action): unzip with fflate -> `Decoder` from `@garmin/fitsdk` -> `records`, `laps`, `session`, `hrv` (RR). Outputs: 1 Hz streams (R2), laps (D1), polyline via Douglas-Peucker ~10 m (D1), `activity_metrics` (decoupling, EF, best efforts by sliding window over distance/time, cadence x2 for per-leg value), our `load` (metrics.md section 1). No privacy zone: heatmap uses full tracks. Failure -> `fit_status='error'`, summary-based load still computed, never blocks sync.

**Strava:** not part of sync. Used only by the human's Claude.ai session (Strava MCP) as optional cross-check, and for one-time shoe-name import by hand. Zero code in this repo.

## 6. Worker API (JSON, all under Access)

```
GET  /api/config                 { coach_enabled, units, key_days_left, last_sync, ... }
GET  /api/today                  readiness + components, TSB/CTL/ATL, HRV status, sleep last night, last activity, notes, flags
GET  /api/activities?type&from&to&q&limit&before   list (paged)
GET  /api/activities/:id         summary + laps + metrics + shoe
GET  /api/activities/:id/streams streams json (from R2, gzip passthrough)
PATCH /api/activities/:id        { shoe_id, rpe, name, notes }
GET  /api/mileage?group=week|month|year&type    bar series (sum distance, time, elev)
GET  /api/mileage/compare?period=week|month|year|rolling30|rolling365&type=run&n=4   cumulative lines, shape below
GET  /api/steps?from&to           daily steps + goal + streak + 7d/30d averages
GET  /api/load?from&to           load_daily series
GET  /api/load/projection?days=21&daily_load=40|mode=rest|typical|planned   (cards: "in 14 days CTL x, TSB y")
GET  /api/acwr?by=sport           per-discipline ACWR series + band
GET  /api/intensity?weeks=8       weekly stacked zone minutes per sport + 80/20 share
GET  /api/sleep/composition?days=30   deep/REM/light/awake + body battery range
POST /api/explain                 { metric, date, regenerate? } -> cached LLM text (section 7)
GET/POST/PATCH /api/goals
GET  /api/recovery?from&to       hrv, rhr, sleep, bb, readiness series
GET  /api/metrics?keys=a,b&from&to
GET  /api/correlations           precomputed report (nightly recompute) with n, r, CI, flags
GET  /api/shoes   POST /api/shoes   PATCH /api/shoes/:id   (mileage computed server-side: start_km + sum)
GET  /api/map/heatmap?type&from&to  array of encoded polylines
GET/PUT /api/planned-load, /api/checkin/:date, /api/settings
GET/POST/PATCH/DELETE /api/notes
POST /api/sync (dispatches the GitHub workflow)    GET /api/sync/status    POST /api/recompute (= dispatch mode=recompute)
POST /api/coach/chat  (SSE stream)   GET /api/coach/briefing   GET /api/coach/usage
POST /mcp   (MCP, section 8; separate auth)
```

Conventions: ISO dates, metric SI in DB and API, unit conversion in the SPA only. Errors `{error, code}`. Every response includes data freshness (`as_of`).

**Mileage comparison lines (Strava-style).** Definition: for period P in {week (Mon start), month, year}, line k = cumulative distance by day-of-period for the current period and the previous `n` periods (default week 4, month 6, year all years back to 2019). Response:
```
{ "period":"year","type":"run","unit":"m","as_of":"2026-10-29",
  "series":[ {"label":"2026","start":"2026-01-01","current":true,
              "points":[{"d":1,"cum":0},{"d":2,"cum":8400},...,{"d":302,"cum":1712000}]},
             {"label":"2025","points":[...full length...]}, ... ],
  "goal": {"target_m":2000000,"pace_line":[...linear to target...]} }
```
Current period stops at today (no future points); past periods run full length so you see the finish. Rolling: `rolling30` / `rolling365` plot, for each day t in the last 30/365 days, the sum of distance in (t-window, t] as a line, with the same series one window earlier overlaid (d = day offset, labels "last 30 d" / "previous 30 d"). SQL: one query per request, `SELECT date(start_local) d, SUM(distance_m) FROM activities WHERE type IN (...) AND start_local >= :from GROUP BY d` then cumulate in code (tiny: <= a few thousand rows). Yearly comparison needs all activities back to the first activity, i.e. backfill stage 1 must complete (already first; exit criterion in phase 2 covers it). Type filter groups: run, ride, ski, all. Week vs previous weeks ignores the year boundary (ISO weeks). Goals draw as a dashed pace line (year goal; weekly band shaded on the week chart).

## 7. Coach design

**Principle:** the LLM never does arithmetic or looks at raw tables; code computes metrics, the LLM interprets and advises. Same tools back both coach modes.

**Tool registry (`src/tools.ts`)**, JSON-schema in, JSON out, read-only except notes:
1. `get_overview()` today's snapshot: readiness (+components), CTL/ATL/TSB/ACWR/ramp, HRV status, last night sleep, sleep debt, key expiry, data freshness.
2. `get_activities({from,to,type,limit})` summaries incl. load, EF, decoupling.
3. `get_activity({id})` summary + laps + metrics (no raw streams).
4. `get_series({keys[],from,to,agg:'day'|'week'})` any `load_daily`/`metric_daily`/mileage/sleep/hrv key.
5. `project_load({days,planned:[{date,load}]})` CTL/ATL/TSB forecast (pure fn).
6. `get_race_predictions()` and `get_vo2_estimate()` with ranges and confidence.
7. `get_correlations({x?,y?})` returns the vetted report only (never ad-hoc fishing).
8. `get_shoes()`.
9. `get_notes()`, `add_note({kind,text,expires_on?})`, `resolve_note({id})`.
10. `get_planned()`, `set_planned({date,load,label})` (rest day tomorrow = load 0).
11. `set_rpe({activity_id|date+type, rpe})` (e.g. "salitreeni oli 7/10" -> latest strength activity that day gets RPE 7, load recomputed; coach confirms which activity it updated), `get_steps({from,to})`.
12. `get_goals()`, `set_goal({...})`, `update_goal({id,status})`. Goals are **soft, adjustable guidance**, not obligations: the coach never pushes load to "catch up" when recovery signals say otherwise, states gaps neutrally ("about 40 km behind the yearly pace"), and offers to revise the goal when training changes (injury, illness, season). Weekly distance band is running only. Briefing always includes active goals; with none, coach's first reply asks the user to set one ("set a goal first") and offers to save it.
Tool results carry `as_of` and `n`/`confidence` so the model can hedge.

**Briefing flow:** `GET /api/coach/briefing` builds (deterministic, no LLM) a compact JSON "daily briefing" (<=1.5k tokens): date, `get_overview`, last 7 days of activities (one line each), active notes, goals/settings, planned load next 7 days, data-quality warnings. Chat call = system prompt (static: role, rules, units, language rule, "only use tool numbers; say when data missing; no medical diagnosis; injury/illness -> advise seeing a professional") + briefing as first user-context block. System prompt + tool defs use **prompt caching**. Daily proactive summary: optional cron at 06:00 writes `coach_messages` once per day (one call, ~$0.01); off by default, flag `COACH_DAILY=1`.

**Answer structure (system prompt contract, for "what should I do today" type questions):** (1) table of today's recovery signals (HRV vs range, RHR, sleep, readiness, TSB, each with value/baseline/status); (2) flagged risks (e.g. ACWR high, hr_max_exceeded, low-confidence data); (3) recommendation with concrete targets (session type, duration, HR cap in bpm from that sport's zones, optional pace); (4) "why not X" for the obvious alternatives (harder session / complete rest); (5) exactly one clarifying question when information is missing (e.g. how legs feel). Short; numbers only from tools. Tested by snapshot of section headings on a mocked model.

**"Explain this" (LLM-written, per card):** `POST /api/explain {metric,date,regenerate}`. The metrics.md template is the fallback and the grounding: the LLM receives the metric's current values, baseline, n, and the template, and rewrites it in plain language (<=80 words, no new numbers). Cache key `(metric, date)` plus `input_hash` of the inputs in `explain_cache`; reuse while hash unchanged (so each card costs one call per day at most); Regenerate button bypasses cache (limit 5/day/metric). Model: same cheap model as coach (`COACH_MODEL`), no tools, ~400 in/120 out tokens, about $0.0015 per call; 15 cards/day is about $0.7/month. Counts against the same monthly cap; at cap or no API key the UI shows the static template text, so the feature degrades, never errors.

**Language:** default English; system prompt says "reply in English unless the user writes in Finnish or asks for Finnish". Notes stay as written.

**Loop:** manual tool-use loop in `coach.ts` (max 6 tool rounds, max_tokens 1000, history = last 12 messages). Model from var `COACH_MODEL` (default a cheap Haiku-class model; verify current ID/pricing at implementation time with the claude-api skill). Stream to SPA via SSE.

**Memory:** `coach_notes` table is the only memory. Coach may `add_note` only when the user states a durable fact ("left knee sore", "rest day tomorrow" -> also `set_planned`); it tells the user what it saved; user can edit/delete in the Notes UI. Notes with `expires_on` auto-inactive. Injury notes always appear in briefing. No embeddings, no vector store.

**Spend cap:** before each call check `coach_usage` for the month >= `COACH_MONTHLY_USD_CAP` (default 5) -> respond "cap reached" without calling API. After each call add cost from `usage` tokens x price constants (in code). Also set a workspace spend limit in the Anthropic console (belt and braces).

**Clean disable:** coach = `coach.ts` + `/api/coach/*` + web `Coach` page + `@anthropic-ai/sdk`. Secret `ANTHROPIC_API_KEY` absent -> `/api/config.coach_enabled=false`, UI hides Coach tab, `/api/coach/*` return 501. Removal = delete those three files/folder + dependency. Tools, notes, MCP, dashboard are independent of it (they import `tools.ts`, not `coach.ts`).

## 8. MCP server (`coachi-mcp` Worker) and auth (decided: Cloudflare Access SSO)

**Requirement:** Claude.ai web must connect. Claude.ai custom connectors need OAuth 2.1 (dynamic client registration, PKCE) or no auth. Decision: **`@cloudflare/workers-oauth-provider` as the MCP OAuth server, with Cloudflare Access (Access for SaaS, OIDC) as the upstream identity provider**; the user logs in through Access SSO (same policy as the dashboard: their email) when a client connects. Chosen over a passphrase for stronger auth.

**Design:** `coachi-mcp` Worker at its own `*.workers.dev` URL; Access is NOT applied in front of it (the OAuth library must serve `/register`, `/token`, `/.well-known/*` to Claude.ai unauthenticated); Access is the IdP behind `/authorize` -> `/callback`. Setup: create an Access for SaaS OIDC app (redirect = `https://<mcp-worker>/callback`, policy = your email), put its client id/secret/endpoints in secrets `ACCESS_CLIENT_ID`, `ACCESS_CLIENT_SECRET`, `ACCESS_TOKEN_URL`, `ACCESS_AUTHORIZATION_URL`, `ACCESS_JWKS_URL`, `COOKIE_ENCRYPTION_KEY`; one KV namespace `OAUTH_KV` for the library. Follow Cloudflare's "MCP server with Access" template. MCP at `POST /mcp` (Streamable HTTP, stateless; hand-roll `initialize`/`tools/list`/`tools/call` if the SDK is heavy). Access tokens short-lived with refresh; revoke by deleting KV grants (Settings lists connected clients). Exposes exactly the `tools.ts` registry (incl. `add_note`, `set_planned`, `set_goal`, `set_rpe`) plus a `briefing` resource. Claude Code uses the same OAuth flow. Log tool name + ts only.

**Phase 5 starts with a spike (kept):** prove Claude.ai web completes the connector flow (callback `https://claude.ai/api/mcp/auth_callback`, DCR) against a hello-world tool before any other coach work. If it fails, document it and ship Claude Code only. Risk: Access-SaaS-as-IdP setup has more steps than a passphrase; budget half a day.

## 9. Auth, secrets, privacy

- **Dashboard + API (`coachi` Worker):** Cloudflare Access applied to the Worker's `workers.dev` URL. Verified: Cloudflare now offers one-click "Enable Cloudflare Access" for workers.dev and preview URLs (Workers > Settings > Domains & Routes), so **no custom domain is needed** ([Cloudflare docs](https://developers.cloudflare.com/workers/configuration/cloudflare-access/), [announcement](https://blog.cloudflare.com/workers-protected-by-access/)). Policy = your email (one-time PIN). Free Zero Trust tier. Fallback if that ever fails for this account: cheapest is a ~$10/yr domain on Cloudflare DNS plus a custom-domain route; nothing else changes.
- Worker also verifies `Cf-Access-Jwt-Assertion` (JWKS `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`, check `aud`) on every `/api/*` request, so misconfigured Access cannot expose data. Local dev: `DEV_BYPASS_AUTH=1`, never in prod.
- Worker secrets (`wrangler secret put`): `GITHUB_DISPATCH_TOKEN`, `ACCESS_CLIENT_ID`/`ACCESS_CLIENT_SECRET`/`ACCESS_*_URL`/`COOKIE_ENCRYPTION_KEY` (MCP Worker), optional `ANTHROPIC_API_KEY`, `NTFY_URL`. Vars: `CF_ACCESS_AUD`, `CF_ACCESS_TEAM`, `COACH_MODEL`, `COACH_MONTHLY_USD_CAP=5`, `COACH_DAILY`.
- Health + GPS data: R2/D1 private; no analytics scripts; the only third-party requests from the browser are OpenStreetMap map tiles on the route card and heatmap (accepted). Weather (later) via Open-Meteo sends rounded coordinates server-side. Coach API calls send only tool outputs (aggregates, no raw GPS) to Anthropic. No heatmap privacy zone (decided).

## 10. Cost estimate (monthly, steady state)

| Item | Estimate |
|---|---|
| Workers (free), GitHub Actions (public repo: standard runners free) | $0 |
| D1 / R2 / cron | well inside included quotas (D1 < 100 MB; R2 ~ 197 FIT ~ 40 MB zip + streams ~ 30 MB) = $0 |
| Access | free (<50 users) |
| Claude API (Haiku-class, assumptions: ~$1/M input, ~$5/M output, cached prefix cheaper) | question ~ 15k in + 1k out incl. tool rounds = ~$0.02; 100 questions + 30 daily summaries = ~$2-3; hard cap $5 |
| Domain (optional; workers.dev works but then Access needs a custom domain) | ~$10/yr |
Explain-this adds about $0.5-1/month inside the same cap. Total about $2-4/month (coach only). Prices must be re-verified at build time.

## 11. Test strategy (for the tester agent)

Principle: metrics are pure functions, so most tests are cheap and deterministic. Live Garmin is manual only (one smoke with the real key, never in CI).

1. **Unit (vitest, `test/unit`)** with golden values: constant daily load L for 300 days -> CTL, ATL -> L; zero load decays by `e^(-1/42)` per day; TSB sign; projection for 7 days of zero load matches closed form; ACWR with flat load = 1.0; TRIMP of 1 h at LTHR = 100 (with illustrative LTHR 170 / rest 50 / max 190); decoupling of synthetic stream with 5% HR drift = ~5%; best-effort window on synthetic constant-speed stream = exact; Riegel/Daniels known values; HRV baseline with fewer than 21 nights returns "insufficient data"; correlation: independent noise -> flagged not significant over 1000 seeds (false-positive rate <= ~5-10% after FDR), planted lag-1 relation recovered, autocorrelated random walks do not yield "strong" claims, n<30 refused.
2. **FIT (`test/integration/fit`)**: decode a synthetic FIT built with the Garmin SDK encoder (synthetic only; real files never enter the repo or CI): record count, laps, polyline length <= N points, cadence doubling, RR extraction, corrupted/truncated file -> `fit_status='error'` and sync continues.
3. **Sync (`test/integration/sync`)** with a mocked `fetch` serving synthetic Garmin JSON (hand-written to the documented shape): first run populates; second run changes nothing (row counts + checksums); window sizes respected (assert request ranges <= 365/32/28/31 days); 401 -> remint once -> success; mint 401 -> `KEY_INVALID` surfaced in `/api/status`; 429 -> backoff -> resume at same cursor; empty `[]`/204/nulls -> no rows, cursor advances; workflow `concurrency` group configured (assert in yml), runner run twice back-to-back is idempotent; D1 REST adapter and R2 adapter tested against mocked `fetch` (batching <= 100, retry on 429); dispatch endpoint returns 204 -> status shows pending; user-edited `shoe_id`/`rpe` survive re-sync.
4. **API (`test/integration/api`)**: each route happy path + auth failure (no/invalid Access JWT = 401/403, `/mcp` without token = 401); mileage grouping totals equal the sum of activities; shoe mileage = `start_km` + assigned activities; pagination stable.
5. **Coach/MCP**: tool schema snapshot test (registry is the contract); MCP `tools/list` equals registry; `tools/call` for every tool returns schema-valid output on a seeded DB; coach loop with a mocked Anthropic client: respects 6-round max, cap reached -> no outbound call, no key -> 501 and `coach_enabled=false`, `add_note` persisted and appears in next briefing. No test hits the real Anthropic API except one opt-in manual smoke.
6. **E2E (Playwright, seeded DB, `wrangler dev`)**: dashboard Today renders readiness and "Explain this" popover text; activity list filter by type; activity page chart draws; Sync now button shows progress and ends in "ok"; heatmap canvas non-empty; shoe mileage after reassigning an activity; coach tab hidden when key absent; 390 px mobile viewport has no horizontal scroll.
7. **Data-quality checks (run against real data once per phase, manual)**: compare our distance/HR totals vs Garmin Connect for 3 random activities and one week; compare our CTL trend direction vs Garmin acute load; sanity VO2 estimate within +-5 of Garmin watch value (documented difference, not a failure).

## 12. Phases and exit criteria

**Phase 1: design (this doc set).** Exit: user answers open questions in section 13; metrics.md priorities confirmed; repo skeleton, `wrangler.toml`, empty Worker deploys behind Access and returns 200 for the user and 403 for others.

**Phase 2: sync + data.** Scope: migrations, GitHub Actions workflow + Node runner (D1 REST/R2 S3 adapters), Worker `/api/sync` dispatch + watchdog cron, Garmin client, steady sync, backfill stages 1-4, FIT stage for runs, `/api/status`, `/api/sync`, minimal Settings page (key expiry, HR values). Exit: (a) full history to today (needed for yearly comparison lines) activities in D1 (count matches Garmin Connect +-0); (b) daily/sleep/HRV/BB populated for all days returned by Garmin; (c) at least the last 12 months of runs have FIT in R2 + streams + laps; (d) idempotency + window-size + token tests green; (e) Sync now works from the browser on production (dispatch -> run -> status ok, measured latency recorded); watchdog re-enables a disabled workflow (tested with a fake clock); Action minutes/month measured; and the free-plan CPU check in section 14 is done; (f) key-expiry banner works with a faked date.

**Phase 3: summary dashboard.** Scope: `load.ts`, `hrv.ts`, `sleep.ts`, readiness v1, `load_daily` + `metric_daily` recompute, Today page, Load page ("Form and Fitness": CTL/ATL/TSB history with status label, per-sport ACWR bars with safe band, 21-day projection cards at a chosen daily load), Recovery page (HRV vs 60d mean +-1 sd band, HRV vs RHR 7d/30d status + streak + divergence, sleep composition 30 d, body battery range), Intensity page (8-week stacked zone minutes, 80/20 card, per-sport), `hr_zones` sync with history + max-HR-observed flag, goals table + UI (seeded with a yearly distance, a weekly distance band and a daily steps goal, all editable), steps page (daily bars, goal line/card, streak, 7d/30d average; low priority, build last in phase 3), "Explain this" (static template first, LLM + cache + Regenerate once coach key exists). Exit: unit golden tests green; Today loads < 1 s on 4G-class connection; user confirms numbers look plausible versus watch; each shown metric states availability/n and degrades gracefully with missing data.

**Phase 4: activities + mileage.** Scope: mileage bars plus comparison lines (week/month/year/rolling 30/rolling 365, `/api/mileage/compare`) with goal pace line, activity list/detail (map, HR/pace/cadence charts, laps, splits), weekly/monthly/yearly mileage by sport, per-activity metrics (EF, decoupling), polarization, PRs/best efforts, VO2/race prediction/critical speed (MVP priority ones). Exit: yearly comparison shows every year back to the first activity and current-year cumulative equals the sum of activities; mileage totals reconcile with Garmin Connect for 3 sampled months; activity page works for run, ride, ski, strength (no GPS) without errors; E2E tests green.

**Phase 5: coach.** Scope: `tools.ts`, notes UI + table, briefing, Claude loop with cap and answer structure, goals tools, LLM Explain-this, `coachi-mcp` Worker with OAuth via Access SSO (spike first), daily-summary flag. Exit: coach answers "should I run tomorrow?" using tool data and cites numbers; "rest day tomorrow" creates a note + planned load of 0 and tomorrow's briefing shows it; removing `ANTHROPIC_API_KEY` hides coach and everything else still works; cap blocks at limit (tested); Claude Code AND Claude.ai web connect via OAuth (Access SSO) to `coachi-mcp` and call all tools (spike done first; if Claude.ai fails, document and fall back to Code only); coach with no goal asks for one.

**Phase 6: routes/heatmap/shoes.** Scope: heatmap page (filters by sport/year), shoe CRUD + auto-assign + mileage + retire alert, route list, correlation page, weather adjustment, later-priority metrics as agreed. Exit: heatmap renders 5+ years of runs smoothly (<2 s, <5 MB transferred); shoe mileage equals sum of assigned activities + start_km; correlation page shows n/CI/caveats and "not enough data" states.

## 13. Decisions recorded and what is still open

Product decisions: HR values from Garmin zones per sport (synced, history kept); Claude.ai web MCP required, auth via Cloudflare Access SSO (section 8); no custom domain (Access works on workers.dev); strength RPE entered on the activity page or via coach chat (`set_rpe`); no heatmap privacy zone; coach cap $5/month; **hosting $0 via GitHub Actions sync runner**; goals are soft and adjustable (a yearly distance, a weekly running-only band and a daily steps target); steps have no primary nav entry.

**UI shell:** mobile = bottom tabs (Today, Activities, Load, Recovery, Coach) plus a drawer listing every view (Mileage, Intensity, Shoes, Map, Goals, Steps, Notes, Settings); desktop = sidebar with all views. Steps: an info box on Today (today's count, goal progress, streak) links to the `/steps` detail page (history, goal, averages); no tab or sidebar item of its own except inside the drawer/sidebar "More" group. 

Open:
1. (Resolved: repo is public. See section 15.)
2. Steps goal counted per calendar day with streak: confirm.
3. Fine-grained GitHub PAT expires at most yearly: OK to track its expiry in Settings next to the Garmin key?

## 14. Hosting: free route, and why not Databricks

**Decision: $0.** Worker on the free plan for app + API + coach + MCP; GitHub Actions does sync and recompute. Free limits used: Workers 10 ms CPU and 50 subrequests per invocation, D1 free 50 queries per invocation, 5 M rows read and 100 k rows written per day, 5 cron triggers ([Workers limits](https://developers.cloudflare.com/workers/platform/limits), [D1 limits](https://developers.cloudflare.com/d1/platform/limits)).

**Does the Worker itself fit 10 ms CPU? Mostly yes; flagged risks to measure in phase 3 (log `cpu_ms` via Workers observability, fail the phase if p95 > 8 ms):**
- Fits: Hono routing; reading precomputed rows (`load_daily`, `metric_daily`) and `JSON.stringify` of ~2,600 daily rows (~2-3 ms); mileage comparison (SQL `GROUP BY date`, cumulate a few thousand rows <1 ms); 42-day projection; heatmap and streams passthrough (R2 body/gzip streamed, polylines returned as stored strings, not decoded); D1 and R2 waits are I/O, not CPU.
- Rule that keeps it fitting: **all heavy work (CTL/ATL history, correlations, VO2, predictions, readiness, briefing JSON) is computed in the Action and stored**; the Worker only reads. Correlation report is a stored row.
- **Risk 1, Access JWT verify:** RS256 verify via WebCrypto per request; cache the JWKS and the verified-token result in isolate memory for the token's life. Measure.
- **Risk 2, coach chat:** Claude API wait time is not CPU, but streaming SSE relaying, JSON parsing of tool rounds (up to 6) and Anthropic SDK overhead may reach ~5-15 ms. Mitigations: skip the SDK (plain `fetch`), prefer non-streamed responses if streaming costs CPU, keep tool outputs small, read the precomputed briefing row. If still over, coach moves to the Action-triggered path or the project takes Workers Paid; this is the single most likely reason to pay $5.
- **Risk 3, D1 query count:** free allows 50 queries per invocation; coach loop with 6 rounds must use `db.batch()` and stay under ~30 queries.
- **Risk 4, MCP Worker OAuth:** the OAuth library does token hashing and KV I/O; each MCP request may take several ms. Measure; KV free allows 1,000 writes/day (enough for one user).
- **Not done in the Worker (would break the limit):** FIT decoding, backfill, metric recompute, correlation computation.
Escape hatch: Workers Paid ($5/mo) lifts CPU to 30 s by default and raises subrequests; switching needs no code change except optionally moving sync back into a cron.

**Databricks Free Edition as the runner: rejected.** ([docs](https://docs.databricks.com/aws/en/getting-started/free-edition-limitations)) Apps stop after 24 h, serverless only, 5 concurrent job tasks, outbound internet restricted to trusted domains (Garmin/Anthropic reachability unverified), quota overruns shut compute down for the day or month.

**Databricks as the data store with the app on Cloudflare: not recommended.**
- Free Edition compute can be shut down for the rest of the day/month after quota overrun, so the dashboard and coach would intermittently have no data.
- Outbound/inbound limits: the Worker would call a SQL warehouse over REST; sandbox/network restrictions and a single 2X-Small warehouse make this fragile.
- Latency: a warehouse that auto-stops needs seconds to cold start, versus D1 at single-digit ms in the same network; every card and coach tool call would feel it, and the Worker's 10 ms CPU / 50 subrequest budget leaves no slack for polling statement status.
- Extra secrets and failure modes (Databricks PAT or M2M OAuth in the Worker and the Action, token expiry, workspace URL), for a dataset of a few MB that D1 handles.
- Only legitimate use later: **export D1 to Databricks for experiments** (`wrangler d1 export` or an Action step that dumps tables to CSV/Parquet in R2, then upload by hand), read-only and one-way, never in the live path.

## 15. Public repository safety (repo is public; portfolio project)

**Principle:** the repo holds code and docs only. All personal data lives in D1 and R2 behind Access. Anything personal that reaches git, CI logs or an artifact must be treated as published forever.

**Exposure model:** the Worker app stays behind Cloudflare Access (and verifies the Access JWT itself), so the public repo exposes code, not data. `wrangler.toml` is gitignored; commit `wrangler.example.toml` (no account id, workers.dev subdomain, Access team or AUD). Post-deploy checklist (script `scripts/check-exposure.sh`, reads the URL from env, run by hand): unauthenticated `curl` to `/`, `/api/status`, `/api/activities`, `/api/sync` must return an Access redirect or 401/403, never data. The MCP Worker intentionally serves only OAuth discovery/registration endpoints publicly; `/mcp` returns 401 without a valid token. The endpoint that triggers the workflow (`POST /api/sync`) sits behind Access, uses the dispatch PAT only server-side, and is rate-limited by `sync_state.dispatch_requested_at` (one dispatch per 2 min). The PAT is repo-scoped, Actions read/write only, so even a leak cannot read code or secrets.

**Secrets**
- Held only in: GitHub Environment `prod` secrets (`GARMIN_API_KEY`, `CF_API_TOKEN`, R2 keys, IDs) and Worker secrets (`GITHUB_DISPATCH_TOKEN`, `ANTHROPIC_API_KEY`, Access/OAuth). `.dev.vars` is local, gitignored. Cloudflare API token scoped to D1 edit on one database only; R2 token scoped to one bucket.
- GitHub masks the exact secret string in logs, not transformations of it (base64, substrings, JSON-embedded). So: never echo secrets, never `set -x`, mask derived values with `::add-mask::` (the minted Garmin JWT right after minting).
- Fork PRs: workflows triggered by `pull_request` from forks receive no secrets and a read-only token; **never use `pull_request_target` or `workflow_run` with checkout of PR code**. Repo settings: "Require approval for all outside collaborators", default `GITHUB_TOKEN` permission read-only, "Allow GitHub Actions to create PRs" off. Workflows declare `permissions: contents: read` at top. `sync.yml` triggers only `schedule` and `workflow_dispatch` (both run on the default branch and need write access to start manually), and its job uses `environment: prod` restricted to `main`. CI workflow (`ci.yml`, tests + gitleaks) uses `pull_request`/`push` and has no secrets. Third-party actions pinned to commit SHAs.
- Turn on GitHub secret scanning and push protection (free on public repos) before the first push.

**Never commit personal data** (`.gitignore`, section below): `.dev.vars`, `.env*`, `.samples/`, `*.fit`, `*.zip`, `*.gpx`, `*.sql` dumps, `*.sqlite`, `.wrangler/`, `wrangler.toml`, `.personal-strings`, `exports/`, `node_modules/`, `.DS_Store`, and the third-party `ui-ux-pro-max-skill/` folder (not ours, not for the repo). No real HR values, user id, activity ids, coordinates, names or screenshots of the real dashboard in code, tests, docs or design mocks.
- **Pre-commit hook:** gitleaks (`gitleaks protect --staged`) plus `scripts/check-personal.sh`, which greps staged files for strings listed in the **untracked** `.personal-strings` file (user id, email, first name, Garmin key prefix, home coordinates). CI runs `gitleaks detect` on every push/PR (it cannot know the personal strings, hence the local hook is the real guard).
- Git identity: set `user.email` to the GitHub noreply address before the first commit; commit metadata is public.

**Workflow logs are world-readable.** Rules for `sync/run.ts`: log only stage names, counts and HTTP status codes ("daily: 3 rows upserted", "fit: 5 ok, 0 failed"); never log request URLs (they contain dates and activity ids), response bodies, coordinates, HR values, ids, or exception messages from the HTTP client (wrap errors to `status + endpoint-name` only). No `DEBUG` env in CI; do not upload artifacts (public repo artifacts are downloadable by anyone) and do not use caches for data or job summaries with data. Keep a unit test that runs the logger with a fixture secret/id and asserts it never appears in output.

**Fixtures, tests, design mocks:** synthetic only (generated numbers, invented routes, fictional name). The FIT test fixture is produced by the Garmin SDK encoder at test time. Metrics tests use illustrative HR values (LTHR 170 / rest 50 / max 190). Design mocks use mock data; keep it fictional.

**Garmin terms:** the Personal API is licensed for the account holder's own use (I did not re-read the current terms: confirm them once before the first commit). Do not republish Garmin data in the repo: no API response dumps, no copied OpenAPI spec, no screenshots of real data; the repo documents endpoint names and field shapes only. Add a README line "Not affiliated with Garmin; personal use; bring your own API key." Do not use Garmin logos.

**Licence:** MIT for code and docs (simplest, standard for portfolios). Third-party libraries keep their own licences; check `@garmin/fitsdk` licence terms before distributing a build (it is Garmin's FIT SDK licence, usually fine for use in apps).

**Redaction review:** docs contain no ids, coordinates, real HR values or personal volumes. The design mocks are kept out of the repo.

**Safe first-commit procedure** (no git history exists yet, so it starts clean):
1. Write `.gitignore` and `.personal-strings` first; install gitleaks; set the noreply git identity.
2. `git init`; run `gitleaks detect --no-git --source .` and `scripts/check-personal.sh .` on the working tree; fix findings.
3. `git add -A`; read `git status` and `git diff --cached --stat` line by line (no `.fit`, `.samples`, `.dev.vars`, `.wrangler`, skill folder). Commit locally.
4. On GitHub create the empty public repo; enable secret scanning and push protection and the settings above; add the `prod` environment and secrets; only then `git push`.
5. If anything personal is found after pushing: rotate the exposed secret first (Garmin key, tokens), then delete or rewrite history; assume it was scraped.
