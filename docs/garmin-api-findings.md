# Garmin Connect Personal API: findings (spike, 2026-10-29)

Tested against one real account. Raw (truncated) samples in `.samples/` (gitignored, contains personal data: user id, GPS, HR values; never commit).
Spec source: the OpenAPI 3.0.1 JSON is embedded in the JS bundle of https://developer.garmin.com/gc-developer-program/personal/swagger-docs/ (no separate URL). 32 GET endpoints, read-only, servers `personal.connectapi.garmin.com` / `.cn`.

## Auth

1. Key created in Garmin Connect web (expiry 30/90/180/365 days; email warning ~1 week before; shown once).
2. `POST https://personal.connectapi.garmin.com/personalapitoken-service/personal-api/personal-api-key/token` with header `Authorization: ApiKey <key>`, no body.
3. Response is `200 text/plain`: the **bare JWT** (not JSON). Use as `Authorization: Bearer <jwt>`.
4. JWT lifetime exactly 24h (exp-iat = 86400). No refresh token: just re-POST. Scopes in token: `CONNECT_READ, PERSONAL_API_FITNESS_READ, PERSONAL_API_NUTRITION_READ, PERSONAL_API_USER_READ, PERSONAL_API_WELLNESS_READ`.
5. Worker plan: cache JWT in KV/D1 with exp; on 401 or <1h left, re-mint. Key lives in a Worker secret. Key itself expires (max 1 year): put a reminder + surface 401-on-mint in the dashboard.

## Rate limits

No rate-limit headers (`X-RateLimit*`, `Retry-After`) seen on any response; ~75 calls at 1 req/s, zero 429s. Limits are undocumented, so keep 1 req/s with backoff on 429/5xx. Responses are large (365-day daily summaries = ~1 MB), so cost is bandwidth, not call count.

## Endpoints and max window per request (tested)

| Data | Endpoint | Max window (tested) |
|---|---|---|
| Activity list | `GET /activitylist-service/activities/search/activities` (`start`, `limit` default 99, `startDate`/`endDate`, `activityType=running`, `sortOrder`, min/max distance etc.) | paged; 99/page works; a year of activities fits in a couple of pages |
| Activity summary | `GET /activity-service/activity/{id}` | single |
| Activity FIT | `GET /download-service/files/activity/{id}` returns a **ZIP** containing `{id}_ACTIVITY.fit` | single (180 KB zip / 374 KB fit for 52 min run) |
| Activity workouts | `GET /activity-service/activity/{id}/workouts` | single (empty list for a free run) |
| Daily summary v2 | `GET /usersummary-service/v2/dailysummaries?startDate&endDate` | 365 days OK (349 items); 3 years: 400 |
| Daily summary v1 | `GET /usersummary-service/usersummary/daily?calendarDate` | single day |
| HRV | `GET /hrv-service/hrv/{date}` (with 5-min readings); `/hrv/daily/{from}/{to}` (nightly summary) | range 365 days OK; 2 years: 400 |
| Sleep | `GET /sleep-service/sleep/dailySleep?date`; `/dailySleepSummariesByDate?startDate&endDate` | 32 days OK, 35 fails |
| Heart rate (intraday) | `GET /wellness-service/wellness/dailyHeartRate?date` | single day (~2 min samples) |
| Stress daily | `GET /usersummary-service/stats/stress/daily/{from}/{to}` | 28 days (29 fails) |
| Steps daily | `GET /usersummary-service/stats/steps/daily/{from}/{to}` | 28 days |
| Body battery | `GET /wellness-service/wellness/bodyBattery/reports/daily?startDate&endDate&chunks` | 31 days (32 fails) |
| SpO2 | `GET /wellness-service/wellness/daily/spo2acclimation/{date}` | single day |
| Weight | `GET /weight-service/weight/range/{from}/{to}?includeAll`; `/weight/all/{from}/{to}` | range ok; `/all` returned 400 for every window tried (cause unknown) |
| Weight goal | `GET /goal-service/goal/user/effective/weightgoal/{from}/{to}` | ok, empty |
| HR zones | `GET /biometric-service/heartRateZones/v2` | current only |
| Fitness age | `GET /fitnessage-service/fitnessage/v2/{date}` | latest as of date |
| User settings | `GET /userprofile-service/userprofile/settings` | n/a |
| Hydration | `GET /usersummary-service/stats/hydration/daily/{from}/{to}` | ok, empty (not logged) |
| Nutrition | `GET /nutrition-service/food/logs/{date}` | ok, empty (not logged) |
| Women's health | `GET /periodichealth-service/menstrualcycle/{summary,dayview}/{date}` | 204 no content (not applicable) |
| Wellness activity | `GET /wellnessactivity-service/activity/summary/range/{from}/{until}` | ok, empty (non-sport wellness activities) |

