import type { RouteRun } from '../../src/metrics/routes'
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
export type Goals = { as_of: string; data_date?: string | null; goals?: { id: number; kind: string; target_value: number | null; target_max: number | null; status: string }[]; progress?: GoalProgress | null }

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

export type MileageResp = { as_of: string; by: 'week' | 'month' | 'year'; sport: string; periods: { key: string; km: number; hours: number; elev_m: number; sessions: number; longest_km?: number }[] }
export type CompareResp = { as_of: string; sport: string; today?: string; goal_km: number | null; years: { year: number; total_km: number; points: [number, number][] }[]
  rolling: { dates: string[]; km30: (number | null)[]; km365: (number | null)[] } }

export type ActRow = { id: number; start_local: string; type: string | null; sport?: string; name: string | null; distance_m: number | null; duration_s: number | null; elev_gain_m: number | null; avg_hr: number | null; load: number | null; fit_status?: string }
export type ActList = { as_of: string; activities: ActRow[]; next_before: string | null }
export type Lap = { lap_idx: number; step_type: string; set_no: number | null; rep_no: number | null; duration_s: number | null; distance_m: number | null; avg_speed_mps: number | null; avg_hr: number | null; max_hr: number | null; avg_power: number | null; avg_cadence: number | null; ascent_m: number | null }
export type ActDetail = { str?: (number | null)[]; vo?: (number | null)[]; vr?: (number | null)[]; gct?: (number | null)[]; bal?: (number | null)[]
  alt?: (number | null)[]; n: number; duration_s: number; hr: (number | null)[]; speed: (number | null)[]; cad: (number | null)[]; pwr: (number | null)[]
  route: [number, number][]; splits: { km: number; s: number; hr: number | null }[]; ef: number | null; decoupling: number | null; why: 'ok' | 'no_hr' | 'short' | 'variable' }
export type ActResp = { as_of: string; activity: ActRow & { moving_s: number | null; max_hr: number | null; avg_cadence: number | null; avg_power: number | null; norm_power: number | null; aero_te: number | null; anaero_te: number | null
  load_source: string | null; rpe: number | null; feel: number | null; hr_z1_s: number | null; hr_z2_s: number | null; hr_z3_s: number | null; hr_z4_s: number | null; hr_z5_s: number | null; temp_c: number | null
  avg_stride_m?: number | null; avg_vert_osc_mm?: number | null; avg_vert_ratio?: number | null; avg_gct_ms?: number | null; avg_gct_balance?: number | null; shoe_id?: number | null }
  laps: Lap[]; detail: ActDetail | null }

type DynPoint = { avg: number; n: number } | null
export type DynResp = { as_of: string; weeks: ({ week_start: string } & Record<'stride_m' | 'vert_osc_mm' | 'vert_ratio' | 'gct_ms' | 'gct_balance' | 'cadence' | 'power', DynPoint>)[] }

type Top = { id: number; date: string; distance_m: number | null; duration_s: number | null; elev_gain_m: number | null } | null
export type RecordsResp = { as_of: string; available: boolean; n_runs: number
  ranges?: Record<string, Record<string, { value: number; date: string; activity_id: number }>>; longest?: Top; climb?: Top; rides?: { n: number; fastest: Top; longest: Top; climb: Top } | null
  records: { label: string; unit: 's' | 'W'; best: { rank: number; value: number; date: string; activity_id: number }[]; timeline: { date: string; value: number; activity_id: number }[] }[] }
export type Vo2 = { value: number | null; n: number; from: string; to: string; history: { week_start: string; value: number | null; n: number }[] }
export type CsFit = { ok: boolean; reason: string | null; n: number; cs?: number; dprime?: number; r2?: number; from: string; to: string }
export type Prediction = { label: string; dist_m: number; point_s: number | null; lo_s: number | null; hi_s: number | null; cs_s: number | null; flags: string[]; model?: 'vdot' | 'riegel' | null; vdot?: number | null
  source: { label: string; dist_m: number; time_s: number; date: string; age_days: number } | null }
export type FitnessResp = { as_of: string; available: boolean; riegel: number; vo2?: Vo2; cs?: CsFit; predictions?: Prediction[] }

export type StepsResp = { as_of: string; goal: number | null; days: { date: string; steps: number | null }[]; summary: GoalProgress['steps'] | null }

/** routes/all.json: [id, date, distance_m, duration_s, [startLat, startLon], flat lat/lon list] */
export type { RouteRun }
export type RoutesResp = { v: number; runs: RouteRun[] }

export type Shoe = { id: number; name: string; brand: string | null; default_for: 'run' | null; start_km: number; retire_km: number; retired_on: string | null; notes: string | null; since: string
  km: number; runs: number; last_run: string | null; alert: 'soon' | 'over' | null }
export type ShoesResp = { as_of: string; shoes: Shoe[] }

export type CoachPlan = { date: string; brief: string | null; source: 'llm' | 'fallback'; suggestion: { date: string; kind: 'easy' | 'long' | 'workout' | 'rest' | 'recovery'; km: number | null; title: string; text: string; pace: string | null; hr_cap: number | null; why: string } }
