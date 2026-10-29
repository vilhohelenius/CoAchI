# CoAchI: advanced metrics catalogue

**"Explain this" delivery:** each template below is the static fallback and the grounding text. In the UI every card has an Explain button; with the coach key present the text is LLM-rewritten from the metric's current values (no new numbers), cached per (metric, date, input hash), with a Regenerate button; at spend cap or without key the static template is shown. Details and cost in plan.md section 7.

Notation: `HRr = (HR - rest)/(max - rest)`. HR values come from Garmin's own zone settings, synced each run and stored by effective date per sport (per sport, e.g. LTHR/max/rest differ slightly by sport; this doc uses illustrative LTHR 170, max 190, rest 50); sex = male. Max observed HR from FIT is tracked and flagged if above Garmin's max. `d` = local date. All metrics are computed in pure functions (`src/metrics/*`) from D1 data; "n" = sample count shown beside each value. Priority: **MVP** = phases 3-4, **Later** = phase 6+.

General honesty rules: show the number with its n and the time window; show "insufficient data" instead of a guess; every estimate is labelled "CoAchI estimate" and not expected to match Garmin/Firstbeat; none of this is medical advice.

Data availability reminder: activities from the first synced one (HR-based load works back to then; FIT-based metrics for what we download); sleep/HRV/body battery from Nov 2025 only, so HRV baselines are valid from about Dec 2025 (>= 21 nights).

---

## 1. Per-activity training load (TRIMP / hrTSS-style) , MVP

- **Formula:** Banister TRIMP per second summed: `TRIMP = sum(dt_min * HRr * k1 * e^(k2*HRr))`, male constants k1=0.64 k2=1.92 (user is male; female variant 0.86/1.67 not used). Normalised so 1 h at LTHR = 100: `load = TRIMP / TRIMP_1h_at_LTHR * 100` using the sport's LTHR/rest/max effective on the activity date (illustrative LTHR 170 / rest 50 / max 190: HRr at LTHR = 120/140 = 0.86, 1 h TRIMP about 171).
- **Fallbacks (flagged `load_source`):** (a) no FIT but have `hrTimeInZone_1..5`: TRIMP with zone-midpoint HRr; (b) only avg HR: TRIMP from avg HRr x duration (underestimates intervals); (c) no HR (or strength, where wrist HR is unreliable): session-RPE `load = min/60 * (RPE/7.5)^2 * 100` (default RPE 5 if missing; Garmin `directWorkoutRpe` appears on a 0-100 scale in steps of 10, so divide by 10).
- **Inputs:** FIT HR stream, `hr_zones` row for sport+date, RPE (user-entered for strength; show an "RPE missing" badge).
- **Availability:** all activities via fallbacks; per-second since FIT download.
- **Caveats:** HR lags on short intervals, drifts up with heat/dehydration (inflates load), cardiac drift in long easy runs; cycling/skiing HR is lower for the same effort. Not comparable with Garmin `activityTrainingLoad` (EPOC); we store both, never mix. Max HR error moves everything.
- **Explain this:** "Load measures how hard a session was for your body, combining how long you went and how high your heart rate was relative to your own limits. 100 is roughly one hour at your threshold. Today's run scored {load}, which is {easy/moderate/hard} for you (your typical run: {median})."

## 2. CTL / ATL / TSB with forward projection , MVP