Empty ranges return `200 []`, `204`, or `200 {...nulls}`, so treat all three as "no data".

## Data availability matrix

| Type | Avail | Key fields / units / granularity |
|---|---|---|
| Activities (summary) | Y | `activityId, startTimeLocal/GMT, activityType.typeKey, distance (m), duration/movingDuration/elapsedDuration (s), averageSpeed/maxSpeed (m/s), elevationGain/Loss (m), averageHR/maxHR, averageRunningCadenceInStepsPerMinute, avgPower/maxPower/normPower (W), aerobicTrainingEffect, anaerobicTrainingEffect, trainingEffectLabel, activityTrainingLoad, avgVerticalOscillation, avgGroundContactTime, avgStrideLength, avgVerticalRatio, avgGradeAdjustedSpeed, hrTimeInZone_1..5 (s), powerTimeInZone_1..5, fastestSplit_1000/1609/5000/10000, differenceBodyBattery, avgRespirationRate, moderate/vigorousIntensityMinutes, lapCount, splitSummaries[]` |
| Activity detail | Y | same plus `directWorkoutFeel, directWorkoutRpe, impactLoad, stepSpeedLoss(Percent), begin/endPotentialStamina, minAvailableStamina, sensors[], per-km-ish splitSummaries` (no per-lap list, no time series) |
| FIT file | Y | see FIT section |
| Sleep | Y | `sleepTimeSeconds, deep/light/rem/awakeSleepSeconds, sleep start/end ts (ms), sleepScores.overall.value + qualifier, avgSleepStress, avgHeartRate, avg/low/high SpO2, respiration, awakeCount, sleepNeed, napTime, bodyBattery change` (once per night) |
| HRV | Y | nightly `lastNightAvg (ms), weeklyAvg, lastNight5MinHigh, baseline{lowUpper,balancedLow,balancedUpper}, status, feedbackPhrase`; day endpoint adds `hrvReadings[]` every 5 min |
| Resting HR / HR | Y | daily min/max/resting + 7-day avg resting; intraday `[ts_ms, bpm]` ~every 2 min |
| Stress | Y | daily avg/max level, durations by band (low/med/high/rest); no intraday series in these endpoints |
| Body battery | Y | `[ts_ms, level]` series (~3-min), charged/drained, dynamic feedback + activity impact events |
| Steps / distance / floors / calories / intensity minutes | Y | daily (v2 summary, steps range) |
| Respiration | Y | daily avg/min/max/latest in v2 summary; sleep respiration in sleep |
| SpO2 | Y | daily avg/low/latest, hourly averages, sleep SpO2 |
| Training readiness | **N** | no endpoint |
| Training status / load balance / acute load | **N** | no endpoint (only per-activity `activityTrainingLoad`, FIT `training_load_peak`) |
| VO2max / race predictor / endurance score | **N** | not in any JSON (see FIT) |
| Recovery time, performance condition | **N** | not in JSON |
| Fitness age | Y | `fitnessAge, chronologicalAge, components` |
| Body composition | Unknown | endpoint works but is empty without weigh-ins; `/weight/all` 400 |
| Women's health | N for this account | 204 |
| Hydration / nutrition | Y (endpoint), empty | not logged |
| HR zones | Y | LTHR, max HR, resting HR (values omitted), zone floors; trainingMethod LACTATE_THRESHOLD |
| Lap list / GPS stream / per-second data | **N via JSON** | only via FIT |

## FIT file (one sample run, id redacted)

Contains: `record` x3124 (1 Hz-ish: timestamp, lat/long, distance, enhanced_speed, enhanced_altitude, heart_rate, cadence + fractional, power, stance_time(+balance/%), step_length, vertical_oscillation, vertical_ratio, respiration rate, temperature), `lap` x12, `session`, `split`/`split_summary`, `time_in_zone` (HR and power zones, LTHR, FTP, resting HR), `device_info`, `sport`, `user_profile`, `zones_target`, and a `hrv` message stream (3376 R-R interval records: beat-to-beat data, good for DFA/ecg-style analysis).
Session also has `total_training_effect`, `total_anaerobic_training_effect`, `training_load_peak`, `workout_feel`, `workout_rpe`, `sport_profile_name`, `avg_power/normalized_power`, running dynamics averages.
Cadence: `avg_running_cadence` is per-leg (87) so spm = 2x plus fractional.
**Removed fields (VO2max, recovery time, performance condition): not decodable.** The file has several proprietary messages (unknown 140, 79, 147, 22, 499, 545...) with unlabelled integer fields; 140 looks like the Garmin physiological-metrics blob, but without Garmin's profile mapping we cannot trust any number as VO2max. Treat as unavailable.
JSON summary vs FIT agree on distance/HR/TE. JSON lacks laps, GPS, per-second HR/power/cadence and RR intervals; FIT lacks the human-readable labels (trainingEffectLabel).

