// Mirrors docs/api.md. Any field may be null or missing when its input was missing.
export type Component = { key: string; label: string; weight: number; available: boolean; n: number; score: number | null; value: string | null }
export type Hrv = { last: number | null; h7: number | null; base: number | null; low: number | null; high: number | null; z: number | null; status: 'below' | 'in_range' | 'above' | null; n7: number; n_base: number; range_ok: boolean }
export type Today = {
  as_of: string; data_date: string | null
  status?: { reason?: string; label: string; ctl: number | null; atl: number | null; tsb: number | null; acwr: number | null; ramp7: number | null; warming_up: boolean } | null
  readiness?: { score: number | null; label: string; confidence: 'ok' | 'low' | 'none'; capped: boolean; n_components: number; drivers: string[]; components: Component[] } | null
  last_activity?: { id: number; start_local: string; type: string | null; name: string | null; distance_m: number | null; duration_s: number | null; avg_hr: number | null; elev_gain_m: number | null; load: number | null; load_source: string | null; aero_te: number | null; rpe: number | null; polyline?: string | null } | null
  sleep?: { date: string; total_s: number | null; deep_s: number | null; light_s: number | null; rem_s: number | null; awake_s: number | null; score: number | null; start_ts: number | null; end_ts: number | null } | null
  tiles?: { steps: number | null; step_goal: number | null; rhr: number | null; stress_avg: number | null; body_battery_max: number | null; hrv_last_night: number | null; hrv_garmin_status: string | null
    hrv?: Hrv | null; recovery?: { rhr7: number | null; z_rhr: number | null; divergence: string | null; streak_days: number | null } | null } | null
  this_week?: { days?: { date: string; km: number | null; active_min: number | null }[]; start: string; sessions: number; distance_m: number | null; duration_s: number | null; load: number | null; run_distance_m: number | null } | null
  goals?: GoalProgress | null
}
export type GoalProgress = {
  year?: { target_km: number; ytd_km: number; expected_km: number; diff_km: number; status: string; projected_km: number | null; avg_week_km_8w: number | null } | null
  week?: { band_lo: number; band_hi: number; week_start?: string; km: number; status: string; previous?: { week_start: string; km: number; status: string }[] } | null
  steps?: { goal: number; today: number | null; streak_days: number; today_pending: boolean; hit_30d: number; avg_7d: number | null; avg_30d?: number | null; status: string } | null }
export type Goals = { as_of: string; data_date?: string | null; progress?: GoalProgress | null }

export type LoadDay = { date: string; load: number | null; ctl: number | null; atl: number | null; tsb: number | null; tsb_end: number | null; acwr: number | null; ramp7: number | null; status: string | null; warming_up: number }
export type LoadResp = { as_of: string; acwr_band?: [number, number]; days: LoadDay[]
  per_sport?: Record<string, { date: string; load: number | null; ctl: number | null; atl: number | null; tsb: number | null; acwr: number | null; n35: number }[]>
  projection?: { date: string; ctl: number; atl: number; ctl_tau: number; atl_tau: number; typical_week: number[] } | null }

export type RecDay = { date: string; hrv?: Hrv | null; recovery?: { rhr7: number | null; z_rhr: number | null; divergence: string | null; balance?: { hrv: string | null; rhr: string | null; balanced: boolean | null }; streak_days: number | null } | null
  sleep?: { sd_min: number | null; n_nights7: number; social_jetlag_min: number | null; debt_h: number | null; n_debt: number; need_h: number } | null }
export type Night = { date: string; total_s: number | null; deep_s: number | null; light_s: number | null; rem_s: number | null; awake_s: number | null; score: number | null }
export type RecoveryResp = { as_of: string; days: RecDay[]; rhr?: { date: string; rhr: number }[]
  body_battery?: { date: string; charged: number | null; drained: number | null; min_level: number | null; max_level: number | null }[]
  sleep_nights?: Night[]; sleep_composition?: { n: number; min: Record<string, number>; share: Record<string, number> } | null }

export type Share = { easy: number; mid: number; hard: number; minutes: number } | null
export type IntensityResp = { as_of: string; weeks: { week_start: string; minutes: Record<string, number[]> }[]
  share_28d?: { all: Share; by_sport: Record<string, Share>; easy_target: [number, number] } }
