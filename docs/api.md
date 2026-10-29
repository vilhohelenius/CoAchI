# Read API (phase 3a)

All routes sit behind Cloudflare Access and return JSON. Dates are local calendar dates, distances are metres, durations are seconds, units are converted in the frontend only. Every response has `as_of` (ISO time of the response). Metric data comes from `load_daily` and `metric_daily`, which the sync runner fills with `recompute`. Numbers below are invented. A field is `null` when its input is missing, and each readiness component states `available` and `n`.

Empty database: `/api/today` returns `{ as_of, data_date: null }`, the others return empty lists.

## GET /api/today

```json
{
  "as_of": "2030-06-01T12:00:00.000Z", "data_date": "2030-06-01",
  "status": { "label": "Productive", "reason": "Fitness is rising and fatigue is manageable.", "ctl": 41.2, "atl": 48.9, "tsb": -7.7, "acwr": 1.12, "ramp7": 2.4, "warming_up": false },
  "readiness": { "score": 68.4, "label": "moderate", "confidence": "ok", "capped": false, "n_components": 5, "drivers": ["sleep", "hrv"],
    "components": [ { "key": "hrv", "label": "HRV vs your normal", "weight": 30, "available": true, "n": 58, "score": 74.1, "value": "z 0.2" },
                    { "key": "body_battery", "label": "Body battery", "weight": 5, "available": false, "n": 0, "score": null, "value": null } ] },
  "last_activity": { "id": 1, "start_local": "2030-06-01 07:00:00", "type": "running", "name": "Morning run", "distance_m": 8000, "duration_s": 2700,
    "avg_hr": 150, "elev_gain_m": 40, "load": 61.3, "load_source": "zones", "aero_te": 3.1, "rpe": null },
  "sleep": { "date": "2030-06-01", "total_s": 27000, "deep_s": 4000, "light_s": 14000, "rem_s": 7000, "awake_s": 2000, "score": 82, "start_ts": 1893000000000, "end_ts": 1893027000000 },
  "tiles": { "steps": 6400, "step_goal": 10000, "rhr": 50, "stress_avg": 27, "body_battery_max": 85, "hrv_last_night": 58, "hrv_garmin_status": "BALANCED",
    "hrv": { "last": 58, "h7": 57.2, "base": 55.0, "low": 47.0, "high": 64.5, "z": 0.2, "z_last": 0.3, "status": "in_range", "n7": 7, "n_base": 58, "range_ok": true },
    "recovery": { "rhr7": 50.4, "z_rhr": -0.3, "divergence": "normal", "balance": { "hrv": "in", "rhr": "in", "balanced": true }, "streak_days": 9 },
    "sleep_stats": { "sd_min": 24.5, "n_nights7": 7, "social_jetlag_min": 35, "debt_h": 1.5, "n_debt": 14, "need_h": 8 } },
  "this_week": { "start": "2030-05-27", "sessions": 4, "distance_m": 32000, "duration_s": 10800, "load": 240.5, "run_distance_m": 32000,
                 "days": [ { "date": "2030-05-27", "km": 8.0, "active_min": 45 } ] },
  "goals": { "year": { "...": 0 }, "week": { "...": 0 }, "steps": { "...": 0 } }
}
```

`status.reason` is the plain sentence from `trainingStatus()`, saved by recompute for the latest day only (`null` until the next recompute). `this_week.days` has 7 entries, Monday first, with the km and active minutes of all activities (0 on rest days). `goals` is the same object as `progress` in `/api/goals`, or `null`. `status.label` is one of Productive, Maintaining, Recovery, Overreaching, Detraining, Not enough data. `readiness.label` is high (80+), moderate (60-79), low (40-59), poor. `confidence` is `ok`, `low` (under 3 components) or `none`. `divergence` is one of strain, hrv_dip, rhr_rise, recovered, hrv_high, normal or null. `hrv.status` is below, in_range, above or null (the normal range is only shown when `range_ok`).

## GET /api/load?days=180 (or from=YYYY-MM-DD)

```json
{ "as_of": "...", "acwr_band": [0.8, 1.3],
  "days": [ { "date": "2030-06-01", "load": 61.3, "ctl": 41.2, "atl": 48.9, "tsb": -7.7, "tsb_end": -9.1, "acwr": 1.12, "ramp7": 2.4, "status": "Productive", "warming_up": 0 } ],
  "per_sport": { "run": [ { "date": "2030-06-01", "load": 61.3, "ctl": 30.1, "atl": 40.0, "tsb": -9.9, "acwr": 1.2, "n35": 17 } ] },
  "projection": { "date": "2030-06-01", "ctl": 41.2, "atl": 48.9, "ctl_tau": 42, "atl_tau": 7,
    "typical_week": [60, 0, 55, 0, 62, 0, 90],
    "rest": [ { "ctl": 40.2, "tsb": -7.7 } ], "typical": [ { "ctl": 40.9, "tsb": -7.7 } ] } }
```