## History and backfill

- Activities: back to the first activity. 99/page.
- Daily summaries and sleep/body battery exist back several years but are device-dependent: older years can return partial daily summaries, and sleep, HRV and daily HR can be empty for some periods. Expect gaps from earlier watches.
- Windows: daily v2 / HRV 365d; sleep 32d; body battery 31d; stress/steps 28d; intraday HR/SpO2/HRV-readings per day.
- **Backfill plan:** one-off script (run locally or Worker queue), 1 req/s:
  1. activities: page through all (full history, ~1 call per 99), upsert summary JSON.
  2. daily summary v2 and HRV daily in 365d chunks back to first activity date; sleep in 28d chunks; body battery 28d chunks; stress/steps are redundant with v2 (skip).
  3. FIT: download only for running activities (last ~12 months first; lazily older), store zip in R2, parse into per-activity derived metrics in a Worker/queue.
  4. Intraday HR, body battery series, HRV readings: fetch per day for the last ~90 days only; older days keep daily aggregates.
- **Steady state:** cron every few hours: activity list `limit=20`, then detail/FIT for new IDs; yesterday+today daily summary, sleep, HRV; re-fetch the last 3 days (sleep/HRV finalise late).

## Gaps and who fills them

| Gap | Resolution |
|---|---|
| Training readiness, training status, acute/chronic load, load focus | compute ourselves from `activityTrainingLoad` (EPOC-like) plus HRV/sleep/RHR/body battery (acute:chronic ratio, ramp) |
| VO2max / race predictions | estimate ourselves (HR-vs-pace/power model from FIT, or Riegel from best efforts); Strava MCP `get_athlete_best_efforts` for best efforts |
| Recovery time, performance condition | compute (readiness score) or skip |
| Laps/GPS/streams | parse FIT (fitdecode in Worker is not an option: Python only; use a JS FIT parser such as `fit-file-parser`/Garmin FIT JS SDK), or Strava MCP `get_activity_streams` as fallback |
| Weight / body comp | none on this account; manual entry or skip |
| Training plan / zones | Garmin gives HR zones; Strava MCP `get_athlete_zones` / `get_training_plan` as cross-check |

## Proposed D1 tables

- `sync_state(key PK, value, updated_at)`: token cache metadata, cursors, backfill progress, key expiry.
- `activities(id PK, start_local, start_gmt, type, name, distance_m, duration_s, moving_s, elev_gain_m, avg_hr, max_hr, avg_cadence, avg_power, norm_power, aero_te, anaero_te, training_load, rpe, feel, raw_json, fit_r2_key)`
- `activity_splits(activity_id, idx, kind, distance_m, duration_s, avg_hr, avg_speed, elev_gain_m, avg_power)`: from FIT laps.
- `activity_fit_metrics(activity_id PK, ... derived: hr_drift, pace_decoupling, cadence_cv, rr_summary)`; raw FIT in R2.
- `daily_summary(date PK, steps, distance_m, kcal_active, kcal_total, rhr, hr_min, hr_max, intensity_mod, intensity_vig, stress_avg, bb_min, bb_max, bb_charged, bb_drained, resp_avg, spo2_avg, spo2_min, raw_json)`
- `sleep(date PK, start_ts, end_ts, total_s, deep_s, light_s, rem_s, awake_s, score, avg_hr, avg_stress, spo2_avg, resp_avg, raw_json)`
- `hrv_daily(date PK, last_night_avg, weekly_avg, high_5min, base_low, base_balanced_low, base_balanced_upper, status)`
- `intraday(date, metric, json)`: PK(date, metric) for hr / body_battery / hrv_readings (short retention).
- `hr_zones(effective_date PK, lthr, max_hr, rest_hr, z1..z5 floors)`
- derived: `load_daily(date PK, acute, chronic, acwr, readiness)`.

---

# Addendum: interval steps and cycling (follow-up spike)

## Interval data model (verified on two structured sessions)

Tested on two structured interval sessions (a 400 m repeat set and a 1000 m repeat set), both with a workout scheduled from Garmin Connect. Placeholders only below.