- **Formula:** daily load `L_d` (sum of the day's activities, 0 on rest days). `CTL_d = CTL_{d-1} + (L_d - CTL_{d-1})(1 - e^(-1/42))`, `ATL_d` same with 7. `TSB_d = CTL_{d-1} - ATL_{d-1}` (form going into the day; also show end-of-day). Factors 0.9765 / 0.8669 match what Intervals.icu documents.
- **Projection:** continue the same recursion for future days with planned load `P_d`. Three scenarios: (a) **rest** (P=0), (b) **typical** (P = mean load of that weekday over the last 4 weeks), (c) **planned** (user/coach-entered `planned_load`, missing days fall back to typical). Output CTL/ATL/TSB per day for 42 days plus "date when TSB crosses +5 / +15" and "CTL on race day". Coach tool `project_load` accepts ad-hoc plans ("what if I run 60 load Thursday and rest Friday").
- **Status label (Form and Fitness card):** from CTL trend and TSB: ramp7 > +1 and TSB -30..-10 "Productive"; ramp7 > +1 and TSB > -10 "Building (fresh)"; ramp7 within +-1 "Maintaining"; ramp7 < -1 "Detraining/Recovering" ("Recovering" if ATL fell sharply after a hard block); TSB < -30 "Overreaching risk". Thresholds are heuristics and shown with the numbers.
- **Forward view cards (21 days):** curve for a user-chosen constant daily load (slider) or scenario, plus cards "in 7/14/21 days: CTL x, TSB y", e.g. "in 14 days CTL 44, TSB -8". Same recursion as above.
- **Inputs:** load history from the first activity (warm-up: first 84 days after first activity are marked "warming up").
- **Availability:** MVP; works with all history. Multi-sport on one scale (a bike hour at same HR load counts the same; caveat below).
- **Caveats:** time constants 42/7 are conventions, not your physiology; HR load across sports is not equivalent; unrecorded training (no watch) is zero load; after a layoff CTL falls fast, which is real. Projection is arithmetic, not a performance prediction. Typical-week scenario assumes you keep your habits.
- **Explain this:** "Fitness (CTL) is your slow-moving average training load over about 6 weeks; Fatigue (ATL) is the last week. Form (TSB) is Fitness minus Fatigue: negative means you are carrying fatigue, positive means fresh. Now: fitness {ctl}, fatigue {atl}, form {tsb}. If you rest until {date}, form reaches {x}; with your usual week it stays near {y}."

## 3. ACWR and ramp rate , MVP

- **Formulas:** rolling uncoupled ACWR = `mean(L over days d-6..d) / mean(L over d-34..d-7)`; also report EWMA version `ATL/CTL`. Ramp rate = `CTL_d - CTL_{d-7}` (also 28 d). Weekly distance ramp = `km_week / mean(km previous 4 weeks) - 1`.
- **Per discipline:** also compute ACWR from each sport's own load series (run, bike, ski, strength) and draw bars with the 0.8-1.3 band shaded; hide a sport with < 5 sessions in the last 5 weeks ("not enough data").
- **Availability:** MVP. Need >= 5 weeks history.
- **Caveats:** the "sweet spot 0.8-1.3, danger > 1.5" rule has contested evidence and is a population heuristic (it works poorly after a layoff since chronic is tiny and ratio spikes). Show as a trend with a soft band and never as a standalone verdict. Ramp commonly cited comfortable range is about 3-7 CTL/week (Friel's 5-8 is cited by Intervals.icu docs); beginners and returners should be lower.
- **Explain this:** "ACWR compares the last 7 days of training to the previous 4 weeks. Around 1.0 means you are doing what your body is used to; above ~1.5 means a sudden jump, which is when overuse problems tend to show up. Yours is {acwr}; fitness is rising {ramp} points per week."

## 4. HRV baseline and normal range , MVP

- **Formula:** nightly value `h = ln(lastNightAvg)` (Garmin value is rMSSD-like; keep their units). `base_mean`, `base_sd` over the previous 60 nights (excluding today, requires >= 21 values; min 30 for a "normal range" display). Acute `h7` = mean of last 7 nights (>= 4 valid). Normal range = `base_mean +/- 1 sd` (back-transform with `exp`). `z_hrv = (h7 - base_mean)/base_sd`. Status: z >= -1 and <= +1 "in range", < -1 "below" (flag), > +1 "above" (flag: positive only if RHR not also elevated, see 5). Single-night value shown but never used alone. Chart: nightly points, 60-day mean line, +-1 sd band.
- **Inputs:** `hrv_daily`; compare with Garmin's `baseline.balancedLow/Upper` as cross-check.
- **Availability:** since Nov 2025; baseline from ~Jan 2026.
- **Caveats:** optical wrist HRV is noisy; nights after alcohol, late meals, illness, travel, altitude shift it; low n = wide range; sustained 2-3 week drift is more meaningful than a day.
- **Explain this:** "HRV is the small variation between heartbeats overnight; when your body is stressed or tired it usually drops. Your 7-night average is {h7} ms against your normal {low}-{high}. {in range / below}. One bad night means little; a week below range is worth easing off."

## 5. HRV vs resting-HR divergence , MVP

- **Formula:** `z_rhr = (rhr7 - mu_rhr60)/sd_rhr60` (7-day mean of nightly/daily RHR vs previous 60 days; use sleep-based RHR if present else daily `rhr`). Combine with `z_hrv`:
  - z_hrv <= -1 and z_rhr >= +1 : **strain/illness signal** (red).
  - z_hrv <= -1, z_rhr within +/-1 : "HRV-only dip" (amber; stress, alcohol, sleep).
  - z_rhr >= +1, z_hrv within +/-1 : "RHR-only rise" (amber; heat, caffeine, early illness).
  - z_hrv >= +1 and z_rhr <= -1 : well recovered/adapting (green).
  - z_hrv >= +1 with z_rhr within range after a hard block: possible parasympathetic saturation, "not necessarily better" (grey note).
- **7d vs 30d status and streak:** "Balanced" when 7d mean is inside the 30d mean +- 1 sd (30d-window sd) for both HRV and RHR; "Unbalanced low/high" otherwise; streak = consecutive days "Balanced" (reset on first miss, shown as days).
- **Availability:** since Nov 2025 for HRV; RHR since earlier.
- **Caveats:** classification thresholds are heuristics; wrist RHR differs from true resting.
- **Explain this:** "Your heart-rate variability and resting heart rate usually move in opposite directions. When HRV falls and resting HR rises together for several days, that is the clearest sign of accumulated stress or an oncoming illness. Right now: {state}."

## 6. Readiness score design , MVP (v1), recalibrate later

Purpose: our replacement for Garmin Training Readiness (not available via API). Garmin's published inputs are sleep score, recovery time, HRV status, acute load, sleep history, stress history ([Garmin manual](https://www8.garmin.com/manuals/webhelp/GUID-31D23DBB-57C2-4DF7-A0C9-8D1A00AB4BE7/EN-US/GUID-C21BE0C8-A08E-4DA1-B6C6-2E0E2DDDB372.html), [5krunner](https://the5krunner.com/garmin-features/training/training-readiness)).

- **Formula (0-100), transparent weighted sum of component scores `c_i` in 0-100:**

  | Component | Weight | Mapping |
  |---|---|---|
  | HRV (z_hrv of 7d vs 60d, plus last night z) | 30 | `c = clamp(70 + 20*z)` where z blends 0.6*z7 + 0.4*z_last |
  | Resting HR (z_rhr, inverted) | 15 | `c = clamp(70 - 20*z)` |
  | Last night sleep (duration vs need, Garmin score) | 20 | `0.5*min(100, dur/need*100) + 0.5*garmin_score` |
  | Sleep debt 14 d | 10 | `c = 100 - 12*debt_h` clamped |
  | Load/form (TSB, ATL jump) | 20 | `c = clamp(70 + 2.5*TSB)`; minus 10 if ACWR > 1.5 |
  | Body battery morning max | 5 | `c = bb_max` |
  Missing components are dropped and weights renormalised; if < 3 components available, show "low confidence". Cap: active injury/illness note -> score capped 50 and flagged. Hard-effort yesterday (load > 1.5x CTL) does not lower the score by itself (it is in TSB).
- **Output:** score, label (>=80 high, 60-79 moderate, 40-59 low, < 40 poor), top 2 drivers (largest weighted deviation), component bars, confidence.
- **Calibration:** optional daily check-in (mood/soreness 1-5). After 60 check-ins, compute rank correlation with the score and show it; adjust weights manually only if correlation < 0.2 (`ponytail:` no ML fitting).
- **Caveats:** unvalidated heuristic; weights are our opinion; correlates with Garmin's but won't equal it. Not a go/no-go order.
- **Explain this:** "Readiness blends how well you slept, how your HRV and resting HR compare to your own normal, how much fatigue is stacked from training, and your energy reserve. Today {score} ({label}). Biggest factors: {driver1}, {driver2}. It is a guide; if you feel off, trust that over the number."

## 7. Sleep consistency and sleep debt , MVP

- **Consistency:** midpoint of sleep `m = (start + end)/2` (minutes from 00:00, unwrapped around midnight); `consistency = SD(m over last 7 nights)` in minutes. < 30 great, 30-60 ok, > 60 poor. Also weekday vs weekend midpoint gap ("social jet lag").
- **Debt:** `need` = Garmin `sleepNeed` if present else settings `sleep_need_h` (default 8). `debt_14d = max(0, sum_over_14d(need - actual) with surplus counted at 50%)`. Naps add to actual.
- **Composition chart:** 30 nights stacked deep/REM/light/awake in minutes (from `sleep`), with average shares (deep ~13-23%, REM ~20-25% are common adult ranges, shown as context not targets) and a body battery morning/evening range band (`bb_max`, `bb_min`).
- **Availability:** since Nov 2025.
- **Caveats:** watch sleep time is estimated; debt model is a simple heuristic (recovery from debt is not linear); one very short night weighs the same as spread-out small deficits.
- **Explain this:** "You went to bed and woke at times varying by about {sd} min this week (steadier is better for recovery). Over two weeks you are about {debt} h short of your sleep need; one or two longer nights will mostly clear it."

## 8. Aerobic efficiency and HR decoupling , MVP

- **EF (Efficiency Factor):** run: `EF = speed_mps*60 / avgHR` (m per min per beat) over steady segments; ride: `NP / avgHR`. Steady segment = >= 20 min, pace CV < 8%, excluding first 10 min warm-up and stops.
- **Decoupling (Pa:HR):** split steady portion into halves; `EF1, EF2`; `decoupling% = (EF1 - EF2)/EF1 * 100`. Use grade-adjusted speed (Minetti polynomial) when elevation gain > 10 m/km. < 3-5% = good aerobic base for that duration; > 7% = drifted (fatigue, heat, dehydration, pace too hard).
- **Trend:** EF at easy runs (avg HRr 0.55-0.75) as 28-day median; rising EF at same HR = improving fitness.
- **Availability:** needs FIT. Runs from the first one if we backfill all FIT (lazy for old).
- **Caveats:** only comparable between similar conditions (heat > 20 C inflates drift; hills; wind); needs >= 40 min total for decoupling; wrist HR optical error.
- **Explain this:** "Efficiency is how fast you move per heartbeat. Decoupling shows whether your heart rate crept up while pace stayed the same; under 5% on a long easy run means your aerobic engine is holding up. This run: {x}% ({good/ok/drifted}); efficiency trend over 8 weeks: {up/flat/down}."

## 9. VO2max estimate , MVP

- **Formula (per qualifying segment, Runalyze-style HR-pace relation):** ACSM running equation `VO2_seg = 0.2*v + 0.9*v*grade + 3.5` (v in m/min, grade fraction). Using %HRR ≈ %VO2 reserve: `VO2max_seg = 3.5 + (VO2_seg - 3.5) / HRr_seg`. Qualifying: >= 8 min continuous, HRr 0.65-0.95, grade |g| < 4%, drift < 5% in segment, temp < 25 C if known. Activity estimate = median of its segments; reported value = rolling 42-day weighted mean (weights by HRr, higher intensity trusted more). Correct for max HR error by using settings max HR (confirm).
- **Availability:** FIT runs; Garmin's value not available via API (see findings), so there is no official value to compare except the watch screen.
- **Caveats:** HR-based estimate is rough: +-5 ml/kg/min is realistic; heat, caffeine, fatigue lower pace-at-HR; Garmin/Firstbeat and Runalyze differ by design ([forum discussion](https://forums.garmin.com/outdoor-recreation/outdoor-recreation/f/fenix-6-series/258150/why-does-garmin-vo2max-numbers-differ-so-much-from-runalyze-vo2max)). Use for trend, not absolute.
- **Explain this:** "VO2max is an estimate of your aerobic ceiling, here derived from how fast you run at given heart rates. Our estimate is {v} (range {lo}-{hi}) and has moved {delta} in 8 weeks. Treat the direction as meaningful; the exact number will differ from your watch."

## 10. Race predictions , MVP

- **Method A (performance based):** best efforts from FIT in last 90 days (1 km, 1 mi, 5 km, 10 km, HM via sliding window over cumulative distance). Riegel `T2 = T1*(D2/D1)^e` with e = 1.06 for <= 10 km targets, rising linearly to e = 1.12 for marathon when `weekly_km_28d < 50` or `longest_run_90d < 0.5*target distance` (endurance penalty). Take the best of the 5-21 km efforts as anchor for HM/M.
- **Method B (VO2max based):** Daniels-Gilbert `%VO2max(t)` / `VO2(v)` solved for t.
- **Output:** a range (A..B) per distance 5k/10k/HM/M, and confidence = f(recency of anchor, whether anchor was a true race effort). Maintain "last race effort" flag from activity name/`eventType` if present.
- **Caveats:** training bests under-predict race ability; marathon prediction without long runs is optimistic; weather and course matter (see 17).
- **Explain this:** "Predictions extrapolate your best recent efforts to other distances. Based on your {anchor} on {date}, your 10 km would be about {range}. The marathon number assumes your longest runs and weekly mileage support it; currently that is {ok/optimistic}."

## 11. Critical speed (CS) and D' , MVP

- **Formula:** linear distance-time model `D = CS*t + D'` fitted by least squares to best efforts at durations (3, 6, 12 min, plus 20 min if available) from last 90 days (mean-maximal speed curve from streams). `CS = slope` (m/s), `D' = intercept` (m, typical 100-400 m). Require >= 3 efforts, longest/shortest ratio >= 3, R^2 >= 0.97. Show CS as pace/km and relation to LTHR pace (CS is roughly 10-15 km race pace).
- **Availability:** FIT runs; accuracy depends on having genuine hard efforts.
- **Caveats:** training best efforts are submaximal -> CS underestimated; fit with noisy data unstable (show CI from residuals); do not mix hilly and flat bests (use GAP).
- **Explain this:** "Critical speed is roughly the fastest pace you can hold for a long time before fatigue climbs steeply: {pace}/km. D' is your sprint reserve above it: {d} m. Both are estimates from your best efforts, so hard sessions or a time trial will sharpen them."

## 12. Running economy, cadence, GCT trends , Later (cadence/GCT MVP charts only)

- **Metrics:** pace at fixed HR (median pace for steady segments with HR 140-150, or HRr 0.65-0.75); cadence (spm = 2 x per-leg cadence) vs speed; ground contact time, vertical oscillation, vertical ratio, stride length (FIT running dynamics); power:HR for runs with power; stride length vs speed slope.
- **Trend method:** 28-day rolling median, with Theil-Sen slope over 8-12 weeks; condition filters: temp, grade, surface (no way to know), shoes (stratify by shoe id).
- **Built:** per-run averages and 1 Hz series of cadence (spm), stride length (m, FIT step length), vertical oscillation (mm), vertical ratio (%), ground contact time (ms), contact balance (% left) and power, plus a weekly trend (`/api/dynamics`). Samples outside plausible ranges (stride 0.3 to 3 m, oscillation 20 to 250 mm, ratio 1 to 30%, contact 100 to 900 ms, balance 30 to 70%) are dropped. Averages are plain means of the 1 Hz samples. No trend slopes or speed normalisation yet.
- **Availability:** FIT with running dynamics; depends on sensor (wrist-only vs pod/HRM-Pro; check `sensors[]`). Unknown for this account until first parse.
- **Caveats:** GCT/vertical oscillation from some watches are modelled/noisy; shoe changes shift values; better speed raises cadence and lowers GCT regardless of economy.
- **Explain this:** "Running economy is how little effort a given pace costs you. Your pace at a heart rate of ~145 bpm changed from {a} to {b}/km over 8 weeks. Cadence {c} spm and ground contact {g} ms are context, not goals by themselves."

## 13. Polarization (time in zones) , MVP

- **Formula:** 3-zone collapse of HR time-in-zone: Z1 = Garmin zones 1-2 (below ~VT1), Z2 = zone 3, Z3 = zones 4-5. Fractions `f1,f2,f3` over rolling 28 days (runs; seconds). Polarization index `PI = log10((f1/(f2*f3))*100)`; PI > 2.0 with f1 > f3 implies polarized (Treff et al. 2019); report simple shares first ("78/12/10"). Target hint: ~75-80% easy.
- **Intensity page:** (a) weekly stacked minutes per Garmin HR zone for the last 8 weeks; (b) 80/20 card: share easy (zones 1-2) vs hard (3-5) for 28 days, target band 75-85% easy, red if < 65% or > 95% (the latter only a note); (c) same breakdown per sport using that sport's zone floors.
- **Inputs:** `hrTimeInZone_1..5` from summary (available for all activities) or recomputed from streams.
- **Caveats:** zones are LTHR-based, not lab VT1/VT2; HR lags short intervals (understates Z3); wrist HR errors; time in zone ignores cycling/ski differences.
- **Explain this:** "Over the last 4 weeks {f1}% of your time was easy, {f2}% in the grey middle zone, {f3}% hard. Many runners improve by keeping most running genuinely easy and the hard days really hard; a big middle share often means easy days are too fast."

## 14. Monotony and strain , Later

- **Formula (Foster):** over last 7 days `monotony = mean(L)/SD(L)` (SD of daily loads, rest days = 0 included); `strain = sum(L_7d) * monotony`. Flag monotony > 2.0 and strain above 1.5x its own 8-week median.
- **Caveats:** ill-defined if all days equal or all zero; low SD from steady daily easy running reads "monotonous" though harmless; thresholds derived from team sports. Use as supporting indicator only.
- **Explain this:** "Monotony says how similar your days are; training the same amount every day with no hard/easy contrast raises it. Yours is {m} (above 2 is a flag). Mixing in a real rest day or an easy day lowers it."

## 15. Training Effect and load balance (Garmin reference) , Later

Use Garmin `aerobicTrainingEffect`/`anaerobicTrainingEffect` per activity as display-only labels; "Load focus" (low aerobic / high aerobic / anaerobic) approximate via zone shares over 28 days vs a target mix. Caveat: Garmin-proprietary EPOC; do not blend with our load.

## 15b. Steps, mileage comparison and goals , MVP (steps low priority)

- **Steps:** `daily_summary.steps` (Garmin daily v2; steps endpoint has a 28-day window but v2 summary covers 365 d, so use v2). Metrics: goal hit rate (days >= 10000 over 30 d), current streak, 7d/30d average, weekly total. Caveats: wrist step counting counts arm swing; run steps double-count nothing but are included; goal days with watch not worn read low. Explain this: "You reached 10,000 steps on {k} of the last 30 days; current streak {s} days; average {a}."
- **Cumulative distance comparison:** current week/month/year vs previous ones, rolling 30/365 d vs the window before; goal pace line = target * day_of_period / days_in_period. Data and API shape in plan.md section 6. Explain this: "This year you have run {km} km, {ahead/behind} the pace needed for 2,000 km by {x} km; at the current weekly average you finish at about {proj} km." (projection = linear extrapolation of the 8-week average, labelled as such).
- **Weekly band:** a weekly running distance band; states: below band, in band, above band (above 60 flagged only if ACWR also high).
- **Strength RPE:** user-entered via activity page or coach chat; feeds load (section 1).

## 16. Body battery and stress context , Later

Show morning body battery max, drain during the day, average stress; used only as inputs to readiness (5%) and correlations. Caveat: Firstbeat black box; stress from HRV so overlaps with 4.

## 17. Weather adjustment , Later

- **Formula (heat):** fetch temperature and dew point at start (Open-Meteo archive, free, no key). Rule-of-thumb combined value `C = T_F + Dp_F`: < 100 no adjustment; 101-110 0.0-0.5%; 111-120 0.5-1.0%; 121-130 1-2%; 131-140 2-3%; 141-150 3-4.5%; 151-160 4.5-6%; > 160 high risk (a widely circulated running-community guideline, not peer reviewed, treat as approximate). Adjusted pace = pace / (1 + adj). Wind: skip (needs route bearing); cold below 0 C not adjusted.
- **Use:** annotate activities ("heat cost ~{x}%"), exclude hot runs (> 25 C) from VO2/EF trends or normalise.
- **Availability:** needs start lat/lon from FIT/track, or device temperature record (wrist-biased high; prefer API).
- **Explain this:** "It was {t} C with dew point {d} C, which typically costs about {x}% in pace. Your adjusted pace was {p}/km, so the slower run was not necessarily weaker."

## 18. Correlation engine , Later (design now, build in phase 6)

Goal: find *your* personal patterns without manufacturing false ones.

- **Daily feature table** (one row per date): sleep_h, sleep_score, sleep_midpoint, hrv_ln, rhr, stress_avg, bb_max, load, load_prev_day, alcohol/illness/travel tags (from notes/check-in), mood, soreness, EF of that day's easy run, pace_at_hr, next_day readiness.
- **Pre-registered pair list** (about 12; fixed in code, not searched):
  1. sleep_h -> next-day hrv_ln (lag 0, 1)
  2. load (day d) -> hrv_ln (d+1, d+2)
  3. load (d) -> rhr (d+1)
  4. sleep_consistency (7 d) -> hrv_ln 7d (lag 0)
  5. sleep_h -> pace_at_hr or EF next day (lag 1)
  6. stress_avg -> hrv_ln (lag 0, 1)
  7. weekly km -> EF trend (lag 0-2 weeks, weekly resolution)
  8. TSB -> subjective mood (lag 0)
  9. alcohol tag -> hrv_ln, rhr, sleep_score (lag 0, 1)
  10. temperature -> decoupling (lag 0)
  11. sleep_debt -> readiness-independent mood/soreness (lag 0)
- **Method:** Spearman rank correlation (robust to outliers). Detrend both series by subtracting 28-day rolling mean (removes shared seasonal/training-block trends that create spurious r). Exclude days tagged illness/travel unless that is the tested variable. Lags are limited to those listed (<= 3 per pair); report the lag only if it survives multiple-comparison control: Benjamini-Hochberg FDR 10% across all pair-lag tests run.
- **Minimum sample:** n >= 30 paired days (>= 40 for lag tests, >= 12 for weekly-resolution pairs, tag-based comparisons need >= 8 tagged days and >= 8 untagged). Below that: "not enough data yet ({n}/30)".
- **Uncertainty:** 95% CI via Fisher z with effective sample size `n_eff = n*(1 - r1x*r1y)/(1 + r1x*r1y)` (r1 = lag-1 autocorrelations) so autocorrelated series do not look more certain. Stability check: split-half (first vs second half) sign must agree, else mark "unstable".
- **Scatter cards (what the reference app shows, with our guards):** views such as sleep duration -> aerobic TE, HRV -> aerobic TE, weekly volume change -> next-week HRV change show scatter, r and R². A reference screenshot showed r = -0.91 from 4 points: that is noise. Rules: n < 30 pairs (n < 12 for weekly pairs): render the scatter greyed with "n = {n}: too few points to say anything" and NO r/R²/trend line; n >= min but CI includes 0: "no clear link"; otherwise show r, R² = r² (labelled "explains {R²}% of day-to-day variation, usually little"), CI and n. Any |r| > 0.8 on real daily data triggers a data-sanity warning before display.
- **Threshold callouts** ("below 7 h sleep your aerobic TE averages -0.6 lower"): split at a pre-set threshold only (7 h sleep; no searching for the best cut-point), require >= 10 days on each side, show difference in means with bootstrap 95% CI and both n; display only if CI excludes 0, else "no clear difference".
- **Presentation:** wording by |r|: < 0.2 "no clear link", 0.2-0.4 "weak", 0.4-0.6 "moderate", > 0.6 "strong (rare, double-check data)". Always show: r with CI, n, lag, scatter plot, effect in plain units ("nights > 7.5 h were followed by +4 ms HRV on average") and the standing caveat "association, not proof of cause; other factors not measured". Never display an r whose CI includes 0 as a finding. Add pairs 12-14 to the list: sleep_h -> aerobic TE (lag 0), hrv_ln -> aerobic TE (lag 0), weekly km change -> next-week hrv_ln change (weekly). Coach is allowed to quote only reports from `get_correlations`, never to compute its own. Recompute weekly; keep a log so changes in conclusions are visible.
- **Explain this:** "Across {n} days, nights with more sleep were followed by higher HRV (r = {r}, plausible range {lo} to {hi}). That is a {weak/moderate} pattern in your data, not proof of cause. We tested {k} patterns in total, so this one was checked against chance."

---

# Competitor survey (web search, 2026-10-29)

What each does, to decide what to copy and where there is room to differ.

| Product | Relevant features | Source |
|---|---|---|
| Garmin | Training Readiness 1-100 from sleep score, recovery time, HRV status, acute load, sleep history, stress history; Training Status (Productive/Unproductive etc.) interprets VO2max trend vs acute load; none of it exposed by the Personal API | [Readiness manual](https://www8.garmin.com/manuals/webhelp/GUID-31D23DBB-57C2-4DF7-A0C9-8D1A00AB4BE7/EN-US/GUID-C21BE0C8-A08E-4DA1-B6C6-2E0E2DDDB372.html), [Training Status blog](https://www.garmin.com/en-US/blog/fitness/garmin-training-status-and-how-to-use-it/) |
| Strava | Relative Effort = HR-zone TRIMP; Fitness & Freshness chart (fitness, fatigue, form) from an impulse-response model; heatmaps (our planned personal one) | [Strava support](https://support.strava.com/hc/en-us/articles/216918477-Fitness-Freshness), [forum discussion](https://www.trainerroad.com/forum/t/strava-fitness-freshness-helpful-or-a-gimmick/45959) |
| TrainingPeaks | TSS (100 = 1 h at threshold), PMC with CTL (~6 wk), ATL (~7 d), TSB; paid, coach-oriented | [PMC explainer](https://www.trainingpeaks.com/blog/what-is-the-performance-management-chart/), [coach guide](https://www.trainingpeaks.com/coach-blog/a-coachs-guide-to-atl-ctl-tsb/) |
| Intervals.icu | Free, highly configurable CTL/ATL/TSB (documented factors 0.9765/0.8669), ramp rate over 7/28/90/365 d, forum-driven transparent formulas, planned workouts feeding forecasts | [forum: constants](https://forum.intervals.icu/t/change-fatigue-atl-and-fitness-ctl-factors/300/19), [forum: needed load](https://forum.intervals.icu/t/calculate-needed-training-load/5788), [ramp rate docs excerpt](https://forum.intervals.icu/t/weekly-calculations-for-ctl-atl-tsb-required-tss-for-optimal-tsb-etc/59297) |
| Runalyze | Per-activity effective VO2max from HR/pace, marathon-shape-based race predictions for every distance, CTL/ATL + acute:chronic "shape" chart; known to differ from Garmin VO2max | [runalyze.com](https://runalyze.com/), [Garmin forum thread](https://forums.garmin.com/outdoor-recreation/outdoor-recreation/f/fenix-6-series/258150/why-does-garmin-vo2max-numbers-differ-so-much-from-runalyze-vo2max) |
| Athlytic | Recovery from HRV and RHR vs rolling 60-day baselines, HRV weighted slightly higher; Apple Watch focus | [Athlytic help](https://athlyticapp.helpscoutdocs.com/article/20-understanding-recovery) |
| Whoop | Recovery from HRV, RHR, respiratory rate, sleep performance vs need (which rises with prior strain); strain score | [Whoop community](https://www.community.whoop.com/t/what-is-the-recovery-score-and-how-is-it-calculated/107), [overview](https://wellnesspulse.com/healthtech/wearable-recovery-scores-explained/) |
| Oura | Readiness from HRV, RHR, body temperature, sleep, activity balance, with contributors listed | [overview](https://wellnesspulse.com/healthtech/wearable-recovery-scores-explained/) |

(Competitor details are summarised from the search snippets above; not independently verified against each vendor's latest app.)

# Novel ideas other apps lack

Ranked by value over effort for a single-user app. Each is a candidate, not committed scope; MVP ones marked.

1. **Forward form planner (MVP, phase 3).** Intervals.icu-style projection exists, but nothing couples it to a conversational coach with persistent notes: "rest tomorrow, easy Thursday, race Sunday: what will my form be?" Coach edits `planned_load` and shows the new curve. Differentiator is the loop plan -> projection -> advice.
2. **Fully transparent readiness (MVP).** Competitors give a score with opaque weights; we show components, n, confidence and "what would change it", plus an optional daily check-in that measures how well the score matches how you actually felt (calibration against yourself, with rank r shown honestly).
3. **Personal correlation report with honesty built in (Later).** Pre-registered pairs, detrending, FDR, effective-n CIs, "no clear link" as a first-class result; whoop/Oura-style "insights" rarely show uncertainty.
4. **"Why did my score change" diffs (Later).** Decompose today vs yesterday readiness/CTL change into component contributions in one sentence; coach narrates.
5. **Decision log + outcome review (Later).** Coach stores "decided to run easy because readiness 48"; 3 days later compares HRV/RHR/load and reports whether the call looked right. Builds a personal evidence base.
6. **Shoe-aware economy (Later).** Stratify pace-at-HR, cadence, GCT by shoe, with mileage on the shoe, to show if a model changes your economy or if retirement mileage degrades it; nobody joins gear with dynamics.
7. **Heat/dew-adjusted trend lines (Later).** Normalise efficiency/VO2 trends for weather so summer does not look like detraining; show raw and adjusted.
8. **RR-interval (beat-to-beat) analysis from FIT (Later, experimental).** FIT `hrv` messages hold R-R data per activity: compute post-run HRV recovery or DFA-alpha1 threshold drift estimates. Prior art is mostly third-party and bike-focused; mark experimental and do not feed readiness.
9. **Notes-aware metrics (MVP-lite).** Injury/illness/travel notes automatically exclude days from baselines and correlations and cap readiness; wearables ignore your life context.
10. **MCP-native data (phase 5).** Your whole history is queryable by any MCP-capable assistant with identical tools, so Claude.ai or Claude Code can coach with no API spend; competitors lock the data in their own chatbot (Strava's MCP covers Strava-side data only).
11. **Multi-sport load with explicit uncertainty (MVP).** Show load source per activity (FIT TRIMP / zones / RPE fallback) as a small badge so strength and ski load estimates are visibly softer than run load.

## Records and fitness estimates (built)

All computed offline by `sync/run.ts records` (and at the end of `steady` and `backfill`), from the 1 Hz FIT streams. `src/metrics/records.ts` holds the formulas.

- **Best efforts.** Fastest time over 1 km, 1 mile, 5 km, 10 km and half marathon, plus best distance in 3, 6, 12 and 20 minutes (used for CS only). Sliding window over distance on the timer clock with linear interpolation at the window start. Smart recording gaps up to 60 s are normal in older files. A longer gap that moved under 30 m is a timer pause and counts as 1 s, as Garmin does. A longer gap with real distance, a step faster than 25 m/s (GPS jump) or a falling distance cuts the window, and an effort faster than 9 m/s is dropped. A window may fall up to 10 m short of its label (a 10 km race logged as 9,999 m), with time scaled to the full distance. Power records are not kept. The `fastestSplit` summary fields are not used, every run with a synced file is read.
- **PB history.** `best_efforts` keeps the all-time top 3 per label and every run that beat all earlier ones.
- **Critical speed.** Least squares of distance on time, D = CS x T + D', over the best 3, 6, 12 and 20 minute efforts of the last 90 days. Hidden with fewer than 3 efforts, r2 below 0.98, CS outside 1.5 to 7 m/s or D' outside 0 to 1000 m. Limit: best efforts from ordinary training are rarely all-out, so CS reads low for people who seldom race or test.
- **VO2max estimate.** Steady blocks are 5 minutes after the first 8 minutes with speed 2.2 to 5.5 m/s, five 1-minute parts within 10% of each other in speed, heart rate within 8 bpm, under 2% grade change, no gaps. Each run gives the median block HR and speed. VO2max = 3.5 + 0.2 x speed (m/min) / %HRR (ACSM flat running cost, %HRR standing in for %VO2 reserve). %HRR uses max and resting HR from the `hr_zones` table (running, else default, effective at the run date) and must fall between 50 and 92%. Runs giving under 25 or over 85 are dropped. The value is the median over the last 28 days, shown only with 3 or more runs. Limits: HR drift, heat, hills and caffeine move it a few points, it assumes the configured max HR is true, and it is not Garmin's number.
- **Race prediction.** Riegel, T2 = T1 x (D2 / D1)^k with k = 1.06 by default. Every best effort of the last 180 days from 0.4 to 4.5 times the target distance is projected and the fastest projection wins, so a slow recent long run does not drag a prediction down. The range is k minus and plus 0.03. Flagged `old` past 56 days and `short` when the target is over 3 times the source distance. CS cross-check for 5 km and 10 km as (D - D') / CS. A marathon needs a source of at least about 9.4 km, and Riegel overstates marathon fitness for runners with low mileage.

## Routes (built)

`src/metrics/routes.ts`, run in the browser on `routes/all.json` (docs/api.md, GET /api/routes). Simple greedy grouping, deterministic:

- Runs are taken oldest first (ties by id). A run joins the first group whose first run starts within **150 m** (flat-earth distance between the rounded start points) and whose distance is within **5%** of that first run's distance. Otherwise it opens a new group.
- Runs under **1 km** are never grouped. Only groups with **2 or more runs** are listed, most runs first, then the most recent last run.
- Per group: count, typical distance (median), best time (shortest duration), last run (newest date) and a thumbnail of that last run.
- Limits: the shape of the run is not compared, so two different loops from the same door with the same length become one route, and an out-and-back run done in the other direction still matches. A leader that is unusually short or long shifts the 5% window. Best time compares runs that differ by up to 5% in distance, so treat it as a rough guide.
- Heatmap: every run is one SVG path at 16% opacity, so overlap brightens. Projection is Web Mercator and fitted to the 1st to 99th percentile of the points of the shown runs, so a single trip far from home does not shrink the rest (those lines run off the edge). Map tiles from OpenStreetMap sit behind the lines (Web Mercator, so lines and tiles agree); without them the plain lines remain.
