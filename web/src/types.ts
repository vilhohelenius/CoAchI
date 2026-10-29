// Mirrors docs/api.md. Any field may be null or missing when its input was missing.
export type Component = { key: string; label: string; weight: number; available: boolean; n: number; score: number | null; value: string | null }
export type Hrv = { last: number | null; h7: number | null; base: number | null; low: number | null; high: number | null; z: number | null; status: 'below' | 'in_range' | 'above' | null; n7: number; n_base: number; range_ok: boolean }
export type Today = {
  as_of: string; data_date: string | null
  status?: { label: string; ctl: number | null; atl: number | null; tsb: number | null; acwr: number | null; ramp7: number | null; warming_up: boolean } | null
  readiness?: { score: number | null; label: string; confidence: 'ok' | 'low' | 'none'; capped: boolean; n_components: number; drivers: string[]; components: Component[] } | null
  last_activity?: { id: number; start_local: string; type: string | null; name: string | null; distance_m: number | null; duration_s: number | null; avg_hr: number | null; elev_gain_m: number | null; load: number | null; load_source: string | null; aero_te: number | null; rpe: number | null; polyline?: string | null } | null
  sleep?: { date: string; total_s: number | null; deep_s: number | null; light_s: number | null; rem_s: number | null; awake_s: number | null; score: number | null; start_ts: number | null; end_ts: number | null } | null
  tiles?: { steps: number | null; step_goal: number | null; rhr: number | null; stress_avg: number | null; body_battery_max: number | null; hrv_last_night: number | null; hrv_garmin_status: string | null
    hrv?: Hrv | null; recovery?: { rhr7: number | null; z_rhr: number | null; divergence: string | null; streak_days: number | null } | null } | null
  this_week?: { start: string; sessions: number; distance_m: number | null; duration_s: number | null; load: number | null; run_distance_m: number | null } | null
}
export type Goals = { as_of: string; progress?: {
  year?: { target_km: number; ytd_km: number; expected_km: number; diff_km: number; status: string; projected_km: number | null; avg_week_km_8w: number | null } | null
  week?: { band_lo: number; band_hi: number; km: number; status: string } | null
  steps?: { goal: number; today: number; streak_days: number; today_pending: boolean; hit_30d: number; avg_7d: number | null; status: string } | null } }