**Source of truth is the FIT `lap` message, not the JSON.** Each lap carries:
- `intensity`: `warmup | active | recovery | rest | cooldown` (also `interval`, `other` for free laps). This is the step type for filtering.
- `wkt_step_index`: index into the `workout_step` messages (0-based, repeat blocks are unrolled, so a repeat group of N reps shares one index while its set number changes the index, e.g. set 1 = idx 1/2, set 2 = idx 5/6).
- `lap_trigger`: `manual` (button/step end), `distance`/`time` (step with a fixed duration, or auto-lap), `session_end`.
- `total_timer_time` (s), `total_distance` (m), `enhanced_avg_speed` (m/s, pace = 1000/speed s per km), `avg_heart_rate`, `max_heart_rate`, plus power, cadence, vertical oscillation, GCT, `start_time`, `total_ascent`/`total_descent`.
The `workout` message gives `wkt_name` (e.g. `2x10x400m`) and `workout_step` messages give `intensity`, `duration_type` (open/time/distance/repeat_until_steps_cmplt), `target_type` and speed target low/high.

**Structure matched expectations:** work laps of the planned 400 m (tolerance +-10 m, about 75-80 s each, avg HR rising across reps, max HR per lap present), recoveries at a fixed 45 s (about 55-75 m covered) plus a final recovery, one 180 s `rest` lap between the two sets, warmup and cooldown. The 1000 m session had one work lap and one 90 s recovery per repetition. Per-lap time, distance, speed, avg HR and max HR are all present on every lap.

**Caveats**
- Warmup/cooldown without a duration get split by the watch's 1 km auto-lap into several laps sharing the same `intensity` and `wkt_step_index`; merge consecutive laps with the same `wkt_step_index` for a Garmin-style single warmup/cooldown row (sum time/distance, duration-weighted pace and HR, max of max HR). Do NOT merge `active` laps (each rep is its own lap; the same `wkt_step_index` repeats per rep).
- Rep number = running count of `active` laps within the set. Set number = distinct `wkt_step_index` among active laps.
- Open-ended recoveries (45 s here) cover distance, so recovery pace is noisy; show time and HR only.
- Free runs also have laps (auto 1 km, `intensity` mostly `active`, no `wkt_step_index`); they can fill the same table with `step_type = 'lap'` or be skipped.

**JSON endpoints:** the activity-detail `splitSummaries` is an aggregate per type, not per rep: `INTERVAL_WARMUP / INTERVAL_ACTIVE / INTERVAL_RECOVERY / INTERVAL_REST / INTERVAL_COOLDOWN` (each with noOfSplits, distance, duration, averageSpeed, averageHR, maxHR, power, cadence, ...) plus `RWD_RUN / RWD_WALK / RWD_STAND` (run/walk/stand detection). Useful as cheap totals per step type (e.g. "all work reps avg HR") and as a cross-check, but there is no per-rep list in JSON and no laps endpoint. `/activity/{id}/workouts` returns the planned workout (name, steps with intensity, duration type, target low/high speed in m/s, repeat counts), which is the plan side for plan-vs-actual.

**Recommendation:** fetch the FIT for every activity whose name matches a workout (or whose `lapCount` is more than the km count, or whose `/workouts` is non-empty), parse `lap` + `workout_step` + `workout`, and store in D1. Use JSON `splitSummaries` for quick per-type totals without a FIT.

```
activity_steps(
  activity_id, lap_idx,              -- PK (activity_id, lap_idx)
  step_type,                         -- intensity: warmup|active|recovery|rest|cooldown|other
  wkt_step_index, set_no, rep_no,    -- derived as above
  start_time, duration_s, distance_m,
  avg_speed_mps, avg_hr, max_hr,     -- pace derived at read time
  avg_power, avg_cadence, ascent_m, trigger
)
activity_workouts(activity_id PK, name, plan_json)   -- from workout/workout_step or /workouts
-- display rows: GROUP consecutive laps by (wkt_step_index, step_type) for warmup/cooldown/rest; one row per lap for active/recovery
-- filter by step type = WHERE step_type = 'active'
```

A second structured session type (1000 m repeats) confirmed the typing works with distance-based work steps and time-based recoveries; other titled sessions exist in the list but were not inspected.

## Cycling and power

- 21 rides in the last 12 months, all `road_biking` (filter by `activityType=road_biking`; `cycling`, `indoor_cycling`, `mountain_biking` etc. return 400 as the type key must match exactly).
- None have `avgPower`, `normPower`, `maxPower` or power zone times in the list JSON. Detail JSON for a sampled ride also has no power. A sampled ride FIT has about 1,200 records containing only speed and heart rate (no power, no cadence, no power meter sensor); session `avg_power`/`normalized_power` empty.
- Conclusion: no power data on the tested account's cycling (rides are HR + speed only). Cycling load must be estimated from HR (e.g. TRIMP/HR zone time) and duration; for the dashboard treat bike as secondary load, power-based TSS not possible unless a power meter is added. Running power exists and is populated for runs.