`tsb` is form going into the day, `tsb_end` after it. A sport appears in `per_sport` only on days with at least 5 sessions in the previous 35 days (otherwise show "not enough data"), and per-sport history covers the last 400 days. `projection.rest` and `typical` hold 21 entries for the 21 days after `projection.date`, `typical_week` is the mean load per weekday (Monday first) over 28 days. For a slider, run `ctl += (load - ctl) * (1 - exp(-1/42))` and `atl += (load - atl) * (1 - exp(-1/7))` per day, with `tsb = ctl - atl` taken before the update.

## GET /api/recovery?days=90

```json
{ "as_of": "...",
  "days": [ { "date": "2030-06-01", "hrv": { "...as tiles.hrv" }, "recovery": { "...as tiles.recovery" }, "sleep": { "...as tiles.sleep_stats" },
              "readiness": { "score": 68.4, "label": "moderate", "confidence": "ok", "components": [] } } ],
  "rhr": [ { "date": "2030-06-01", "rhr": 50 } ],
  "body_battery": [ { "date": "2030-06-01", "charged": 60, "drained": 55, "min_level": 20, "max_level": 85 } ],
  "sleep_nights": [ { "date": "2030-06-01", "start_ts": 1893000000000, "end_ts": 1893027000000, "total_s": 27000, "deep_s": 4000, "light_s": 14000, "rem_s": 7000, "awake_s": 2000, "score": null } ],
  "sleep_composition": { "n": 28, "min": { "deep": 66, "rem": 115, "light": 230, "awake": 33 }, "share": { "deep": 0.15, "rem": 0.26, "light": 0.52, "awake": 0.07 } } }
```

Each key under a day can be missing when its inputs were missing that day. Sleep scores are `null` for nights before they existed, and then only durations are available.

## GET /api/intensity?weeks=8

```json
{ "as_of": "...",
  "weeks": [ { "week_start": "2030-05-27", "minutes": { "run": [120, 80, 20, 10, 2], "bike": [60, 20, 0, 0, 0] } } ],
  "share_28d": { "all": { "easy": 0.78, "mid": 0.12, "hard": 0.1, "minutes": 900 }, "by_sport": { "run": { "easy": 0.8, "mid": 0.1, "hard": 0.1, "minutes": 700 } }, "easy_target": [0.75, 0.85] } }
```

`minutes` are per Garmin HR zone 1 to 5, using each sport's own zone floors. `easy` is zones 1-2, `mid` zone 3, `hard` zones 4-5.

## GET /api/goals

```json
{ "as_of": "...", "data_date": "2030-06-01",
  "goals": [ { "id": 1, "kind": "distance", "title": "Yearly distance", "target_value": 2000, "target_max": null, "unit": "km", "target_date": null, "status": "active" } ],
  "progress": {
    "year": { "target_km": 2000, "ytd_km": 800.2, "expected_km": 832.9, "diff_km": -32.7, "status": "on_pace", "projected_km": 1960.4, "avg_week_km_8w": 52.1 },
    "week": { "band_lo": 50, "band_hi": 60, "week_start": "2030-05-27", "km": 36.7, "status": "ahead",
              "previous": [ { "week_start": "2030-05-20", "km": 55.0, "status": "in_band" } ] },
    "steps": { "goal": 10000, "today": 6400, "streak_days": 4, "today_pending": true, "hit_30d": 21, "avg_7d": 10400, "avg_30d": 9800, "status": "on_pace" } } }
```

Statuses are pace words and never pass or fail. Year and steps use `ahead`, `on_pace`, `behind`. The current week uses the same words against the part of the band that fits the days elapsed. Finished weeks use `below_band`, `in_band`, `above_band`. Yearly distance counts running activities only. `projected_km` is a straight line from the 8-week average. `streak_days` counts consecutive calendar days at or above the goal, today only counts once reached and is otherwise `today_pending`.

## Recompute

`tsx sync/run.ts recompute [--full] [--target remote]` rebuilds the derived tables. It also runs at the end of `steady` (last 14 days written, `RECOMP_DAYS` to change) and `backfill` (full). The first run on an empty `load_daily` is always full. Older edits to raw rows need `--full`.
