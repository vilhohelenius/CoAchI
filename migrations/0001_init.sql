-- Dates are local calendar dates YYYY-MM-DD (TEXT). Timestamps are UTC ms (INTEGER).
-- Plain SQLite: runs unchanged on node:sqlite and on D1.

CREATE TABLE sync_state (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at INTEGER
);

CREATE TABLE activities (
  id INTEGER PRIMARY KEY,
  start_local TEXT,
  start_gmt TEXT,
  type TEXT,
  name TEXT,
  distance_m REAL,
  duration_s REAL,
  moving_s REAL,
  elev_gain_m REAL,
  avg_hr REAL,
  max_hr REAL,
  avg_cadence REAL,
  avg_power REAL,
  norm_power REAL,
  aero_te REAL,
  anaero_te REAL,
  garmin_load REAL,
  rpe REAL,
  feel REAL,
  hr_z1_s REAL, hr_z2_s REAL, hr_z3_s REAL, hr_z4_s REAL, hr_z5_s REAL,
  temp_c REAL,
  raw_json TEXT,
  fit_r2_key TEXT,
  fit_status TEXT NOT NULL DEFAULT 'none' CHECK (fit_status IN ('none','ok','error'))
);
CREATE INDEX activities_start ON activities(start_local);

-- Interval steps from FIT laps (warmup/cooldown/rest laps merged by wkt_step_index).
CREATE TABLE activity_steps (
  activity_id INTEGER NOT NULL,
  lap_idx INTEGER NOT NULL,
  step_type TEXT NOT NULL,          -- warmup|active|recovery|rest|cooldown|other|lap
  wkt_step_index INTEGER,
  set_no INTEGER,
  rep_no INTEGER,
  start_time TEXT,
  duration_s REAL,
  distance_m REAL,
  avg_speed_mps REAL,
  avg_hr REAL,
  max_hr REAL,
  avg_power REAL,
  avg_cadence REAL,
  ascent_m REAL,
  trigger TEXT,
  PRIMARY KEY (activity_id, lap_idx)
);

CREATE TABLE daily_summary (
  date TEXT PRIMARY KEY,
  steps INTEGER, step_goal INTEGER, distance_m REAL,
  rhr INTEGER, hr_min INTEGER, hr_max INTEGER,
  stress_avg INTEGER,
  bb_min INTEGER, bb_max INTEGER, bb_charged INTEGER, bb_drained INTEGER,
  resp_avg REAL, spo2_avg REAL,
  intensity_mod INTEGER, intensity_vig INTEGER,
  kcal_active INTEGER, kcal_total INTEGER,
  raw_json TEXT
);

CREATE TABLE sleep (
  date TEXT PRIMARY KEY,
  start_ts INTEGER, end_ts INTEGER,
  total_s INTEGER, deep_s INTEGER, light_s INTEGER, rem_s INTEGER, awake_s INTEGER,
  score INTEGER, avg_hr REAL, avg_stress REAL, spo2_avg REAL, resp_avg REAL,
  raw_json TEXT
);

CREATE TABLE hrv_daily (
  date TEXT PRIMARY KEY,
  last_night_avg REAL, weekly_avg REAL, high_5min REAL,
  base_low REAL, base_balanced_low REAL, base_balanced_upper REAL,
  status TEXT
);

CREATE TABLE body_battery (
  date TEXT PRIMARY KEY,
  charged INTEGER, drained INTEGER, min_level INTEGER, max_level INTEGER
);

CREATE TABLE stress (
  date TEXT PRIMARY KEY,
  avg_level INTEGER,
  rest_s INTEGER, low_s INTEGER, medium_s INTEGER, high_s INTEGER
);

CREATE TABLE steps (
  date TEXT PRIMARY KEY,
  steps INTEGER, distance_m REAL, goal INTEGER
);

-- Append-only history: a new row only when a value differs from the latest row of that sport.
CREATE TABLE hr_zones (
  effective_date TEXT NOT NULL,
  sport TEXT NOT NULL,              -- DEFAULT|RUNNING|CYCLING
  lthr INTEGER, max_hr INTEGER, rest_hr INTEGER, method TEXT,
  z1 INTEGER, z2 INTEGER, z3 INTEGER, z4 INTEGER, z5 INTEGER,
  PRIMARY KEY (effective_date, sport)
);

CREATE TABLE coach_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at INTEGER NOT NULL,
  kind TEXT NOT NULL DEFAULT 'other',
  text TEXT NOT NULL,
  expires_on TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  source TEXT NOT NULL DEFAULT 'user'
);

CREATE TABLE goals (
  id INTEGER PRIMARY KEY,
  created_at INTEGER NOT NULL,
  kind TEXT NOT NULL,               -- race|distance|weekly_km|steps|ctl|weight|custom
  title TEXT NOT NULL,
  target_value REAL,
  target_max REAL,                  -- upper end of a band, NULL for a single target
  unit TEXT,
  target_date TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','done','dropped')),
  notes TEXT
);

INSERT INTO goals (id, created_at, kind, title, target_value, target_max, unit) VALUES
  (1, 0, 'distance',  'Yearly distance',          2000,  NULL, 'km'),
  (2, 0, 'weekly_km', 'Weekly running distance',  50,    60,   'km'),
  (3, 0, 'steps',     'Daily steps',              10000, NULL, 'steps');
